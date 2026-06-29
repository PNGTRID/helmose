// 单笔记视图（Obsidian 阅读视图 + 编辑模式）：主内容区渲染
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { Button, Segmented, Space, Spin, message } from "antd";
import { CloseOutlined, SaveOutlined } from "@ant-design/icons";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useTabsStore, type OutlineItem } from "../stores/tabs";
import type { NoteContent } from "../types";

/** 从 raw_content 提取 H1-H3 大纲（供右面板） */
function extractOutline(raw: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) out.push({ level: m[1].length, text: m[2].trim() });
  }
  return out;
}

export default function NoteView({ noteId }: { noteId: string }) {
  const vault = useVaultStore((s) => s.vault);
  const openNote = useTabsStore((s) => s.openNote);
  const setActiveNoteData = useTabsStore((s) => s.setActiveNoteData);

  const [content, setContent] = useState<NoteContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

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

  // wikilink 跳转 → 开新 tab（或在已开时激活）
  const onPreviewClick = async (e: MouseEvent<HTMLDivElement>) => {
    if (!vault) return;
    const el = (e.target as HTMLElement).closest(".helmose-wikilink") as HTMLElement | null;
    if (!el) return;
    e.preventDefault();
    const name = el.dataset.target;
    if (!name) return;
    try {
      const hits = await api.searchNotes(vault.id, name, 1);
      if (hits[0]) {
        openNote({
          id: hits[0].id,
          title: hits[0].title,
          file_name: hits[0].file_name,
          rel_path: hits[0].rel_path,
        });
      }
    } catch {
      /* 忽略 */
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.saveNoteContent(noteId, draft);
      setContent(updated);
      setActiveNoteData(
        extractOutline(updated.raw_content),
        useTabsStore.getState().activeBacklinks
      );
      setEditing(false);
      message.success("已保存（自动备份到 .helmose/backup）");
    } catch (e) {
      message.error(`保存失败：${e}`);
    } finally {
      setSaving(false);
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
          marginBottom: 16,
        }}
      >
        <Segmented
          value={editing ? "edit" : "preview"}
          onChange={(v) => {
            if (String(v) === "edit") {
              setDraft(content.raw_content);
              setEditing(true);
            } else {
              setEditing(false);
            }
          }}
          options={[
            { label: "阅读", value: "preview" },
            { label: "编辑", value: "edit" },
          ]}
        />
        {editing && (
          <Space>
            <Button size="small" icon={<CloseOutlined />} onClick={() => setEditing(false)}>
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
        )}
      </div>

      {editing ? (
        <textarea
          className="ob-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <div onClick={onPreviewClick}>
          <h1
            style={{
              fontSize: "1.9em",
              fontWeight: 700,
              marginBottom: 6,
              lineHeight: 1.2,
            }}
          >
            {content.title ?? noteId}
          </h1>
          <div
            className="md-preview"
            dangerouslySetInnerHTML={{ __html: content.html }}
          />
        </div>
      )}
    </div>
  );
}
