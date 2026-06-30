// 笔记域纯函数：大纲提取 + 打开笔记便捷封装（消除各处 openNote 字段映射重复）
import { useTabsStore, type OutlineItem } from "../stores/tabs";

/** 从 raw_content 提取 H1-H3 大纲（供右面板） */
export function extractOutline(raw: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) out.push({ level: m[1].length, text: m[2].trim() });
  }
  return out;
}

/** 打开笔记的便捷封装：消除各处 {id,title,file_name,rel_path} 字段映射重复。
 *  内部仍走 useTabsStore.openNote，跳转语义不变；title 缺失由 store 现有逻辑兜底（用 file_name）。 */
export function openNoteFromMeta(meta: {
  id: string;
  title: string | null;
  file_name: string;
  rel_path: string;
}): void {
  useTabsStore.getState().openNote(meta);
}
