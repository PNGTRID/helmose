// WYSIWYG 编辑器工具栏：撤销/重做、标题、粗斜体代码引用、列表/任务列表、链接。
// 用 antd Button + @ant-design/icons，active 态高亮（editor.isActive 判定）。
// 纯命令转发组件：所有格式化由 editor.chain().focus().toggleX().run() 完成。
import { useState } from "react";
import { Button, Input, Modal, Tooltip, Divider } from "antd";
import {
  BoldOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  RedoOutlined,
  TableOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import type { Editor } from "@tiptap/react";

interface Props {
  editor: Editor | null;
}

/** 小工具按钮：active 高亮、disabled 置灰。统一 size/type，靠 title 悬浮提示。 */
function TBtn({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip title={title}>
      <Button
        size="small"
        type="text"
        disabled={disabled}
        onClick={onClick}
        style={{
          width: 28,
          height: 28,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: active ? "var(--ob-accent)" : "var(--ob-text)",
          background: active ? "var(--ob-accent-mod)" : "transparent",
        }}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

/** 标题按钮：用文本「正文/H1/H2/H3」。 */
function HTBtn({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <Tooltip title={title}>
      <Button
        size="small"
        type="text"
        onClick={onClick}
        style={{
          height: 28,
          padding: "0 8px",
          fontWeight: 600,
          fontSize: 13,
          color: active ? "var(--ob-accent)" : "var(--ob-text)",
          background: active ? "var(--ob-accent-mod)" : "transparent",
        }}
      >
        {label}
      </Button>
    </Tooltip>
  );
}

export default function RichEditorToolbar({ editor }: Props) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  if (!editor) return null;

  // 链接：先取当前选区已有的 url 预填，确定后 toggleLink
  const openLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    setLinkUrl(prev ?? "");
    setLinkOpen(true);
  };
  const confirmLink = () => {
    const url = linkUrl.trim();
    if (url) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    } else {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setLinkOpen(false);
  };

  return (
    <div
      className="rich-editor-toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap",
        padding: "6px 8px",
        borderBottom: "1px solid var(--ob-border)",
        background: "var(--ob-bg-mod)",
      }}
    >
      <TBtn title="撤销 (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
        <UndoOutlined />
      </TBtn>
      <TBtn title="重做 (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
        <RedoOutlined />
      </TBtn>

      <Divider type="vertical" style={{ margin: "0 4px" }} />

      <HTBtn label="正文" title="正文段落" active={editor.isActive("paragraph")} onClick={() => editor.chain().focus().setParagraph().run()} />
      <HTBtn label="H1" title="一级标题" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
      <HTBtn label="H2" title="二级标题" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <HTBtn label="H3" title="三级标题" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />

      <Divider type="vertical" style={{ margin: "0 4px" }} />

      <TBtn title="粗体 (Ctrl+B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <BoldOutlined />
      </TBtn>
      <TBtn title="斜体 (Ctrl+I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <ItalicOutlined />
      </TBtn>
      <TBtn title="行内代码" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
        <CodeOutlined />
      </TBtn>
      <TBtn title="引用块" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>”</span>
      </TBtn>

      <Divider type="vertical" style={{ margin: "0 4px" }} />

      <TBtn title="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <UnorderedListOutlined />
      </TBtn>
      <TBtn title="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <OrderedListOutlined />
      </TBtn>
      <TBtn title="任务列表（- [ ]）" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <CheckSquareOutlined />
      </TBtn>
      <TBtn title="插入表格（3×3，含表头）" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <TableOutlined />
      </TBtn>

      <Divider type="vertical" style={{ margin: "0 4px" }} />

      <TBtn title="链接" active={editor.isActive("link")} onClick={openLink}>
        <LinkOutlined />
      </TBtn>

      <Modal
        title="插入链接"
        open={linkOpen}
        onOk={confirmLink}
        onCancel={() => setLinkOpen(false)}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          autoFocus
          placeholder="https:// 或 [[wikilink]]"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          onPressEnter={confirmLink}
        />
      </Modal>
    </div>
  );
}
