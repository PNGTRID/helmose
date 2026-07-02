// 任务页视图状态：当前视图 + 分组维度，localStorage 持久化。
// 仿 theme.ts 模式（localStorage 不可用时静默降级）。
// 四视图（list/kanban/matrix/timeline）+ 四分组维度（due/project/status/priority），
// 由 TasksPage 顶部 Segmented 切换，组件间共享无需 props 透传。

import { create } from "zustand";

export type TaskView = "list" | "kanban" | "matrix" | "timeline";
export type TaskGroupBy = "due" | "project" | "status" | "priority";

interface TaskViewState {
  view: TaskView;
  groupBy: TaskGroupBy;
  setView: (v: TaskView) => void;
  setGroupBy: (g: TaskGroupBy) => void;
}

const STORAGE_KEY = "helmose-task-view";
const GROUP_KEY = "helmose-task-groupby";

function readView(): TaskView {
  if (typeof localStorage === "undefined") return "list";
  const saved = localStorage.getItem(STORAGE_KEY) as TaskView | null;
  if (saved === "list" || saved === "kanban" || saved === "matrix" || saved === "timeline") return saved;
  return "list";
}

function readGroupBy(): TaskGroupBy {
  if (typeof localStorage === "undefined") return "due";
  const saved = localStorage.getItem(GROUP_KEY) as TaskGroupBy | null;
  if (saved === "due" || saved === "project" || saved === "status" || saved === "priority") return saved;
  return "due";
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage 不可用时静默（隐私模式等） */
  }
}

export const useTaskViewStore = create<TaskViewState>((set) => ({
  view: readView(),
  groupBy: readGroupBy(),
  setView: (v) => {
    persist(STORAGE_KEY, v);
    set({ view: v });
  },
  setGroupBy: (g) => {
    persist(GROUP_KEY, g);
    set({ groupBy: g });
  },
}));
