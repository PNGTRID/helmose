// 笔记域纯函数：大纲提取 + 打开笔记便捷封装（消除各处 openNote 字段映射重复）
import { useTabsStore, type OutlineItem } from "../stores/tabs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import type { NoteContent } from "../types";

/** 打开或创建今日笔记（后端 create_today_note 封装路径/查已有/模板）。
 *  TodayPage 按钮、命令面板、Ctrl+J 快捷键共用。成功后开 tab + 重新索引刷新面板。 */
export async function openOrCreateTodayNote(opts?: {
  onCreated?: () => void;
}): Promise<void> {
  const v = useVaultStore.getState().vault;
  if (!v) return;
  const nc: NoteContent = await api.createTodayNote(v.id);
  useTabsStore.getState().openNote({
    id: nc.id,
    title: nc.title ?? nc.rel_path.split("/").pop() ?? "今日笔记",
    file_name: nc.rel_path.split("/").pop() ?? "",
    rel_path: nc.rel_path,
  });
  // 重新索引让新笔记进入各面板列表
  await useVaultStore.getState().index();
  opts?.onCreated?.();
}

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
