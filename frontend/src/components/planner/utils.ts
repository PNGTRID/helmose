// 今日计划页共享工具函数（分类名 / 映射源可读标签）。
// 从 PlannerPage 抽离（阶段 3a 纯展示拆分），纯函数无副作用。
import { SYS_ALL, SYS_INBOX, type PlannerCategory } from "../../stores/plannerCategories";

/** 分类 id → 分类名（用于卡片 meta 文本，不带图标；系统分类返回空串） */
export function catName(catId: string | undefined, categories: PlannerCategory[]): string {
  if (!catId || catId === SYS_ALL || catId === SYS_INBOX) return "";
  const c = categories.find((x) => x.id === catId);
  return c ? c.name : "";
}

/** 分类映射源的可读标签（详情面板「计划分类」属性行展开后展示当前推导依据） */
export function matcherLabel(c: PlannerCategory): string {
  const m = c.matcher;
  if (!m.value) return `${c.name}（未设映射源）`;
  if (m.kind === "project") return `${c.name} · 关联项目`;
  if (m.kind === "dir") return `${c.name} · 文件夹「${m.value}」`;
  return `${c.name} · 标签「${m.value}」`;
}
