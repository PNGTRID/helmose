// 笔记编辑模式：CodeMirror + marked 实时预览分屏 + 保存/取消。从 NoteView 拆出。
// save 走 api.saveNoteContent（写 vault + .helmose/backup 备份），成功后回调 onSave(updated)。
import "./NoteEditor.css";
import { useState } from "react";
import { Button, Space, message } from "antd";
import { CloseOutlined, SaveOutlined } from "@ant-design/icons";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { keymap } from "@codemirror/view";
import { marked } from "marked";
import * as api from "../api";
import { useThemeStore } from "../stores/theme";
import type { NoteContent } from "../types";

interface Props {
  noteId: string;
  rawContent: string;
  onSave: (updated: NoteContent) => void;
  onCancel: () => void;
}

export default function NoteEditor({ noteId, rawContent, onSave, onCancel }: Props) {
  // 挂载时以 rawContent 初始化 draft（等价原 NoteView 切编辑时的 setDraft(content.raw_content)）
  const [draft, setDraft] = useState(rawContent);
  const [saving, setSaving] = useState(false);
  const appTheme = useThemeStore((s) => s.theme);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.saveNoteContent(noteId, draft);
      onSave(updated);
      message.success("已保存（自动备份到 .helmose/backup）");
    } catch (e) {
      message.error(`保存失败：${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
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
      <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
        <div className="ob-editor-wrap" style={{ flex: 1, minWidth: 0 }}>
          <CodeMirror
            value={draft}
            onChange={(val) => setDraft(val)}
            extensions={[
              markdown({ base: markdownLanguage }),
              keymap.of([
                { key: "Mod-s", preventDefault: true, run: () => { void save(); return true; } },
              ]),
            ]}
            theme={appTheme === "dark" ? "dark" : "light"}
            basicSetup={{
              lineNumbers: false,
              foldGutter: true,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
            }}
            style={{
              fontSize: 14,
              fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
            }}
          />
        </div>
        <div
          className="ob-preview-pane"
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "auto",
            border: "1px solid var(--ob-border)",
            borderRadius: 6,
            padding: 20,
            background: "var(--ob-bg)",
          }}
        >
          <div
            className="md-preview"
            dangerouslySetInnerHTML={{ __html: marked.parse(draft) as string }}
          />
        </div>
      </div>
    </div>
  );
}
