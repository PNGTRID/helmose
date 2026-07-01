// 单笔记视图（容器）：加载内容/反链 + 阅读·编辑切换 + outline/backlink 同步。
// 编辑态组合 <NoteEditor>，阅读态组合 <NotePreview>。从 205 行胖组件重构为协调者。
import { useEffect, useState } from "react";
import { Popconfirm, Segmented, Spin, message } from "antd";
import { CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import * as api from "../api";
import { useTabsStore } from "../stores/tabs";
import { useVaultStore } from "../stores/vault";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { extractOutline } from "../utils/note";
import NoteEditor from "./NoteEditor";
import NotePreview from "./NotePreview";
import type { NoteContent } from "../types";

export default function NoteView({ noteId }: { noteId: string }) {
  const setActiveNoteData = useTabsStore((s) => s.setActiveNoteData);
  const closeTab = useTabsStore((s) => s.close);
  const indexVault = useVaultStore((s) => s.index);
  const { notes } = useAllNotesMeta();
  const noteDate = notes.find((n) => n.id === noteId)?.date_iso;

  const [content, setContent] = useState<NoteContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setLoading(true);
    setEditing(false);
    Promise.all([
      api.getNoteContent(noteId).catch(() => null),
      api.getBacklinks(noteId).catch(() => []),
    ])
      .then(([c, bl]) => {
        setContent(c);
        setActiveNoteData(c ? extractOutline(c.raw_content) : [], bl ?? []);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // NoteEditor 保存成功回调：更新内容 + 同步 outline（反链维持现有）+ 退回阅读态
  const onSave = (updated: NoteContent) => {
    setContent(updated);
    setActiveNoteData(
      extractOutline(updated.raw_content),
      useTabsStore.getState().activeBacklinks
    );
    setEditing(false);
  };

  // 删除笔记（软删除到 .helmose/trash 可恢复）+ 关 tab + 重新索引刷新
  const onDelete = async () => {
    try {
      await api.deleteNote(noteId);
      message.success("已删除（移到 .helmose/trash，可恢复）");
      closeTab(`note:${noteId}`);
      await indexVault();
    } catch (e) {
      message.error(`删除失败：${e}`);
    }
  };

  if (loading || !content) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <Spin />
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "var(--ob-text-faint)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {content.rel_path}
          {noteDate ? ` · ${noteDate}` : ""} · {content.raw_content.replace(/\s/g, "").length} 字
          · ~{Math.max(1, Math.ceil(content.raw_content.replace(/\s/g, "").length / 300))} 分钟
          · {(content.raw_content.match(/\[\[/g) || []).length} 双链
        </span>
        <Segmented
          value={editing ? "edit" : "preview"}
          onChange={(v) => setEditing(String(v) === "edit")}
          options={[
            { label: "阅读", value: "preview" },
            { label: "编辑", value: "edit" },
          ]}
        />
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
      </div>

      {editing ? (
        <NoteEditor
          noteId={noteId}
          rawContent={content.raw_content}
          onSave={onSave}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <NotePreview html={content.html} />
      )}
    </div>
  );
}
