// 项目视图共享常量：状态顺序 / 中文标签 / 颜色 / Select options。
// ProjectsPage 看板、ListView、GridView、OwnerView 共用；PROJECT_STATUS_OPTIONS 供
// NoteFieldsForm / QuickAddProjectModal 复用，避免四处复制漂移。

export const STATUS_ORDER = [
  "active",
  "pending",
  "paused",
  "completed",
  "abandoned",
];

export const STATUS_LABEL: Record<string, string> = {
  active: "进行中",
  pending: "筹备中",
  paused: "暂停",
  completed: "已完成",
  abandoned: "已放弃",
};

export const STATUS_COLOR: Record<string, string> = {
  active: "green",
  pending: "blue",
  paused: "orange",
  completed: "default",
  abandoned: "red",
};

/** 项目状态 Select options（值与 STATUS_ORDER 对齐），供 NoteFieldsForm / QuickAddProjectModal 共用。 */
export const PROJECT_STATUS_OPTIONS: { value: string; label: string }[] = STATUS_ORDER.map(
  (s) => ({ value: s, label: STATUS_LABEL[s] })
);

/** 取状态中文标签，未知状态原样返回。 */
export function statusLabel(s: string | null | undefined): string {
  if (!s) return "(未标记)";
  return STATUS_LABEL[s] ?? s;
}

/** 取状态颜色，未知用 default。 */
export function statusColor(s: string | null | undefined): string {
  return (s && STATUS_COLOR[s]) || "default";
}

/** priority 数值 → P0-P3 标签（200=P0/150=P1/100=P2/50=P3，其余返回空串）。 */
export function priorityLabel(p: number | null | undefined): string {
  if (p == null) return "";
  if (p >= 200) return "P0";
  if (p >= 150) return "P1";
  if (p >= 100) return "P2";
  if (p >= 50) return "P3";
  return "";
}
