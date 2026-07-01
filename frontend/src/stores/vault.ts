// Vault 状态管理（Zustand）：当前 vault + 索引状态 + 文件监听 tick

import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import * as api from '../api';
import type { IndexStats, Vault } from '../types';

interface VaultState {
  vault: Vault | null;
  loading: boolean;
  indexing: boolean;
  stats: IndexStats | null;
  error: string | null;
  /** 文件监听变化自增（增量索引后数据已变），驱动面板刷新 */
  watcherTick: number;

  load: () => Promise<void>;
  setVault: (v: Vault | null) => void;
  index: () => Promise<IndexStats | null>;
  /** 手动 bump watcherTick（写后触发面板刷新，与 vault-changed 监听同效） */
  bumpTick: () => void;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vault: null,
  loading: true,
  indexing: false,
  stats: null,
  error: null,
  watcherTick: 0,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const v = await api.getDefaultVault();
      set({ vault: v, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  setVault: (v) => set({ vault: v }),

  bumpTick: () => set((s) => ({ watcherTick: s.watcherTick + 1 })),

  index: async () => {
    const v = get().vault;
    if (!v) return null;
    set({ indexing: true, error: null });
    try {
      const stats = await api.indexVault(v.id);
      // 索引完成后 bump watcherTick，触发 FilePanel 等面板重新拉取最新数据
      set((s) => ({ stats, indexing: false, watcherTick: s.watcherTick + 1 }));
      return stats;
    } catch (e) {
      set({ indexing: false, error: String(e) });
      return null;
    }
  },
}));

// 文件监听：vault 内 md 变化（增量索引）→ watcherTick 自增，面板据此刷新。
// 纯浏览器环境（非 Tauri）listen 会失败，捕获忽略。
listen('vault-changed', () => {
  useVaultStore.setState((s) => ({ watcherTick: s.watcherTick + 1 }));
}).catch(() => {});
