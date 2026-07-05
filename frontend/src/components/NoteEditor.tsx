// 笔记编辑器（双模式协调者）：可视化（Tiptap WYSIWYG）⇄ md 化（textarea 源码），共享同一份 draft。
// rawContent 是「去 fm 正文」（与 getNoteContent 同源）；保存走 api.saveNoteBody（读盘拼回 fm + 备份 + 索引）。
// Ctrl/Cmd+S 保存（两模式都拦）；Esc 退出（onCancel）；底部状态栏实时字数/字符/行。
// 草稿自动存 localStorage（按 noteId，utils/drafts 收口；不写 vault 守铁律 2）；
// **卸载/换 note 前同步落盘**（ref 镜像最新 draft，防 Esc 关 tab 在 3s debounce 窗口内丢字）。
// 被 NoteView + NoteEditorDrawer 共用：mode 自包含，两处都获得双模式。
import { useEffect, useRef, useState } from "react";
import { Button, Modal, Segmented, Space, message } from "antd";
import { CloseOutlined, SaveOutlined } from "@ant-design/icons";
import * as api from "../api";
import { notifyError } from "../utils/notifyError";
import type { NoteContent } from "../types";
import RichEditor from "./RichEditor";
import { clearDraft, readDraft, writeDraft } from "../utils/drafts";

type EditMode = "visual" | "markdown";

interface Props {
  noteId: string;
  rawContent: string;
  onSave: (updated: NoteContent) => void;
  onCancel: () => void;
}

export default function NoteEditor({ noteId, rawContent, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(rawContent);
  const [saving, setSaving] = useState(false);
  // 模式：默认可视化（WYSIWYG），可切 md 化（源码 textarea）；切换不改 draft（共享，零丢字）
  const [mode, setMode] = useState<EditMode>("visual");
  // 待恢复的草稿：换 note 时若 localStorage 有未保存草稿（≠ rawContent）则非 null，触发恢复 Modal
  const [pendingRecover, setPendingRecover] = useState<string | null>(null);

  // 镜像最新 draft / rawContent 到 ref（渲染体同步），供「卸载/换 note」cleanup 读取——避免闭包捕获旧值
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // rawContent 镜像：cleanup 判「是否编辑过」用（draft !== rawContent 才落盘，避免无编辑也留副本）
  const rawContentRef = useRef(rawContent);
  rawContentRef.current = rawContent;

  // 换 note 时：重置模式 + 检测未保存草稿（与磁盘 rawContent 不同 → 提示恢复）。
  // 仅依赖 noteId：保存后 rawContent 变化不应重置 mode / 重弹草稿提示（见下方独立 effect）。
  useEffect(() => {
    setMode("visual");
    const stored = readDraft(noteId);
    setPendingRecover(stored !== null && stored !== rawContent ? stored : null);
    // rawContent 仅此处用作对比基线，不纳入依赖（避免保存后 rawContent 变重弹提示）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // 外部 rawContent 变化（保存后/读盘刷新）→ 同步 draft；不动 mode、不触发草稿检测
  useEffect(() => {
    setDraft(rawContent);
  }, [rawContent]);

  // 草稿自动存（debounce 3s）；cleanup 只清 timer，落盘交由下方「卸载/换 note」effect 兜底，
  // 避免 draft 变化触发 cleanup 把 debounce 废掉（每次按键都写盘）。
  useEffect(() => {
    const timer = setTimeout(() => writeDraft(noteId, draft), 3000);
    return () => clearTimeout(timer);
  }, [noteId, draft]);

  // 卸载 / 换 note 前同步落盘：兜底 < 3s 编辑丢失（Esc 关 tab、Drawer 关闭、切 tab）。
  // **只在「编辑过」（draft !== rawContent）才写**：避免每打开一篇笔记都往 localStorage 留正文副本，
  // 也防 discardDraft 后被 cleanup 重写（discard 后 draft 仍===rawContent，不写）。
  // cleanup 用闭包 noteId（旧值，恰好对应该次编辑）+ draftRef/rawContentRef.current（渲染体已同步）。
  useEffect(() => {
    return () => {
      if (draftRef.current !== rawContentRef.current) {
        writeDraft(noteId, draftRef.current);
      }
    };
  }, [noteId]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.saveNoteBody(noteId, draft);
      clearDraft(noteId); // 已落盘，不再需要缓存
      onSave(updated);
      message.success("已保存（自动备份到 .helmose/backup）");
    } catch (e) {
      notifyError("保存", e);
    } finally {
      setSaving(false);
    }
  };

  // md 源码 textarea 键盘：Esc 退出、Cmd/Ctrl+S 保存（可视化侧由 RichEditor 拦截）
  const onTaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  };

  // 字数（去空白）/ 字符（含空白，UTF-16 码元数）/ 行
  const charsNoSpace = draft.replace(/\s/g, "").length;
  const totalChars = draft.length;
  const lineCount = draft.split("\n").length;

  // 恢复草稿：用 stored 覆盖 draft
  const recoverDraft = () => {
    if (pendingRecover !== null) setDraft(pendingRecover);
    setPendingRecover(null);
  };
  // 丢弃草稿：清 localStorage（保持 rawContent）
  const discardDraft = () => {
    clearDraft(noteId);
    setPendingRecover(null);
  };

  return (
    <div>
      {/* 顶部行：左模式切换 / 右保存取消 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 8,
        }}
      >
        <Segmented
          size="small"
          value={mode}
          onChange={(v) => setMode(v as EditMode)}
          options={[
            { label: "可视化", value: "visual" },
            { label: "md 化", value: "markdown" },
          ]}
        />
        <Space>
          <Button size="small" icon={<CloseOutlined />} onClick={onCancel}>
            取消
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={save}
          >
            保存
          </Button>
        </Space>
      </div>

      {/* 编辑区：可视化 = RichEditor（含工具栏 + wikilink 装饰 + Esc + 纯文本粘贴）；
          md 化 = textarea 源码（等宽，显示 ## ** [[]] 原文）。共享 draft，切换零丢字 */}
      {mode === "visual" ? (
        <RichEditor value={draft} onChange={setDraft} onSaveShortcut={save} onCancel={onCancel} />
      ) : (
        <div className="rich-editor-md-source">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onTaKeyDown}
            placeholder="直接编辑 markdown 源码（# 标题、** 粗体、- [ ] 任务、[[wikilink]]）"
          />
        </div>
      )}

      {/* 状态栏：字数/字符/行（两模式都显示，基于 draft 计算） */}
      <div className="editor-statusbar">
        字数 {charsNoSpace} · 字符 {totalChars} · 行 {lineCount}
      </div>

      {/* 草稿恢复提示：意外关闭后重开，localStorage 有未保存草稿则询问。
          maskClosable=false + keyboard=false 防误点遮罩 / 误按 Esc 丢弃草稿 */}
      <Modal
        open={pendingRecover !== null}
        title="检测到未保存的草稿"
        onOk={recoverDraft}
        onCancel={discardDraft}
        okText="恢复"
        cancelText="丢弃"
        maskClosable={false}
        keyboard={false}
      >
        该笔记有上次未保存的草稿（草稿{" "}
        {pendingRecover ? pendingRecover.replace(/\s/g, "").length : 0} 字，当前正文{" "}
        {rawContent.replace(/\s/g, "").length} 字）。恢复将用草稿替换当前正文，是否继续？
      </Modal>
    </div>
  );
}
