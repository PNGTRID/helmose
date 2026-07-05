// 单笔记视图（容器）：加载内容/反链 + 顶栏元信息/操作组 + 始终编辑态（双模式在 NoteEditor 内部）。
// 从「阅读/编辑切换」重构为「始终编辑」：双模式（可视化/md化）下沉到 NoteEditor，
// NoteView 只管内容加载 + 顶栏（左元信息 / 右[复制+删除]操作组，复制删除相邻修复原错位）。
import { useEffect, useState } from "react";
import { Popconfirm, Space, Spin, message } from "antd";
import { CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import * as api from "../api";
import { notifyError } from "../utils/notifyError";
import { useTabsStore } from "../stores/tabs";
import { useVaultStore } from "../stores/vault";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { extractOutline } from "../utils/note";
import NoteEditor from "./NoteEditor";
import type { NoteContent } from "../types";

export default function NoteView({ noteId }: { noteId: string }) {
  const setActiveNoteData = useTabsStore((s) => s.setActiveNoteData);
  const closeTab = useTabsStore((s) => s.close);
  const indexVault = useVaultStore((s) => s.index);
  const { notes } = useAllNotesMeta();
  const noteDate = notes.find((n) => n.id === noteId)?.date_iso;

  const [content, setContent] = useState<NoteContent | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 竞态守卫：快速切 note 时旧请求晚到丢弃，防旧响应覆盖新 note 的内容/outline
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getNoteContent(noteId).catch((e) => {
        if (!cancelled) notifyError("加载笔记", e);
        return null;
      }),
      api.getBacklinks(noteId).catch((e) => {
        if (!cancelled) notifyError("加载反链", e);
        return [];
      }),
    ])
      .then(([c, bl]) => {
        if (cancelled) return;
        setContent(c);
        setActiveNoteData(c ? extractOutline(c.raw_content) : [], bl ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // NoteEditor 保存成功回调：更新内容 + 同步 outline（反链维持现有）
  const onSave = (updated: NoteContent) => {
    setContent(updated);
    setActiveNoteData(
      extractOutline(updated.raw_content),
      useTabsStore.getState().activeBacklinks
    );
  };

  // 取消 = 关闭 tab（双模式下无只读态可退）
  const onCancel = () => closeTab(`note:${noteId}`);

  // 删除笔记（软删除到 .helmose/trash 可恢复）+ 关 tab + 重新索引刷新
  const onDelete = async () => {
    try {
      await api.deleteNote(noteId);
      message.success("已删除（移到 .helmose/trash，可恢复）");
      closeTab(`note:${noteId}`);
      await indexVault();
    } catch (e) {
      notifyError("删除", e);
    }
  };

  if (loading || !content) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <Spin />
      </div>
    );
  }

  // 字数（去空白）：元信息口径与编辑器状态栏一致
  const charLen = content.raw_content.replace(/\s/g, "").length;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 12,
          gap: 8,
        }}
      >
        {/* 左：元信息（flex:1 + 溢出省略） */}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            color: "var(--ob-text-faint)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {content.rel_path}
          {noteDate ? ` · ${noteDate}` : ""} · {charLen} 字
          {" · ~"}{Math.max(1, Math.ceil(charLen / 300))} 分钟
          {" · "}{(content.raw_content.match(/\[\[/g) || []).length} 双链
        </span>
        {/* 右：操作组（复制 + 删除相邻，修复原 justify-between 把两按钮撑开的错位） */}
        <Space size={2}>
          <button
            type="button"
            aria-label="复制路径"
            title="复制相对路径"
            onClick={() => {
              navigator.clipboard?.writeText(content.rel_path).then(
                () => message.success("已复制路径"),
                () => {}
              );
            }}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--ob-text-faint)",
              padding: "0 4px",
            }}
          >
            <CopyOutlined />
          </button>
          <Popconfirm
            title="删除该笔记？"
            description="将移到 .helmose/trash（可恢复），不从磁盘硬删"
            onConfirm={onDelete}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <button
              type="button"
              aria-label="删除"
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--ob-text-faint)",
                padding: "0 4px",
              }}
            >
              <DeleteOutlined />
            </button>
          </Popconfirm>
        </Space>
      </div>

      {/* 始终编辑态（双模式可视化/md化 由 NoteEditor 内部 Segmented 控制） */}
      <NoteEditor
        noteId={noteId}
        rawContent={content.raw_content}
        onSave={onSave}
        onCancel={onCancel}
      />
    </div>
  );
}
