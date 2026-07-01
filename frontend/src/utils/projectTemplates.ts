// 项目模板：4 种结构（空白 / 任务列表 / OKR / 知识库），供 QuickAddProjectModal 选择。
// 全部以 `# {name}` 起头（与 buildProjectFrontmatter 拼接时 body 已含 H1）。
// 调用方拼装：buildProjectFrontmatter(name, ...) + projectTemplateBody(key, name)。

import dayjs from "dayjs";

export type ProjectTemplate = "blank" | "tasks" | "okr" | "knowledge";

export const PROJECT_TEMPLATE_OPTIONS: { value: ProjectTemplate; label: string; desc: string }[] = [
  { value: "blank", label: "空白项目", desc: "一句话定位 + 相关链接" },
  { value: "tasks", label: "任务列表", desc: "行动清单 + 第一项任务" },
  { value: "okr", label: "OKR 项目", desc: "目标 / 关键结果 / 行动" },
  { value: "knowledge", label: "知识库", desc: "主题 + 笔记区" },
];

/** 空白项目：# {name} + 一句话定位 + 相关链接 */
function blank(name: string): string {
  return [`# ${name}`, "", "> 一句话定位", "", "## 相关链接", "", ""].join("\n");
}

/** 任务列表：# {name} + 行动 + 第一项任务（带今日 due_date） */
function tasks(name: string): string {
  const today = dayjs().format("YYYY-MM-DD");
  return [
    `# ${name}`,
    "",
    "## 行动",
    `- [ ] 第一项 📅 ${today}`,
    "",
    "",
  ].join("\n");
}

/** OKR 项目：# {name} + 目标 (O) + 关键结果 (KR) + 行动 */
function okr(name: string): string {
  return [
    `# ${name}`,
    "",
    "## 目标 (O)",
    "- O1",
    "",
    "## 关键结果 (KR)",
    "- KR1",
    "",
    "## 行动",
    "- [ ] ",
    "",
    "",
  ].join("\n");
}

/** 知识库：# {name} + 主题 + 笔记 */
function knowledge(name: string): string {
  return [`# ${name}`, "", "## 主题", "", "## 笔记", "", ""].join("\n");
}

/** 按模板 key 取正文（仅 body，不含 frontmatter；frontmatter 由 buildProjectFrontmatter 拼）。 */
export function projectTemplateBody(template: ProjectTemplate, name: string): string {
  switch (template) {
    case "blank":
      return blank(name);
    case "tasks":
      return tasks(name);
    case "okr":
      return okr(name);
    case "knowledge":
      return knowledge(name);
  }
}
