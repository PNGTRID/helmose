// 抽屉内嵌 WYSIWYG 编辑器（不跳 tab）：日志/今日/项目长文就地编辑。
// 顶部按 note_type 渲染字段表单（项目→状态/主线/优先级/OKR；日志→日期），下方 RichEditor 编辑正文。
// 打开时取单篇全文 → NoteEditor 编辑 → 保存走 saveNoteBody（带备份 + 拼 fm 保护）。
// save / 字段改动 后 note id 会变（content_hash 变），用 key={id} 让子组件重新挂载用新数据。
import { useEffect, useState } from "react";
import { Drawer, Spin } from "antd";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import NoteEditor from "./NoteEditor";
import NoteFieldsForm from "./NoteFieldsForm";
import type { NoteContent } from "../types";

interface Props {
  open: boolean;
  noteId: string | null;
  onClose: () => void;
  /** 保存成功回调（父组件可做 message / 额外刷新） */
  onSaved?: (updated: NoteContent) => void;
}

export default function NoteEditorDrawer({ open, noteId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<NoteContent | null>(null);

  // 打开/切换 noteId 时拉取全文
  useEffect(() => {
    if (!open || !noteId) {
      setContent(null);
      return;
    }
    setLoading(true);
    api
      .getNoteContent(noteId)
      .then((nc) => setContent(nc))
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [open, noteId]);

  const bumpTick = () => useVaultStore.setState((s) => ({ watcherTick: s.watcherTick + 1 }));

  const handleSave = (updated: NoteContent) => {
    // 用新 NoteContent 更新（id + raw 都变；key 变 → 子组件重新挂载用新数据）
    setContent(updated);
    onSaved?.(updated);
    // save 内部已增量索引；bump watcherTick 触发面板刷新（不调 index 全量，守性能）
    bumpTick();
  };

  // 字段表单改动：写入即索引（setTag/patchFrontmatter 内部 save 链路）→ bumpTick 触发各页刷新
  // （不调 onSaved：onSaved 语义是「正文 save」，字段改动走 bumpTick 即可让依赖 watcherTick 的页面刷新）
  const handleFieldChanged = () => {
    bumpTick();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={content?.title || content?.rel_path || "编辑笔记"}
      width="60%"
      destroyOnClose
      mask={false}
    >
      {loading || !content ? (
        <Spin />
      ) : (
        <>
          {/* 字段表单（项目→状态/主线/优先级/OKR；日志→日期；其他隐藏）。key 随 id 重挂载 */}
          <NoteFieldsForm
            key={content.id}
            noteId={content.id}
            noteType={content.note_type ?? null}
            tags={content.tags ?? []}
            frontmatter={(content.frontmatter as Record<string, unknown>) ?? {}}
            onChanged={handleFieldChanged}
          />
          {/* 正文 WYSIWYG 编辑器。key 随 id 重挂载（save 后 id 变） */}
          <NoteEditor
            key={content.id}
            noteId={content.id}
            rawContent={content.raw_content}
            onSave={(updated) => handleSave(updated)}
            onCancel={onClose}
          />
        </>
      )}
    </Drawer>
  );
}
