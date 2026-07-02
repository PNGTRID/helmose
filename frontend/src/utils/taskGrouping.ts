// 任务分组 / 象限分类 / 紧急度派生纯函数（从 ListView/MatrixView/TasksPage 抽出）。
// 单一源 + 可单测：业务规则（逾期判定、象限归属、紧急度推导）集中保护，避免散落组件难测。
// 日期解析统一用 replace('-','/') 兼容 Safari（"YYYY-MM-DD" 在 Safari 需斜杠）。
import type { Task, NoteMeta } from "../types";

const DAY_MS = 86400000;

/** 任务分组（列表视图各维度共用） */
export interface TaskGroup {
  label: string;
  items: Task[];
}

/** 解析 due_date 为时间戳（Safari 用 '/' 兼容；无效返回 NaN） */
function dueTimestamp(dueDate: string): number {
  return new Date(dueDate.replace(/-/g, "/")).getTime();
}

/** 今日 00:00 时间戳 */
function startOfToday(): number {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
}

/** 按到期日分组：逾期 / 今天 / 本周 / 之后 / 无日期 */
export function groupTasksByDue(tasks: Task[]): TaskGroup[] {
  const startToday = startOfToday();
  const weekEnd = startToday + 7 * DAY_MS;
  const buckets: Record<string, Task[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    none: [],
  };
  for (const task of tasks) {
    if (!task.due_date) {
      buckets.none.push(task);
      continue;
    }
    const ts = dueTimestamp(task.due_date);
    if (isNaN(ts)) {
      buckets.none.push(task);
    } else if (ts < startToday) {
      buckets.overdue.push(task);
    } else if (ts < startToday + DAY_MS) {
      buckets.today.push(task);
    } else if (ts < weekEnd) {
      buckets.week.push(task);
    } else {
      buckets.later.push(task);
    }
  }
  const out: TaskGroup[] = [];
  if (buckets.overdue.length) out.push({ label: `逾期（${buckets.overdue.length}）`, items: buckets.overdue });
  if (buckets.today.length) out.push({ label: `今天（${buckets.today.length}）`, items: buckets.today });
  if (buckets.week.length) out.push({ label: `本周内（${buckets.week.length}）`, items: buckets.week });
  if (buckets.later.length) out.push({ label: `之后（${buckets.later.length}）`, items: buckets.later });
  if (buckets.none.length) out.push({ label: `无到期日（${buckets.none.length}）`, items: buckets.none });
  return out;
}

/** 按项目分组（project_id 为 null 归「未关联」，用源笔记 file_name 兜底显示） */
export function groupTasksByProject(tasks: Task[], noteById: Map<string, NoteMeta>): TaskGroup[] {
  const byProject = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.project_id ?? "__none__";
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(task);
  }
  const out: TaskGroup[] = [];
  for (const [key, items] of byProject) {
    let label: string;
    if (key === "__none__") {
      label = `未关联项目（${items.length}）`;
    } else {
      // 用第一条任务的源笔记 file_name 兜底（项目名前端无直接映射，project_id 是 notes.id）
      const name = items[0] && noteById.get(items[0].note_id)?.file_name;
      label = `${name ?? "项目"}（${items.length}）`;
    }
    out.push({ label, items });
  }
  return out;
}

/** 按状态分组：待办 / 进行中 / 已完成 */
export function groupTasksByStatus(tasks: Task[]): TaskGroup[] {
  const todo: Task[] = [];
  const doing: Task[] = [];
  const done: Task[] = [];
  for (const task of tasks) {
    if (task.status === "doing") doing.push(task);
    else if (task.status === "done" || task.done) done.push(task);
    else todo.push(task);
  }
  const out: TaskGroup[] = [];
  if (todo.length) out.push({ label: `待办（${todo.length}）`, items: todo });
  if (doing.length) out.push({ label: `进行中（${doing.length}）`, items: doing });
  if (done.length) out.push({ label: `已完成（${done.length}）`, items: done });
  return out;
}

/** 按优先级分组：P1(>=3) / P2(=2) / P3(=1) / 未设(0) */
export function groupTasksByPriority(tasks: Task[]): TaskGroup[] {
  const p1: Task[] = [];
  const p2: Task[] = [];
  const p3: Task[] = [];
  const none: Task[] = [];
  for (const task of tasks) {
    if (task.priority >= 3) p1.push(task);
    else if (task.priority === 2) p2.push(task);
    else if (task.priority === 1) p3.push(task);
    else none.push(task);
  }
  const out: TaskGroup[] = [];
  if (p1.length) out.push({ label: `P1（${p1.length}）`, items: p1 });
  if (p2.length) out.push({ label: `P2（${p2.length}）`, items: p2 });
  if (p3.length) out.push({ label: `P3（${p3.length}）`, items: p3 });
  if (none.length) out.push({ label: `未设优先级（${none.length}）`, items: none });
  return out;
}

/** 四象限 key（艾森豪威尔矩阵） */
export type Quadrant = "q1" | "q2" | "q3" | "q4";

/** 判定任务象限：重要 = priority>=2；紧急 = effUrgency==='high' */
export function classifyQuadrant(task: Task, effUrgency: "high" | "mid" | "low"): Quadrant {
  const important = task.priority >= 2;
  const urgent = effUrgency === "high";
  if (important && urgent) return "q1";
  if (important && !urgent) return "q2";
  if (!important && urgent) return "q3";
  return "q4";
}

/** 单任务有效紧急度（三态口径，所有消费点统一，Blocker #1 方案 B）：
 *  - urgency==="high" → high（显式紧急，强制）
 *  - urgency==="low"  → low（显式不紧急，压制 due_date 派生——「今天到期但不紧急」可表达）
 *  - ""（未设）→ due_date 派生：逾期/今天=high，本周=mid，之后/无/无效=low */
export function effectiveUrgency(task: Task): "high" | "mid" | "low" {
  if (task.urgency === "high") return "high";
  if (task.urgency === "low") return "low";
  if (!task.due_date) return "low";
  const startToday = startOfToday();
  const ts = dueTimestamp(task.due_date);
  if (isNaN(ts)) return "low";
  if (ts < startToday + DAY_MS) return "high"; // 逾期 + 今天
  if (ts < startToday + 7 * DAY_MS) return "mid"; // 本周内
  return "low";
}

/** 批量紧急度派生（复用 effectiveUrgency 单任务口径，保证矩阵/列表/详情同源）。key=task.id。 */
export function computeUrgencyMap(tasks: Task[]): Map<string, "high" | "mid" | "low"> {
  const m = new Map<string, "high" | "mid" | "low">();
  for (const t of tasks) {
    m.set(t.id, effectiveUrgency(t));
  }
  return m;
}
