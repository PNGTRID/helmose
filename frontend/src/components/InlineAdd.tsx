// 行内新建：单输入框 + Plus 前缀，回车提交 onAdd 并清空。
// task/event 顶部就地新建共用。纯展示组件（保存逻辑由父组件注入）。
import { useState } from "react";
import type { CSSProperties } from "react";
import { Input } from "antd";
import { PlusOutlined } from "@ant-design/icons";

interface Props {
  placeholder: string;
  onAdd: (text: string) => Promise<void> | void;
  /** 容器额外样式（如 marginTop） */
  style?: CSSProperties;
}

export default function InlineAdd({ placeholder, onAdd, style }: Props) {
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setAdding(true);
    try {
      await onAdd(t);
      setText("");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Input
      size="small"
      prefix={<PlusOutlined style={{ color: "var(--ob-text-light)" }} />}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onPressEnter={(e) => {
        e.preventDefault();
        void submit();
      }}
      disabled={adding}
      style={style}
    />
  );
}
