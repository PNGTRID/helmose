// 拉取当前 vault 的 active 项目列表（共享数据源）。
// 多个 Modal（QuickAddTask / Event / Project / NewEvent）共用，避免每个组件各自 invoke。
// cancelled flag 守竞态：useEffect cleanup 时丢弃过期响应（memory 教训，与 useAllNotesMeta 一致）。
import { useEffect, useState } from "react";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import type { Project } from "../types";

export interface UseActiveProjectsResult {
  projects: Project[];
  loading: boolean;
}

/**
 * 拉项目列表（默认全部，不筛 status）。watcherTick 变化时重拉（增量索引后列表自动刷新）。
 * 默认全部是为了让快速添加/关联项目时能选到筹备中/暂停的项目（非仅 active）。
 * @param status 可选筛选（如 'active' 只看活跃项目）；不传拉全部。
 */
export function useActiveProjects(status?: string): UseActiveProjectsResult {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    setLoading(true);
    api
      .getProjects(vault.id, status)
      .then((res) => {
        if (!cancelled) setProjects(res);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[useActiveProjects] 加载失败", e);
        setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, status, watcherTick]);

  return { projects, loading };
}
