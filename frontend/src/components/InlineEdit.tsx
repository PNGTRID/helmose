// 行内编辑：display 模式显示文本，点击变输入框；回车提交 onSave、Esc 取消。
// 纯展示组件（数据/保存逻辑由父组件通过 onSave 注入），task/event 文本就地编辑共用。
// 单行：回车提交；multiline：Cmd/Ctrl+Enter 提交、回车换行。失焦自动提交。
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Input } from "antd";

interface Props {
  value: string;
  onSave: (newText: string) => Promise<void> | void;
  multiline?: boolean;
  /** display 模式自定义渲染（默认直接显示 value） */
  renderDisplay?: (value: string) => ReactNode;
}

export default function InlineEdit({ value, onSave, multiline, renderDisplay }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  // 外部 value 变化（如保存后刷新）同步 draft
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const start = () => {
    setDraft(value);
    setEditing(true);
  };

  const submit = async () => {
    const t = draft.trim();
    // 空或未变 → 直接退出编辑（不报错、不调用 onSave）
    if (t === value || t === "") {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(t);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    if (multiline) {
      return (
        <Input.TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          autoSize={{ minRows: 1, maxRows: 6 }}
          disabled={saving}
          size="small"
          style={{ width: "100%" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          onBlur={() => void submit()}
        />
      );
    }
    return (
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        disabled={saving}
        size="small"
        style={{ flex: 1 }}
        onPressEnter={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => void submit()}
      />
    );
  }

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        start();
      }}
      style={{ cursor: "text", display: "inline-block", width: "100%", minHeight: "1em" }}
      title="点击编辑"
    >
      {renderDisplay
        ? renderDisplay(value)
        : value || <span style={{ opacity: 0.4 }}>（空）</span>}
    </span>
  );
}
