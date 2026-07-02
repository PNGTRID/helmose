// 任务行解析/重组纯函数（从 PlannerPage 抽出，便于单测 + 复用）。
// parseDesc：解析任务行下方缩进纯文本描述（Obsidian Tasks 缩进行惯例，不污染 task.text）。
// rebuildTaskLine：重组任务 bullet 整行（updateLine 写回用），保留原 priority/urgency/status。

import type { Task } from "../types";
import { buildTaskBullet } from "./quickAdd";

/**
 * 从去 fm 正文解析任务的「描述」：任务行之后、下一个非缩进行之前，
 * 第一个缩进 ≥2 空格且非 bullet（- * +）的纯文本行。
 * 描述可在子任务之前或之后（扫描跳过子任务 bullet）。返回描述文本与 1-based 行号；无则 null。
 */
export function parseDesc(
  rawContent: string,
  sourceLine: number
): { text: string; lineNo: number } | null {
  const lines = rawContent.split("\n");
  let i = sourceLine; // 0-based：lines[sourceLine-1] 是任务行，lines[sourceLine] 是下一行
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (!/^\s/.test(line)) break; // 非缩进（顶层）→ 任务块结束
    const trimmed = line.trimStart();
    if (trimmed.startsWith("-") || trimmed.startsWith("*") || trimmed.startsWith("+")) {
      i++; // bullet（子任务）→ 跳过继续找描述
      continue;
    }
    return { text: trimmed.trim(), lineNo: i + 1 }; // 缩进纯文本 = 描述
  }
  return null;
}

/**
 * 重组任务 bullet 整行（改 text/due/repeat/project 时用 updateLine 写回）。
 * 保留原 priority/urgency/status；project 名：override 优先（手动改归类），否则反查当前 project。
 * dueDate '' / null = 清空期限；repeatRule '' / null = 清空重复；projectName null = 清除 project。
 */
export function rebuildTaskLine(
  task: Task,
  overrides: {
    text?: string;
    dueDate?: string | null;
    repeatRule?: string | null;
    projectName?: string | null;
  },
  currentProjectName: string | null
): string {
  const due = overrides.dueDate !== undefined ? overrides.dueDate : task.due_date;
  const rule = overrides.repeatRule !== undefined ? overrides.repeatRule : task.repeat_rule;
  const projectName =
    overrides.projectName !== undefined ? overrides.projectName : currentProjectName;
  return buildTaskBullet({
    text: overrides.text ?? task.text,
    dueDate: due,
    urgency: task.urgency === "high" ? "high" : task.urgency === "low" ? "low" : "",
    projectName,
    priority: task.priority,
    status: task.status === "done" ? "done" : task.status === "doing" ? "doing" : "todo",
    repeatRule: rule,
  });
}
