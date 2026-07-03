// 任务卡（紧凑：checkbox + 标题 + meta[分类/期限/重复/子计划数] + 选中态 + 拖拽）。
// 从 PlannerPage 抽离（阶段 3a 纯展示拆分）。
// 关键：保留 draggingRef prop + onClick 守卫——防四象限拖拽松手误触发打开详情（dnd-kit 社区标准解法）。
import { useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import AppIcon from "../AppIcon";
import { todayStr } from "./constants";
import type { Task } from "../../types";

export interface PlannerTaskCardProps {
  task: Task;
  selected: boolean;
  childCount: number;
  onSelect: () => void;
  onToggle: (t: Task, done: boolean) => void;
  catName: string;
  draggingRef: { current: boolean };
}

export default function PlannerTaskCard({
  task,
  selected,
  childCount,
  onSelect,
  onToggle,
  catName: catLabel,
  draggingRef,
}: PlannerTaskCardProps) {
  const hasChildren = childCount > 0;
  const canDrag = task.source_line != null;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: !canDrag,
  });

  // 完成收束动效（记忆点③）：检测 done 由 false→true 的翻转，触发一次 scale 收束动画。
  // onAnimationEnd 清状态，下次勾选可再次触发；prefers-reduced-motion 由 index.css 全局兜底。
  const prevDone = useRef(task.done);
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    if (task.done && !prevDone.current) setBurst(true);
    prevDone.current = task.done;
  }, [task.done]);

  const due = task.due_date ? task.due_date.slice(5) : "无期限";
  const overdue = task.due_date ? task.due_date < todayStr() : false;
  return (
    <div
      ref={setNodeRef}
      className={`planner-task-card ${selected ? "selected" : ""} ${isDragging ? "dragging" : ""} ${burst ? "just-completed" : ""} ${!canDrag ? "ghost" : ""}`}
      onAnimationEnd={() => {
        if (burst) setBurst(false);
      }}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!draggingRef.current) onSelect(); // 拖拽松手后的误触 click 抑制
      }}
    >
      {task.source_line != null && (
        <input
          type="checkbox"
          className="planner-ck"
          checked={task.done}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggle(task, e.target.checked)}
        />
      )}
      <div className="planner-task-main">
        <div className={`planner-tc-title ${task.done ? "done" : ""}`}>
          {hasChildren && (
            <span className="planner-collection-badge" title="计划合集">
              <AppIcon name="folder" size={12} />
            </span>
          )}
          {task.text}
        </div>
        <div className="planner-tc-meta">
          {catLabel && <span>{catLabel}</span>}
          <span
            className={overdue ? "overdue" : ""}
            style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
          >
            {overdue && <AppIcon name="warning" size={11} color="var(--q1)" />}
            <AppIcon name="calendar" size={11} />
            {due}
          </span>
          {task.repeat_rule && <AppIcon name="reload" size={11} />}
          {hasChildren && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
              <AppIcon name="apps" size={11} />
              {childCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
