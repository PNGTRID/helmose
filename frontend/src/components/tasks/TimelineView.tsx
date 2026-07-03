// 任务时间线视图（TasksPage 第四视图）：横向时间轴今日中轴 ±30 天。
// 任务按 due_date 落点；无 due_date 归「未排期」侧栏；同日多条堆叠 + 计数角标。
// 数据源复用 TasksPage 一次 getTasks 拉取（不重复 IPC），内存切视图。
// 仿兄弟组件（ListView/KanbanView/MatrixView）props 模式：tasks + urgencyMap + noteById + onOpen + onToggle。
import "./TimelineView.css";
import { useMemo } from "react";
import { Badge, Tag, Tooltip, Typography } from "antd";
import EmptyState from "../EmptyState";
import dayjs from "dayjs";
import type { Task, NoteMeta } from "../../types";
import TaskCard from "./TaskCard";
import AppIcon from "../../components/AppIcon";

const { Text } = Typography;

interface Props {
  tasks: Task[];
  /** 紧急度派生值（父 TasksPage 计算注入），key=task.id */
  urgencyMap?: Map<string, "high" | "mid" | "low">;
  /** 来源笔记元数据（卡片显示 file_name） */
  noteById: Map<string, NoteMeta>;
  /** 点击卡片 → 父打开 Drawer */
  onOpen: (t: Task) => void;
  /** 勾选完成态写回 */
  onToggle: (t: Task, done: boolean) => void;
}

/** 时间轴窗口：今日前后 ±30 天，共 61 天。 */
const WINDOW_DAYS = 30;

/**
 * 把 due_date 字符串归一为 YYYY-MM-DD（容错 trim + 只取日期部分）。
 * 后端 due_date 已是 YYYY-MM-DD，这里只防异常输入。
 */
function normalizeDate(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  // 只取前 10 位（兼容可能带时间后缀的输入）
  return t.length >= 10 ? t.slice(0, 10) : null;
}

export default function TimelineView({
  tasks,
  urgencyMap,
  noteById,
  onOpen,
  onToggle,
}: Props) {
  const today = useMemo(() => dayjs(), []);
  // 时间轴日期序列：[today-30 ... today+30]
  const days = useMemo(() => {
    const out: { key: string; label: string; weekday: string; isToday: boolean; offset: number }[] = [];
    for (let i = -WINDOW_DAYS; i <= WINDOW_DAYS; i++) {
      const d = today.add(i, "day");
      const key = d.format("YYYY-MM-DD");
      out.push({
        key,
        label: d.format("MM/DD"),
        weekday: d.format("ddd"),
        isToday: i === 0,
        offset: i,
      });
    }
    return out;
  }, [today]);

  // 按日期分桶 + 未排期桶
  const { byDate, noDue } = useMemo(() => {
    const m = new Map<string, Task[]>();
    const none: Task[] = [];
    for (const t of tasks) {
      const k = normalizeDate(t.due_date);
      if (!k) {
        none.push(t);
        continue;
      }
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return { byDate: m, noDue: none };
  }, [tasks]);

  if (tasks.length === 0) {
    return <EmptyState icon="task" title="暂无任务" compact />;
  }

  return (
    <div className="tl-wrap">
      {/* 时间轴说明 */}
      <div className="tl-header">
        <Text strong>时间线</Text>
        <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
          今日中轴 · 前后 {WINDOW_DAYS} 天 · 无 due_date 归「未排期」 · 悬停日期格查看任务
        </Text>
      </div>

      <div className="tl-body">
        {/* 横向滚动时间轴 */}
        <div className="tl-track">
          {/* 中轴线提示 */}
          <div className="tl-axis-label">
            <Text type="secondary" style={{ fontSize: 11 }}>← 过去</Text>
            <Text strong style={{ fontSize: 11, color: "#10b981" }}>今日</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>未来 →</Text>
          </div>

          <div className="tl-cells">
            {days.map((d) => {
              const dayTasks = byDate.get(d.key) ?? [];
              const hasOverdue = d.offset < 0 && dayTasks.length > 0;
              return (
                <div
                  key={d.key}
                  className={`tl-cell${d.isToday ? " today" : ""}${hasOverdue ? " overdue" : ""}${dayTasks.length > 0 ? " has" : ""}`}
                >
                  <div className="tl-cell-date">
                    <Text strong={d.isToday} style={{ fontSize: 12 }}>{d.label}</Text>
                    <Text type="secondary" style={{ fontSize: 10 }}>{d.weekday}</Text>
                  </div>
                  {/* 任务堆叠展示：超过 3 条用计数角标 + Tooltip 列出 */}
                  <Tooltip
                    title={
                      dayTasks.length === 0 ? (
                        <span style={{ fontSize: 12 }}>{d.key}（无任务）</span>
                      ) : (
                        <div style={{ maxWidth: 260 }}>
                          <div style={{ marginBottom: 4, fontSize: 12, opacity: 0.7 }}>
                            {d.key} · {dayTasks.length} 条
                          </div>
                          {dayTasks.slice(0, 8).map((t) => (
                            <div key={t.id} style={{ fontSize: 12, marginBottom: 2, display: "flex", gap: 4 }}>
                              <AppIcon name={t.done ? "check" : "border"} size={12} color={t.done ? "#52c41a" : undefined} /> {t.text}
                            </div>
                          ))}
                          {dayTasks.length > 8 && (
                            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                              还有 {dayTasks.length - 8} 条...
                            </div>
                          )}
                        </div>
                      )
                    }
                    placement="top"
                  >
                    <div className="tl-cell-bar">
                      {/* 任务卡片直接渲染（最多 3 条可见，超出 Badge 计数） */}
                      {dayTasks.slice(0, 3).map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          sourceNote={noteById.get(t.note_id)}
                          effectiveUrgency={urgencyMap?.get(t.id)}
                          onOpen={onOpen}
                          onToggle={onToggle}
                          containerId={`tl-${d.key}`}
                          compact
                        />
                      ))}
                      {dayTasks.length > 3 && (
                        <Badge
                          count={dayTasks.length}
                          style={{ backgroundColor: hasOverdue ? "#ef4444" : "var(--ob-accent)" }}
                          overflowCount={99}
                        />
                      )}
                    </div>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        </div>

        {/* 未排期侧栏 */}
        <div className="tl-undated">
          <div className="tl-undated-header">
            <Tag color="default">未排期</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>{noDue.length}</Text>
          </div>
          <div className="tl-undated-body">
            {noDue.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12, padding: 8 }}>
                无未排期任务
              </Text>
            ) : (
              noDue.slice(0, 50).map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  sourceNote={noteById.get(t.note_id)}
                  effectiveUrgency={urgencyMap?.get(t.id)}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  containerId="tl-undated"
                  compact
                />
              ))
            )}
            {noDue.length > 50 && (
              <Text type="secondary" style={{ fontSize: 11, textAlign: "center", marginTop: 4 }}>
                仅显示前 50 条（共 {noDue.length}）
              </Text>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
