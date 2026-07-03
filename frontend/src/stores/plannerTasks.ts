// 今日计划页 · 任务状态 store（阶段 3b 从 PlannerPage 抽离）。
// 仅放跨子组件共享的 state（tasks/selectedAnchor/writing/loadError）+ setter。
//
// 设计约束（来自 plan 铁律）：
//   1. 派生 memo（urgencyMap/taskCat/buckets/childCountByTask/dueDateSet/topLevelTasks 等）
//      留 PlannerPage useMemo，不进 store——它们依赖 notes/projects 等 hook 数据，
//      且每次 tasks 变都要重算，进 store 会重复计算或丢失依赖。
//   2. 写回回调（onToggle/onQuadChange/onRebuild/onDescChange/onAddChild/onDelete/...）
//      留 PlannerPage 组件层，通过 props 传 DetailPanel——它们要用 antd App.useApp() 的 message
//      做 toast + api 写回 + 失败回滚。store 非组件层拿不到 useApp context，调 message 困难。
//   3. setTasks 签名与 useState setter 兼容（接受值或 (prev)=>next 函数），
//      PlannerPage 原 useState 改 store selector 后写回回调内部代码零改动。
//
// hasLoadedOnce（区分首次加载 vs 静默刷新，不触发渲染）留 PlannerPage useRef，不进 store。
import { create } from "zustand";
import type { Task } from "../types";
import type { SelectAnchor } from "../components/planner/constants";

interface PlannerTasksState {
  tasks: Task[];
  /** 选中锚点（relPath + sourceLine），跨写回稳定；详情面板靠它 resolve 当前 task */
  selectedAnchor: SelectAnchor | null;
  /** 写回中标志（防并发写：所有写回入口先判 writing） */
  writing: boolean;
  /** 首次加载失败标志（错误三态：区分「加载失败」与「真空」） */
  loadError: boolean;
  setTasks: (updater: Task[] | ((prev: Task[]) => Task[])) => void;
  setSelectedAnchor: (a: SelectAnchor | null) => void;
  setWriting: (b: boolean) => void;
  setLoadError: (b: boolean) => void;
}

export const usePlannerTasksStore = create<PlannerTasksState>((set) => ({
  tasks: [],
  selectedAnchor: null,
  writing: false,
  loadError: false,
  setTasks: (updater) =>
    set((state) => ({
      tasks:
        typeof updater === "function"
          ? (updater as (prev: Task[]) => Task[])(state.tasks)
          : updater,
    })),
  setSelectedAnchor: (a) => set({ selectedAnchor: a }),
  setWriting: (b) => set({ writing: b }),
  setLoadError: (b) => set({ loadError: b }),
}));
