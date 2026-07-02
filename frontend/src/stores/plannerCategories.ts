// 今日计划 · 自定义分类 store（纯前端，不碰 vault/DB/schema）。
// Task 无 category 字段（架构铁律：不落库不改 schema），分类是「视图层映射」：
//   每个自定义分类绑一个数据源 matcher（project/dir/tag 三选一），按现有字段推导归类。
//   - project → task.project_id === matcher.value
//   - dir    → 源笔记 rel_path 以 matcher.value 为前缀（目录归属）
//   - tag    → 源笔记 tags 含 matcher.value
// 系统分类（运行时常量，不入 localStorage）：
//   - 'all'   全部
//   - 'inbox' 收集箱（匹配不到任何自定义分类的任务）
// 多分类命中时按数组顺序取首个；都不命中 → 'inbox'。
// 配置存 localStorage（仿 taskView.ts / theme.ts，隐私模式静默降级）。
// 图标：icon 字段存 AppIcon registry name（如 "fire"/"folder"），早期版本用 emoji 字段已迁移。

import { create } from "zustand";
import type { NoteMeta, Task } from "../types";
import { safeGetItem, safeReadJSON, safeSetItem } from "../utils/safeLocalStorage";

/** 映射源类型：项目 id / 目录前缀 / tag 名 */
export type MatcherKind = "project" | "dir" | "tag";

export interface CategoryMatcher {
  kind: MatcherKind;
  /** project: projects.id；dir: 目录前缀（如 "04_项目"）；tag: tag 名（不含 #） */
  value: string;
}

export interface PlannerCategory {
  id: string;
  name: string;
  /** 图标名（AppIcon registry key，见 components/AppIcon.tsx；老数据 emoji 已迁移为默认 icon） */
  icon: string;
  matcher: CategoryMatcher;
}

/** 系统分类 id（不入 localStorage，运行时常量） */
export const SYS_ALL = "all";
export const SYS_INBOX = "inbox";

const STORAGE_KEY = "helmose-planner-categories";
const ACTIVE_KEY = "helmose-planner-active-cat";

/** 首屏不预置死分类（映射源未知会永远命中不了），由用户点「新建分类」自建并绑映射源 */
function defaultCategories(): PlannerCategory[] {
  return [];
}

/**
 * 老数据兼容：早期版本字段为 emoji（已弃用，UI 禁用 emoji），迁移为 icon。
 * - 有合法 icon → 保留
 * - 无 icon（老数据）→ 兜底 "folder"
 * 字段缺失/类型异常 → 安全默认值，避免脏数据导致 UI 崩。
 */
function normalizeCategory(c: unknown): PlannerCategory {
  const obj = (c ?? {}) as Partial<PlannerCategory> & { emoji?: string };
  return {
    id: typeof obj.id === "string" ? obj.id : "",
    // 长度兜底（防超长名破坏布局 / 恶意 localStorage 注入；UI 层也应限制输入）
    name: typeof obj.name === "string" ? obj.name.slice(0, 64) : "",
    icon: typeof obj.icon === "string" && obj.icon ? obj.icon : "folder",
    matcher:
      obj.matcher && typeof obj.matcher === "object"
        ? (obj.matcher as CategoryMatcher)
        : { kind: "project", value: "" },
  };
}

function readCategories(): PlannerCategory[] {
  // safeReadJSON 统一容错（隐私模式 / 损坏 JSON）；非数组（旧格式残留）→ 默认空
  const parsed = safeReadJSON<unknown[]>(STORAGE_KEY, []);
  if (!Array.isArray(parsed)) return defaultCategories();
  return parsed.map(normalizeCategory);
}

function readActive(): string {
  return safeGetItem(ACTIVE_KEY) ?? SYS_ALL;
}

function persistCategories(cats: PlannerCategory[]) {
  // 容量超限（5-10MB）→ false：上报而非静默，避免用户改分类表面成功实际没存（Medium #12）
  if (!safeSetItem(STORAGE_KEY, JSON.stringify(cats))) {
    console.warn(
      "[plannerCategories] localStorage 写入失败（可能容量超限），分类未持久化"
    );
  }
}

function persistActive(id: string) {
  safeSetItem(ACTIVE_KEY, id);
}

interface PlannerCategoryState {
  categories: PlannerCategory[];
  activeCat: string;
  addCategory: (cat: PlannerCategory) => void;
  updateCategory: (id: string, patch: Partial<Omit<PlannerCategory, "id">>) => void;
  removeCategory: (id: string) => void;
  setActiveCat: (id: string) => void;
}

export const usePlannerCategoryStore = create<PlannerCategoryState>((set, get) => ({
  categories: readCategories(),
  activeCat: readActive(),
  addCategory: (cat) => {
    const next = [...get().categories, cat];
    persistCategories(next);
    set({ categories: next });
  },
  updateCategory: (id, patch) => {
    const next = get().categories.map((c) => (c.id === id ? { ...c, ...patch } : c));
    persistCategories(next);
    set({ categories: next });
  },
  removeCategory: (id) => {
    const next = get().categories.filter((c) => c.id !== id);
    persistCategories(next);
    // 删的正是当前激活的 → 回落到「全部」
    const active = get().activeCat === id ? SYS_ALL : get().activeCat;
    if (active !== get().activeCat) persistActive(active);
    set({ categories: next, activeCat: active });
  },
  setActiveCat: (id) => {
    persistActive(id);
    set({ activeCat: id });
  },
}));

/**
 * 判定单个任务的归类（自定义分类 id 或 SYS_INBOX）。
 * 按分类数组顺序首个命中即返回；都不命中 → 收集箱。
 * noteById / projectById 由调用方从 useAllNotesMeta / useActiveProjects 构建。
 */
export function classifyTask(
  task: Task,
  categories: PlannerCategory[],
  noteById: Map<string, NoteMeta>
): string {
  for (const cat of categories) {
    const m = cat.matcher;
    if (!m.value) continue; // 映射源为空（如默认示例）→ 跳过，不命中
    if (m.kind === "project") {
      if (task.project_id && task.project_id === m.value) return cat.id;
    } else if (m.kind === "dir") {
      // 目录前缀匹配加分隔符：`04` 只命中 `04` 与 `04/...`，不误命中 `044_xxx`（Medium #14）
      const note = noteById.get(task.note_id);
      if (
        note &&
        (note.rel_path === m.value || note.rel_path.startsWith(m.value + "/"))
      )
        return cat.id;
    } else if (m.kind === "tag") {
      const note = noteById.get(task.note_id);
      if (note && note.tags.includes(m.value)) return cat.id;
    }
  }
  return SYS_INBOX;
}
