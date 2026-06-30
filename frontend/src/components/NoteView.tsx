// 单笔记视图（容器）：加载内容/反链 + 阅读·编辑切换 + outline/backlink 同步。
// 编辑态组合 <NoteEditor>，阅读态组合 <NotePreview>。从 205 行胖组件重构为协调者。
import { useEffect, useState } from "react";
import { Segmented, Spin } from "antd";
import * as api from "../api";
import { useTabsStore } from "../stores/tabs";
import { extractOutline } from "../utils/note";
import NoteEditor from "./NoteEditor";
import NotePreview from "./NotePreview";
import type { NoteContent } from "../types";

export default function NoteView({ noteId }: { noteId: string }) {
  const setActiveNoteData = useTabsStore((s) => s.setActiveNoteData);

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
        </span>
        <Segmented
          value={editing ? "edit" : "preview"}
          onChange={(v) => setEditing(String(v) === "edit")}
          options={[
            { label: "阅读", value: "preview" },
            { label: "编辑", value: "edit" },
          ]}
        />
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
