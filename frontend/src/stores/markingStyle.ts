// 任务标记风格（helmose 文字 / obsidian emoji）：localStorage 持久化。
// 定位：独立自建 → helmose 文字契约（默认）；Obsidian 用户低摩擦 → obsidian 模式对齐 Tasks 插件。
//
// 写侧（buildTaskBullet / 后端 set_task_*）按此风格输出；
// 读侧 indexer 三格式全兼容（见 tasks.rs，Postel 法则：读宽容、写规范）。
// 切风格不影响存量（读侧都认 + 后端写侧 sniff 原格式优先），只影响新写。

import { create } from "zustand";
import { safeReadWhitelist, safeSetItem } from "../utils/safeLocalStorage";

// 常量集中：避免 "helmose"/"obsidian" 字面量散落多处拼错而静默 fallback（M1）。
export const MARKING_STYLE_HELMOSE = "helmose" as const;
export const MARKING_STYLE_OBSIDIAN = "obsidian" as const;
export const MARKING_STYLE_VALUES = [
  MARKING_STYLE_HELMOSE,
  MARKING_STYLE_OBSIDIAN,
] as const;
export type MarkingStyle = (typeof MARKING_STYLE_VALUES)[number];

interface MarkingStyleState {
  style: MarkingStyle;
  setStyle: (s: MarkingStyle) => void;
}

const STORAGE_KEY = "helmose-marking-style";

function readInitial(): MarkingStyle {
  // 白名单读取：脏值（旧版本/篡改）自动清理 + 隐私模式容错，默认 helmose（独立自建定位）
  return safeReadWhitelist(STORAGE_KEY, MARKING_STYLE_VALUES, MARKING_STYLE_HELMOSE);
}

export const useMarkingStyleStore = create<MarkingStyleState>((set) => ({
  style: readInitial(),
  setStyle: (s) => {
    // 容量超限/隐私模式 → false；store 内存态仍更新（当前会话生效，持久化失败不阻塞 UI）
    safeSetItem(STORAGE_KEY, s);
    set({ style: s });
  },
}));

/** 非 hook 读当前风格（供 buildTaskBullet / api.invoke 等非组件场景调用）。 */
export function getMarkingStyle(): MarkingStyle {
  return useMarkingStyleStore.getState().style;
}
