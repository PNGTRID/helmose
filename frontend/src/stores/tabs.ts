// 标签页状态（Obsidian 式多 tab）：tabs + 激活 + 面板折叠 + active note 共享数据

import { create } from 'zustand';
import type { Backlink } from '../types';

export type TabType = 'note' | 'graph' | 'today' | 'tasks' | 'settings' | 'projects' | 'calendar' | 'journal' | 'planner';

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  noteId?: string;
}

export interface OutlineItem {
  level: number;
  text: string;
}

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  filePanelOpen: boolean;
  sidePanelOpen: boolean;
  /** 命令面板开关（Ribbon + Ctrl+P + App 共享） */
  paletteOpen: boolean;
  /** 当前 active note 的共享数据（NoteView 写，SidePanel 读，避免重复请求） */
  activeOutline: OutlineItem[];
  activeBacklinks: Backlink[];

  openNote: (n: { id: string; title: string | null; file_name: string; rel_path: string }) => void;
  openView: (type: TabType, title: string) => void;
  close: (id: string) => void;
  closeOthers: (keepId: string) => void;
  closeToRight: (id: string) => void;
  closeAll: () => void;
  activate: (id: string) => void;
  toggleFile: () => void;
  toggleSide: () => void;
  setPalette: (b: boolean) => void;
  setActiveNoteData: (outline: OutlineItem[], backlinks: Backlink[]) => void;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,
  filePanelOpen: true,
  sidePanelOpen: true,
  paletteOpen: false,
  activeOutline: [],
  activeBacklinks: [],

  openNote: (n) => {
    const id = `note:${n.id}`;
    const tabs = get().tabs;
    if (tabs.find((t) => t.id === id)) {
      set({ activeId: id });
      return;
    }
    set({
      tabs: [...tabs, { id, type: 'note', title: n.title ?? n.file_name, noteId: n.id }],
      activeId: id,
    });
  },

  openView: (type, title) => {
    const id = `view:${type}`;
    const tabs = get().tabs;
    if (tabs.find((t) => t.id === id)) {
      set({ activeId: id });
      return;
    }
    set({ tabs: [...tabs, { id, type, title }], activeId: id });
  },

  close: (id) => {
    const all = get().tabs;
    const idx = all.findIndex((t) => t.id === id);
    const tabs = all.filter((t) => t.id !== id);
    let activeId = get().activeId;
    if (activeId === id) {
      activeId = tabs.length ? tabs[Math.min(idx, tabs.length - 1)].id : null;
    }
    set({ tabs, activeId });
  },

  closeOthers: (keepId) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id === keepId);
      const activeId =
        s.activeId && tabs.some((t) => t.id === s.activeId) ? s.activeId : keepId;
      return { tabs, activeId };
    }),

  closeToRight: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return s;
      const tabs = s.tabs.slice(0, idx + 1);
      const activeId = tabs.some((t) => t.id === s.activeId) ? s.activeId : id;
      return { tabs, activeId };
    }),

  closeAll: () => set({ tabs: [], activeId: null }),

  activate: (id) => set({ activeId: id }),
  toggleFile: () => set((s) => ({ filePanelOpen: !s.filePanelOpen })),
  toggleSide: () => set((s) => ({ sidePanelOpen: !s.sidePanelOpen })),
  setPalette: (b) => set({ paletteOpen: b }),
  setActiveNoteData: (outline, backlinks) => set({ activeOutline: outline, activeBacklinks: backlinks }),
}));
