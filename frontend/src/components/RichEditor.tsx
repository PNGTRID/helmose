// WYSIWYG 富文本编辑器（Tiptap v3 + @tiptap/markdown 双向转换）。
// 编辑时直接看到渲染效果（标题/粗体/列表/任务复选框），不显示 ## ** 等符号；
// 对外仍是 markdown 字符串（onUpdate getMarkdown / setContent contentType markdown），
// 故 saveNoteContent / 后端索引 / md-preview 预览全链路零改动。
// 参考 KB_pngtrid RichEditor，去掉 image/video/mention，加 TaskList/TaskItem（vault 任务核心）。
//
// 防循环：外部 value 变化用 isExternalUpdate ref 守 setContent→onUpdate→onChange 死循环。
import "./RichEditor.css";
import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import RichEditorToolbar from "./RichEditorToolbar";

/** 还原 @tiptap/markdown 对 wikilink 成对括号的转义。
 *  @tiptap/markdown 序列化会对非代码文本的 [] 反斜杠转义（escapeMarkdownSyntax），
 *  把 helmose 的 [[wikilink]] / [[x|alias]] 变成 \[\[x\]\]，indexer wikilinks 正则不认转义形式
 *  → 双链/反链/图谱全断 + 破坏 vault 原文（违反铁律2）。
 *  精确匹配成对的 \[\[ 与 \]\]（两个连续转义括号 = wikilink），不误伤单个 \[（如字面数组 \[0\]）。 */
export function unescapeWikilink(md: string): string {
  return md.replace(/\\\[\\\[/g, "[[").replace(/\\\]\\\]/g, "]]");
}

interface Props {
  /** 当前 markdown 内容（受控） */
  value: string;
  /** 内容变化回调，输出 markdown */
  onChange: (md: string) => void;
  placeholder?: string;
  /** Ctrl/Cmd+S 快捷键保存（父层 NoteEditor 注入） */
  onSaveShortcut?: () => void;
}

export default function RichEditor({ value, onChange, placeholder, onSaveShortcut }: Props) {
  // 追踪是否外部触发的 setContent，避免 onChange 循环
  const isExternalUpdate = useRef(false);
  // 上一次同步给 editor 的 value，跳过重复 setContent
  const lastSyncedValue = useRef(value);
  // onSaveShortcut 用 ref 透传进 editorProps.handleKeyDown，避免重建 editor
  const saveRef = useRef(onSaveShortcut);
  saveRef.current = onSaveShortcut;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: "tiptap-code-block" } },
      }),
      Markdown,
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "开始书写…（# 标题、** 粗体、- 任务）" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // GFM 表格（含表头/行/单元格，@tiptap/markdown 序列化为 | a | b |）
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // 双类：tiptap-content 给 ProseMirror 专属样式，md-preview 复用 index.css 全套排版
        class: "tiptap-content md-preview",
      },
      handleKeyDown(_view, event) {
        // Mod（Cmd/Ctrl）+ S → 保存（阻止浏览器默认）
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          saveRef.current?.();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (isExternalUpdate.current) {
        isExternalUpdate.current = false;
        return;
      }
      // 还原 wikilink 被转义的成对括号（见 unescapeWikilink 注释），保护双链 + vault 原文
      const md = unescapeWikilink(ed.getMarkdown());
      lastSyncedValue.current = md;
      onChange(md);
    },
  });

  // 外部 value 变化 → 反向同步进编辑器（跳过自身 onChange 触发的变化）
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value === lastSyncedValue.current) return;
    isExternalUpdate.current = true;
    editor.commands.setContent(value, { contentType: "markdown" });
    lastSyncedValue.current = value;
    setTimeout(() => {
      isExternalUpdate.current = false;
    }, 0);
  }, [value, editor]);

  return (
    <div className="rich-editor">
      <RichEditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
