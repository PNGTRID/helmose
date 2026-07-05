// 任务页视图状态：当前视图 + 分组维度，localStorage 持久化。
// 仿 theme.ts 模式（localStorage 不可用时静默降级）。
// 四视图（list/kanban/matrix/timeline）+ 四分组维度（due/project/status/priority），
// 由 TasksPage 顶部 Segmented 切换，组件间共享无需 props 透传。
// 收口到 safeLocalStorage（B15）：safeReadWhitelist 校验枚举值，脏值/隐私模式回落默认。
import { create } from "zustand";
import { safeReadWhitelist, safeSetItem } from "../utils/safeLocalStorage";

export type TaskView = "list" | "kanban" | "matrix" | "timeline";
export type TaskGroupBy = "due" | "project" | "status" | "priority";

interface TaskViewState {
  view: TaskView;
  groupBy: TaskGroupBy;
  setView: (v: TaskView) => void;
  setGroupBy: (g: TaskGroupBy) => void;
}

const ALLOWED_VIEWS: readonly TaskView[] = ["list", "kanban", "matrix", "timeline"];
const ALLOWED_GROUPS: readonly TaskGroupBy[] = ["due", "project", "status", "priority"];
const STORAGE_KEY = "helmose-task-view";
const GROUP_KEY = "helmose-task-groupby";

function readView(): TaskView {
  return safeReadWhitelist(STORAGE_KEY, ALLOWED_VIEWS, "list");
}

function readGroupBy(): TaskGroupBy {
  return safeReadWhitelist(GROUP_KEY, ALLOWED_GROUPS, "due");
}

function persist(key: string, value: string) {
  safeSetItem(key, value);
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
