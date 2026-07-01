// 日志模板 + 路径规则（单一源，JournalPage 与 CalendarPage.ensureDayNote 共用消除漂移）。
// 模板 frontmatter + section 严格对齐 design M7 表。
// 路径约定：daily=`07_决策与复盘/日志/YYYY-MM/YYYY-MM-DD.md`，weekly 加 `-周报` 后缀避免覆盖日报。

import dayjs, { type Dayjs } from "dayjs";

export type JournalTemplate = "daily" | "weekly" | "monthly" | "review";

/** ISO 周号（YYYY-Www，1-based）。dayjs isoWeek 插件需要，但为避免引入额外插件这里手算。 */
function isoWeek(d: Dayjs): { year: number; week: number } {
  const date = d.toDate();
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: tmp.getUTCFullYear(), week };
}

/** 日报路径：07_决策与复盘/日志/YYYY-MM/YYYY-MM-DD.md */
export function dayNoteRelPath(date: Dayjs | string, template: JournalTemplate = "daily"): string {
  const d = typeof date === "string" ? dayjs(date) : date;
  const ym = d.format("YYYY-MM");
  const ymd = d.format("YYYY-MM-DD");
  const suffix = template === "weekly" ? "-周报" : "";
  return `07_决策与复盘/日志/${ym}/${ymd}${suffix}.md`;
}

/** 日报模板（type:log）：今日待办 / 关键事件 / 复盘 / 明日寄语 */
export function dailyTemplate(date: Dayjs | string): string {
  const d = typeof date === "string" ? dayjs(date) : date;
  const iso = d.format("YYYY-MM-DD");
  return [
    "---",
    "type: log",
    `created: ${iso}`,
    "mood:",
    "energy:",
    "---",
    "",
    `# ${iso} 日志`,
    "",
    "## 今日待办",
    "",
    "## 关键事件",
    "",
    "## 复盘",
    "",
    "## 明日寄语",
    "",
    "",
  ].join("\n");
}

/** 周报模板（type:log）：本周目标 / 完成情况 / 关键事件 / 下周计划 */
export function weeklyTemplate(date: Dayjs | string): string {
  const d = typeof date === "string" ? dayjs(date) : date;
  const { year, week } = isoWeek(d);
  const weekIso = `${year}-W${String(week).padStart(2, "0")}`;
  return [
    "---",
    "type: log",
    `created: ${d.format("YYYY-MM-DD")}`,
    `week_iso: ${weekIso}`,
    "---",
    "",
    `# ${weekIso} 周报`,
    "",
    "## 本周目标",
    "",
    "## 完成情况",
    "",
    "## 关键事件",
    "",
    "## 下周计划",
    "",
    "",
  ].join("\n");
}

/** 月报模板（type:experience）：月度回顾 / 关键成就 / 反思 / 下月重点 */
export function monthlyTemplate(date: Dayjs | string): string {
  const d = typeof date === "string" ? dayjs(date) : date;
  const monthIso = d.format("YYYY-MM");
  return [
    "---",
    "type: experience",
    `created: ${d.format("YYYY-MM-DD")}`,
    `month_iso: ${monthIso}`,
    "highlights:",
    "---",
    "",
    `# ${monthIso} 月报`,
    "",
    "## 月度回顾",
    "",
    "## 关键成就",
    "",
    "## 反思",
    "",
    "## 下月重点",
    "",
    "",
  ].join("\n");
}

/** 复盘模板（type:experience）：背景 / 做了什么 / 学到什么 / 下次改进 */
export function reviewTemplate(date: Dayjs | string, reviewType: string = "项目"): string {
  const d = typeof date === "string" ? dayjs(date) : date;
  return [
    "---",
    "type: experience",
    `created: ${d.format("YYYY-MM-DD")}`,
    `review_type: ${JSON.stringify(reviewType)}`,
    "---",
    "",
    `# ${reviewType}复盘`,
    "",
    "## 背景",
    "",
    "## 做了什么",
    "",
    "## 学到什么",
    "",
    "## 下次改进",
    "",
    "",
  ].join("\n");
}

/** 按模板 key 取生成函数（统一入口）。 */
export function renderJournalTemplate(
  template: JournalTemplate,
  date: Dayjs | string,
  opts?: { reviewType?: string }
): string {
  switch (template) {
    case "daily":
      return dailyTemplate(date);
    case "weekly":
      return weeklyTemplate(date);
    case "monthly":
      return monthlyTemplate(date);
    case "review":
      return reviewTemplate(date, opts?.reviewType);
  }
}
