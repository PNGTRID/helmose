// 快速添加域纯函数：拼装 task/event bullet + project frontmatter（零副作用）。
// 用于 TodayPage / CalendarPage / ProjectsPage / JournalPage 的快速创建 Modal。
// bullet 格式严格对齐 indexer 解析约定：
//   · 📅 YYYY-MM-DD（tasks.rs due_date 解析）
//   · 行首 HH:MM[-HH:MM]（events.rs 时间解析）
//   · ⭐ priority（数 1-3）/ 🔥 urgency high / 🔄 status doing（indexer tasks.rs 已识别）

import { getMarkingStyle, MARKING_STYLE_OBSIDIAN } from "../stores/markingStyle";
import type { MarkingStyle } from "../stores/markingStyle";

/** dayjs 实例序列化为 YYYY-MM-DD（无效返回 undefined）。 */
function toDateIso(d: { format: (f: string) => string } | null | undefined): string | undefined {
  return d ? d.format("YYYY-MM-DD") : undefined;
}

/** dayjs 实例序列化为 HH:MM（无效返回 undefined）。 */
function toTimeStr(d: { format: (f: string) => string } | null | undefined): string | undefined {
  return d ? d.format("HH:mm") : undefined;
}

/**
 * 拼装待办 bullet 文本（追加到「今日待办」section 末尾）。
 * 写侧按 markingStyle 输出（未传则读全局 markingStyle store，默认 helmose 文字标准）；
 * 读侧 indexer 三格式全兼容（见 tasks.rs）。
 *
 * helmose 模式（独立契约，默认）：
 *   · 前缀：done→`[x]` / doing→`[/]` / todo→`[ ]`
 *   · due:YYYY-MM-DD / priority:N(1-3,3=最高) / urgency:high(手动二值) / repeat:<rule> / #project:{name}
 *
 * obsidian 模式（对齐 Obsidian Tasks 插件，双端互通）：
 *   · 📅 YYYY-MM-DD / ⏫🔼🔽(3/2/1) / 🔁 every <rule> / #project:{name}
 *   · urgency：Obsidian Tasks 无此概念，写 🔥（Helmose 扩展；Obsidian Tasks 忽略，Helmose 读侧识别）
 *
 * @param opts 任务字段对象（text 必填，余可选；详见 BuildTaskBulletOptions）
 * @returns 单行 bullet，如 helmose `- [/] 写周报 due:2026-07-01 repeat:week priority:3 urgency:high #project:Helmose`
 */
export interface BuildTaskBulletOptions {
  text: string;
  /** 截止日期（dayjs 实例或 YYYY-MM-DD 字符串） */
  dueDate?: { format: (f: string) => string } | string | null;
  /** 紧急度：'high'|'low' 显式入 bullet；'mid'|'' 未设由前端 due_date 派生，不入 bullet（三态，Blocker #1） */
  urgency?: "high" | "mid" | "low" | "" | null;
  /** 关联项目名（#project:{name} 标签） */
  projectName?: string | null;
  /** 优先级 0-3（0/不传=不加标记） */
  priority?: number | null;
  /** 状态 'todo'|'doing'|'done'，默认 todo → `[ ]` */
  status?: "todo" | "doing" | "done" | null;
  /** 重复规则（'day'|'week'|'month'|'Mon'-'Sun'），对齐后端 normalize_repeat_rule */
  repeatRule?: string | null;
  /** 标记风格，默认 "helmose"（独立自建定位） */
  markingStyle?: MarkingStyle;
}

export function buildTaskBullet(opts: BuildTaskBulletOptions): string {
  const { text, dueDate, urgency, projectName, priority, status, repeatRule, markingStyle } = opts;
  // 未传 markingStyle → 读全局设置（stores/markingStyle，默认 helmose 独立契约）
  const style = markingStyle ?? getMarkingStyle();
  const prefix = status === "done" ? "- [x]" : status === "doing" ? "- [/]" : "- [ ]";
  const parts: string[] = [`${prefix} ${text}`];
  const due = typeof dueDate === "string" ? dueDate : toDateIso(dueDate);
  const obs = style === MARKING_STYLE_OBSIDIAN;
  if (due) parts.push(obs ? `📅 ${due}` : `due:${due}`);
  // 重复规则紧跟 due（toggle_task 重复推进读当前 due → 推进时一并替换）。
  // 仅接受后端 normalize_repeat_rule 认可的值，过滤脏值避免污染 bullet。
  if (repeatRule && REPEAT_RULE_VALUES.has(repeatRule)) {
    parts.push(obs ? `🔁 every ${repeatRule}` : `repeat:${repeatRule}`);
  }
  if (priority && priority > 0) {
    const p = Math.min(priority, 3);
    // obsidian 模式用 Obsidian Tasks 标准 ⏫🔼🔽（让 Tasks 插件识别）；helmose 用 priority:N
    parts.push(obs ? (p === 3 ? "⏫" : p === 2 ? "🔼" : "🔽") : `priority:${p}`);
  }
  // urgency 三态（Blocker #1 方案 B）：high/low 显式入 bullet；未设（""/null/mid）不入，前端 due_date 派生。
  // low 两模式统一 urgency:low 文字（Obsidian Tasks 插件无 low emoji 对应，文字互通）。
  if (urgency === "high") parts.push(obs ? "🔥" : "urgency:high");
  else if (urgency === "low") parts.push("urgency:low");
  if (projectName && projectName.trim()) parts.push(`#project:${projectName.trim()}`);
  return parts.join(" ");
}

/**
 * 后端 normalize_repeat_rule 接受的标准重复规则白名单。
 * 与 src-tauri/src/services/indexer/tasks.rs normalize_repeat_rule 严格对齐：
 * day / week / month / Mon / Tue / Wed / Thu / Fri / Sat / Sun。
 * 前端下拉选项必须映射到这 10 个之一，否则 buildTaskBullet 会忽略。
 */
export const REPEAT_RULE_VALUES = new Set([
  "day",
  "week",
  "month",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
]);

/**
 * 拼装事件 bullet 文本（追加到「关键事件 / 时间线」section 末尾）。
 * 行首时间格式：HH:MM 或 HH:MM-HH:MM（indexer events.rs 已识别）。
 * @param title 事件标题
 * @param start 开始时间（dayjs 或 HH:MM 字符串）
 * @param end 结束时间，可选（时间段事件）
 * @param note 备注，可选（拼入括号内）
 * @returns 单行 bullet，如 `- 09:00-10:00 周会（讨论 v0.2 规划）`
 */
export function buildEventBullet(
  title: string,
  start: { format: (f: string) => string } | string,
  end?: { format: (f: string) => string } | string | null,
  note?: string | null
): string {
  const s = typeof start === "string" ? start : toTimeStr(start);
  const e = end ? (typeof end === "string" ? end : toTimeStr(end)) : null;
  const timeRange = e ? `${s}-${e}` : s;
  const tail = note && note.trim() ? `（${note.trim()}）` : "";
  return `- ${timeRange} ${title}${tail}`;
}

/**
 * 优先级 P0-P3 → frontmatter priority 数值映射（与 indexer projects.rs 解析一致）。
 * P0=200 / P1=150 / P2=100 / P3=50，越大越优先。
 */
export function priorityToValue(p: "P0" | "P1" | "P2" | "P3" | null | undefined): number | null {
  switch (p) {
    case "P0":
      return 200;
    case "P1":
      return 150;
    case "P2":
      return 100;
    case "P3":
      return 50;
    default:
      return null;
  }
}

/**
 * 拼装项目笔记完整 markdown（frontmatter + 正文）。
 * @param name 项目名（同时作为 H1 标题）
 * @param status 状态值（active/pending/paused/completed/abandoned），写入 tag project-status:{status}
 * @param priority P0-P3，写入 frontmatter.priority
 * @param mainline 是否主线，写入 frontmatter.mainline + tag mainline
 * @param okr OKR 标识，可选，写入 frontmatter.okr
 * @param owner 负责人，可选，写入 frontmatter.owner
 * @param body 正文（由 projectTemplates 生成），默认 `# {name}\n`
 * @returns 完整 md 字符串
 */
export function buildProjectFrontmatter(
  name: string,
  status: string,
  priority: "P0" | "P1" | "P2" | "P3" | null,
  mainline: boolean,
  okr: string | null,
  owner?: string | null,
  body?: string
): string {
  const priorityVal = priorityToValue(priority);
  const tags: string[] = ["project-status:" + status, "type:project"];
  if (mainline) tags.push("mainline");
  const fmLines: string[] = ["---"];
  fmLines.push("type: project");
  // title 用 JSON 字符串序列化（与 okr/owner 一致），避免项目名含冒号/换行破坏 YAML
  fmLines.push(`title: ${JSON.stringify(name)}`);
  if (priorityVal != null) fmLines.push(`priority: ${priorityVal}`);
  if (okr && okr.trim()) fmLines.push(`okr: ${JSON.stringify(okr.trim())}`);
  if (mainline) fmLines.push("mainline: true");
  if (owner && owner.trim()) fmLines.push(`owner: ${JSON.stringify(owner.trim())}`);
  fmLines.push("created: " + new Date().toISOString().slice(0, 10));
  fmLines.push("tags:");
  for (const t of tags) fmLines.push(`  - ${t}`);
  fmLines.push("---");
  fmLines.push("");
  return fmLines.join("\n") + (body ?? `# ${name}\n`);
}

/**
 * 项目名/任意标题 → 文件名 slug。
 * 规则：去首尾空格 / 替换路径分隔符 / 替换非法字符（\/:*?"<>|）为下划线 / 折叠连续空格为单下划线。
 * 中文保留（vault 是中文环境，不 transliterate）。
 * @param name 项目名
 * @returns slug，如 "Helmose v0.2 规划" → "Helmose_v0.2_规划"
 */
/** Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9），跨平台同步盘写文件会失败 → 加下划线前缀 */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function slugify(name: string): string {
  let s = name
    .trim()
    .replace(/^\.+/, "") // 去前导点（避免生成隐藏文件 / 触发后端路径校验异常）
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (WIN_RESERVED.test(s)) s = `_${s}`;
  return s;
}
