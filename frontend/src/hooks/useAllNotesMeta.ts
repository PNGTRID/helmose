// 全量笔记元数据 hook：加载 vault 所有 NoteMeta（无正文，1.9 万文件不爆 IPC）。
// CalendarPage / JournalPage 共用，消除重复全量拉取；watcherTick 驱动刷新。
// 错误不静默：console.error + 暴露 error，让调用方区分「空数据」与「加载失败」。
import { useEffect, useState } from "react";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import type { NoteMeta } from "../types";

export interface AllNotesMetaState {
  notes: NoteMeta[];
  loading: boolean;
  error: string | null;
}

export function useAllNotesMeta(): AllNotesMetaState {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vault) return;
    // cancelled flag：watcherTick 快速变化或组件卸载时，丢弃过期的 fetch 响应，
    // 避免旧数据覆盖新数据（竞态）及卸载后无效 setState。
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listAllNotesMeta(vault.id)
      .then((res) => {
        if (cancelled) return;
        setNotes(res);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[useAllNotesMeta] 加载笔记元数据失败", e);
        setNotes([]);
        setError(typeof e === "string" ? e : (e?.message ?? String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  return { notes, loading, error };
}
