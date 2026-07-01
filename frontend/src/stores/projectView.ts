// 项目页视图状态：当前视图，localStorage 持久化（仿 taskView.ts / theme.ts 模式）。
// 五视图（kanban/list/grid/progress/owner），由 ProjectsPage 顶部 Segmented 切换。

import { create } from "zustand";

export type ProjectView = "kanban" | "list" | "grid" | "progress" | "owner";

interface ProjectViewState {
  view: ProjectView;
  setView: (v: ProjectView) => void;
}

const STORAGE_KEY = "helmose-projects-view";

function readView(): ProjectView {
  if (typeof localStorage === "undefined") return "kanban";
  const saved = localStorage.getItem(STORAGE_KEY) as ProjectView | null;
  if (
    saved === "kanban" ||
    saved === "list" ||
    saved === "grid" ||
    saved === "progress" ||
    saved === "owner"
  ) {
    return saved;
  }
  return "kanban";
}

function persist(value: string) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* localStorage 不可用时静默（隐私模式等） */
  }
}

export const useProjectViewStore = create<ProjectViewState>((set) => ({
  view: readView(),
  setView: (v) => {
    persist(v);
    set({ view: v });
  },
}));
