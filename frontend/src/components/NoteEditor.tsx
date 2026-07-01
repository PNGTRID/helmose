// 笔记编辑模式：Tiptap WYSIWYG 富文本编辑（所见即所得，不显示 ## ** 等 md 符号）+ 保存/取消。
// rawContent 是「去 fm 正文」（与 getNoteContent 同源），RichEditor 只编辑正文；
// 保存走 api.saveNoteBody（读盘拼回原 frontmatter，不丢 type/tags/created），成功后回调 onSave(updated)。
// Ctrl/Cmd+S 快捷保存（RichEditor 内 handleKeyDown 拦截 → onSaveShortcut）。
import { useState } from "react";
import { Button, Space, message } from "antd";
import { CloseOutlined, SaveOutlined } from "@ant-design/icons";
import * as api from "../api";
import type { NoteContent } from "../types";
import RichEditor from "./RichEditor";

interface Props {
  noteId: string;
  rawContent: string;
  onSave: (updated: NoteContent) => void;
  onCancel: () => void;
}

export default function NoteEditor({ noteId, rawContent, onSave, onCancel }: Props) {
  // 挂载时以 rawContent（正文）初始化 draft
  const [draft, setDraft] = useState(rawContent);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      // saveNoteBody：读盘取原 fm → 拼接新正文 → 备份 + 写盘 + 增量索引（不丢 frontmatter）
      const updated = await api.saveNoteBody(noteId, draft);
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
      <RichEditor value={draft} onChange={setDraft} onSaveShortcut={save} />
    </div>
  );
}
