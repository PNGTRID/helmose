// wikilink 跳转统一 hook：点击 .helmose-wikilink → 全库搜 target → 跳转/回调。
// 消除 NoteView.onPreviewClick 与 TasksPage.onDrawerClick 的重复；行为对齐现状：
// 失败静默、未命中不报错。默认行为 openNote（NoteView 阅读视图用）；
// 传 onNavigate 时由调用方决定（TasksPage Drawer 替换内容用）。
import type { MouseEvent } from "react";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { openNoteFromMeta } from "../utils/note";
import type { SearchResult } from "../types";

export function useWikilinkNavigation(opts?: {
  onNavigate?: (hit: SearchResult) => void | Promise<void>;
}): {
  handleClick: (e: MouseEvent<HTMLElement>) => Promise<void>;
} {
  const vault = useVaultStore((s) => s.vault);
  const onNavigate = opts?.onNavigate;

  const handleClick = async (e: MouseEvent<HTMLElement>) => {
    if (!vault) return;
    const el = (e.target as HTMLElement).closest(".helmose-wikilink") as HTMLElement | null;
    if (!el) return;
    e.preventDefault();
    const name = el.dataset.target;
    if (!name) return;
    try {
      const hits = await api.searchNotes(vault.id, name, 1);
      if (hits[0]) {
        if (onNavigate) {
          await onNavigate(hits[0]);
        } else {
          openNoteFromMeta(hits[0]);
        }
      }
    } catch {
      /* 忽略：与现状一致 */
    }
  };

  return { handleClick };
}
