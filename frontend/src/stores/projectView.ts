// 项目页视图状态：当前视图，localStorage 持久化（仿 taskView.ts / theme.ts 模式）。
// 五视图（kanban/list/grid/progress/owner），由 ProjectsPage 顶部 Segmented 切换。
// 收口到 safeLocalStorage（B15）：safeReadWhitelist 校验枚举值，脏值/隐私模式回落默认 kanban。
import { create } from "zustand";
import { safeReadWhitelist, safeSetItem } from "../utils/safeLocalStorage";

export type ProjectView = "kanban" | "list" | "grid" | "progress" | "owner";

const ALLOWED_VIEWS = ["kanban", "list", "grid", "progress", "owner"] as const;
const STORAGE_KEY = "helmose-projects-view";

interface ProjectViewState {
  view: ProjectView;
  setView: (v: ProjectView) => void;
}

function readView(): ProjectView {
  return safeReadWhitelist(STORAGE_KEY, ALLOWED_VIEWS, "kanban");
}

function persist(value: string) {
  safeSetItem(STORAGE_KEY, value);
}

export const useProjectViewStore = create<ProjectViewState>((set) => ({
  view: readView(),
  setView: (v) => {
    persist(v);
    set({ view: v });
  },
}));
