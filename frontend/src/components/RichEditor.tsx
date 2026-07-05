// WYSIWYG 富文本编辑器（Tiptap v3 + @tiptap/markdown 双向转换）。
// 编辑时直接看到渲染效果（标题/粗体/列表/任务复选框），不显示 ## ** 等符号；
// 对外仍是 markdown 字符串（onUpdate getMarkdown / setContent contentType markdown），
// 故 saveNoteContent / 后端索引 / md-preview 预览全链路零改动。
// 参考 KB_pngtrid RichEditor，去掉 image/video/mention，加 TaskList/TaskItem（vault 任务核心）。
//
// 防循环：外部 value 变化用 isExternalUpdate ref 守 setContent→onUpdate→onChange 死循环。
import "./RichEditor.css";
import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import RichEditorToolbar from "./RichEditorToolbar";
import WikilinkDecorations from "./WikilinkDecorations";
import { useWikilinkNavigation } from "../hooks/useWikilinkNavigation";

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
  /** Esc 退出编辑（父层 NoteEditor 注入，可视化模式生效） */
  onCancel?: () => void;
}

export default function RichEditor({ value, onChange, placeholder, onSaveShortcut, onCancel }: Props) {
  // 追踪是否外部触发的 setContent，避免 onChange 循环
  const isExternalUpdate = useRef(false);
  // 上一次同步给 editor 的 value，跳过重复 setContent
  const lastSyncedValue = useRef(value);
  // onSaveShortcut / onCancel 用 ref 透传进 editorProps.handleKeyDown，避免重建 editor
  const saveRef = useRef(onSaveShortcut);
  saveRef.current = onSaveShortcut;
  const escRef = useRef(onCancel);
  escRef.current = onCancel;
  // editor 实例透传给 handlePaste：editorProps 配置时 editor 还未返回，用 ref 在 editor 创建后填充；
  // 运行时（用户粘贴）必已就绪。insertContent 正确处理多行（按行建段落）。
  const editorRef = useRef<Editor | null>(null);
  // wikilink 可点跳转：点击 .helmose-wikilink → 全库搜 target → 跳转（复用统一 hook）
  const { handleClick: handleWikilinkClick } = useWikilinkNavigation();
  // 跟踪 Shift 键状态（ClipboardEvent 无 shiftKey/getModifierState，纯文本粘贴靠全局 flag 判定）
  const shiftDownRef = useRef(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftDownRef.current = true;
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftDownRef.current = false;
    };
    // 失焦重置：窗口切走/失焦时 keyup 不触发，防 Shift 卡死永远 true（之后普通粘贴被误判为纯文本）。
    // 副作用：窗口外按住 Shift 切回粘贴会失效（退化为普通粘贴，安全降级）——DOM 规范限制，可接受。
    const onBlur = () => {
      shiftDownRef.current = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

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
      // wikilink 可点装饰（视图层高亮 [[x]] 为彩色链接，不改文档模型）
      WikilinkDecorations,
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
        // Esc → 退出编辑（父层 onCancel）
        if (event.key === "Escape") {
          event.preventDefault();
          escRef.current?.();
          return true;
        }
        return false;
      },
      // Ctrl/Cmd+Shift+V → 粘贴为纯文本（防外来富文本格式污染 vault 正文）。
      // ClipboardEvent 无 shiftKey（DOM 规范 ClipboardEvent 不继承 KeyboardEvent），用 shiftDownRef
      // （window keydown/keyup/blur 跟踪）判定。多行显式按行建段落（不依赖字符串 \n 解析，
      // 避免 ProseMirror 把单 \n 当 hardBreak 致 markdown 序列化后格式漂移）；单行作 text 入当前段。
      handlePaste(_view, event) {
        if (!shiftDownRef.current) return false;
        const editor = editorRef.current;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        // editor 未就绪或无文本 → 不拦截，走默认粘贴（防 preventDefault 后内容丢失）
        if (!editor || !text) return false;
        event.preventDefault();
        const lines = text.replace(/\r\n/g, "\n").split("\n");
        if (lines.length === 1) {
          editor.commands.insertContent(lines[0]);
        } else {
          editor.commands.insertContent(
            lines.map((line) => ({
              type: "paragraph",
              content: line ? [{ type: "text", text: line }] : [],
            }))
          );
        }
        return true;
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

  // editor 创建后透传给 handlePaste（ref 填充，运行时粘贴读取）
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

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
    <div
      className="rich-editor"
      onClick={(e) => {
        // 仅 Ctrl/Cmd+Click 跳转 wikilink（普通单击让 ProseMirror 定位光标，允许在可视化模式编辑 [[x]] 文字）
        if (!(e.metaKey || e.ctrlKey)) return;
        void handleWikilinkClick(e);
      }}
    >
      <RichEditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
