// 今日计划页共享常量（四象限定义 / 重复选项 / 日期辅助 / 选中锚点）。
// 从 PlannerPage 抽离（阶段 3a 纯展示拆分），无业务逻辑，纯数据 + 类型。
import dayjs from "dayjs";
import type { Quadrant } from "../../utils/taskGrouping";

// ============================================================
// 四象限定义（参考图配色 + 图标 + 装饰图，照搬预览）
// ============================================================
export interface QuadDef {
  key: Quadrant;
  name: string;
  icon: string; // AppIcon registry name（象限主图标）
  sub: string;
  tip: string;
  decorIcon: string; // AppIcon registry name（右下大号装饰）
  cls: string; // CSS 类名后缀（q1/q2/q3/q4）
}

export const QUADS: Record<Quadrant, QuadDef> = {
  q1: { key: "q1", name: "重要且紧急", icon: "fire", sub: "立即做", tip: "立即做", decorIcon: "fire", cls: "q1" },
  q2: { key: "q2", name: "重要不紧急", icon: "bulb", sub: "规划后再做", tip: "计划做", decorIcon: "compass", cls: "q2" },
  q3: { key: "q3", name: "紧急不重要", icon: "thunder", sub: "快做", tip: "快做", decorIcon: "clock", cls: "q3" },
  q4: { key: "q4", name: "不重要不紧急", icon: "coffee", sub: "有空再做", tip: "有空做", decorIcon: "coffee", cls: "q4" },
};

// 参考图网格位置：左上 q3 / 右上 q1 / 左下 q4 / 右下 q2
export const QUAD_ORDER: Quadrant[] = ["q3", "q1", "q4", "q2"];

export const REPEAT_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "", label: "不重复" },
  { key: "day", label: "每天" },
  { key: "week", label: "每周" },
  { key: "month", label: "每月" },
];

export const todayStr = () => dayjs().format("YYYY-MM-DD");
export const tomorrowStr = () => dayjs().add(1, "day").format("YYYY-MM-DD");

/**
 * 选中锚点：vault 文件路径 + 1-based 去fm正文行号。两者跨写回稳定（id 漂移不影响）。
 * 详情面板靠锚点在最新 tasks 里 resolve 当前 task，id 漂移时自动跟上、面板不卸载。
 */
export interface SelectAnchor {
  relPath: string;
  sourceLine: number;
}
