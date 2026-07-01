// 快速添加域纯函数：拼装 task/event bullet + project frontmatter（零副作用）。
// 用于 TodayPage / CalendarPage / ProjectsPage / JournalPage 的快速创建 Modal。
// bullet 格式严格对齐 indexer 解析约定：
//   · 📅 YYYY-MM-DD（tasks.rs due_date 解析）
//   · 行首 HH:MM[-HH:MM]（events.rs 时间解析）
//   · ⭐ priority（数 1-3）/ 🔥 urgency high / 🔄 status doing（indexer tasks.rs 已识别）

/** dayjs 实例序列化为 YYYY-MM-DD（无效返回 undefined）。 */
function toDateIso(d: { format: (f: string) => string } | null | undefined): string | undefined {
  return d ? d.format("YYYY-MM-DD") : undefined;
}

/** dayjs 实例序列化为 HH:MM（无效返回 undefined）。 */
function toTimeStr(d: { format: (f: string) => string } | null | undefined): string | undefined {
  return d ? d.format("HH:mm") : undefined;
}

/** 紧急程度标记映射（indexer 已识别 🔥 = high，其余无 emoji）。 */
const URGENCY_EMOJI: Record<string, string> = {
  high: "🔥",
  mid: "",
  low: "",
};

/**
 * 拼装待办 bullet 文本（追加到「今日待办」section 末尾）。
 * bullet 约定与 indexer tasks.rs / library set_task_* 同口径（单一源，避免散落手拼）：
 *   · 前缀：done→`[x]` / doing→`[/]` / todo→`[ ]`
 *   · 📅 YYYY-MM-DD（due_date）/ ⭐×N（priority 1-3，clamp）/ 🔥（urgency high）/ #project:{name}
 * @param text 任务内容
 * @param dueDate 截止日期（dayjs 或 YYYY-MM-DD 字符串），可选
 * @param urgency 紧急程度 'high'|'mid'|'low'，可选
 * @param projectName 关联项目名（#project:{name} 标签），可选
 * @param priority 优先级 0-3（0/不传=不加 ⭐），可选
 * @param status 状态 'todo'|'doing'|'done'，可选（默认 todo → `[ ]`）
 * @returns 单行 bullet，如 `- [/] 写周报 📅 2026-07-01 ⭐⭐ 🔥 #project:Helmose`
 */
export function buildTaskBullet(
  text: string,
  dueDate?: { format: (f: string) => string } | string | null,
  urgency?: "high" | "mid" | "low" | null,
  projectName?: string | null,
  priority?: number | null,
  status?: "todo" | "doing" | "done" | null
): string {
  const prefix = status === "done" ? "- [x]" : status === "doing" ? "- [/]" : "- [ ]";
  const parts: string[] = [`${prefix} ${text}`];
  const due = typeof dueDate === "string" ? dueDate : toDateIso(dueDate);
  if (due) parts.push(`📅 ${due}`);
  if (priority && priority > 0) parts.push("⭐".repeat(Math.min(priority, 3)));
  if (urgency && URGENCY_EMOJI[urgency]) parts.push(URGENCY_EMOJI[urgency]);
  if (projectName && projectName.trim()) parts.push(`#project:${projectName.trim()}`);
  return parts.join(" ");
}

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
