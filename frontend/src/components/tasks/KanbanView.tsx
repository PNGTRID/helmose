// 任务看板视图：DndContext + 3 列 Droppable（待办 todo / 进行中 doing / 已完成 done）。
// 跨列拖 → onDragEnd → 调 setTaskStatus(noteId, sourceLine, status) 写回 vault。
// 写回策略：await 后端成功后才 onTaskWritten 回流（父 refresh）；失败 message.error，前端不变即如实反映。
// source_line==null 的卡片禁用拖拽（TaskCard 内部已处理，加 tooltip）。
import "./KanbanView.css";
import { useMemo, useState } from "react";
import { Tag, Typography, Empty } from "antd";
import { App } from "antd";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import type { Task, NoteMeta, NoteContent } from "../../types";
import TaskCard from "./TaskCard";
import * as api from "../../api";

const { Text } = Typography;

interface Props {
  tasks: Task[];
  urgencyMap?: Map<string, "high" | "mid" | "low">;
  noteById: Map<string, NoteMeta>;
  onOpen: (t: Task) => void;
  onToggle: (t: Task, done: boolean) => void;
  /** 拖拽写回成功后回调，父组件用新 NoteContent 更新本地 task id（content_hash 变 id 变） */
  onTaskWritten?: (t: Task, nc: NoteContent, newStatus: string) => void;
}

/** 三列状态定义 */
const COLUMNS: { key: "todo" | "doing" | "done"; label: string; color: string }[] = [
  { key: "todo", label: "待办", color: "default" },
  { key: "doing", label: "进行中", color: "processing" },
  { key: "done", label: "已完成", color: "success" },
];

/** 单列容器（Droppable） */
function Column({
  columnKey,
  label,
  color,
  tasks,
  urgencyMap,
  noteById,
  onOpen,
  onToggle,
}: {
  columnKey: "todo" | "doing" | "done";
  label: string;
  color: string;
  tasks: Task[];
  urgencyMap?: Map<string, "high" | "mid" | "low">;
  noteById: Map<string, NoteMeta>;
  onOpen: (t: Task) => void;
  onToggle: (t: Task, done: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnKey });

  return (
    <div className={`kanban-col ${isOver ? "over" : ""}`} ref={setNodeRef}>
      <div className="kanban-col-header">
        <Tag color={color}>{label}</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {tasks.length}
        </Text>
      </div>
      <div className="kanban-col-body">
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            sourceNote={noteById.get(t.note_id)}
            effectiveUrgency={urgencyMap?.get(t.id)}
            onOpen={onOpen}
            onToggle={onToggle}
            containerId={columnKey}
            compact
          />
        ))}
      </div>
    </div>
  );
}

export default function KanbanView({
  tasks,
  urgencyMap,
  noteById,
  onOpen,
  onToggle,
  onTaskWritten,
}: Props) {
  const { message } = App.useApp();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // PointerSensor 加 5px activation distance，避免误触（点击不开拖）
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // 按状态分桶
  const buckets = useMemo(() => {
    const todo: Task[] = [];
    const doing: Task[] = [];
    const done: Task[] = [];
    for (const t of tasks) {
      if (t.status === "doing") doing.push(t);
      else if (t.status === "done" || t.done) done.push(t);
      else todo.push(t);
    }
    return { todo, doing, done };
  }, [tasks]);

  const onDragStart = (e: DragStartEvent) => {
    const t = e.active.data.current?.task as Task | undefined;
    if (t) setActiveTask(t);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = e;
    if (!over) return;
    const task = active.data.current?.task as Task | undefined;
    if (!task) return;
    // source_line==null 的聚合任务不支持改状态
    if (task.source_line == null) {
      message.warning("聚合 section 任务不支持改状态");
      return;
    }
    const targetStatus = over.id as "todo" | "doing" | "done";
    // 同列拖（仅改顺序，本期不实现顺序持久化，静默返回）
    if (task.status === targetStatus || (targetStatus === "done" && task.done)) return;

    // 写回：await setTaskStatus 成功 → onTaskWritten 回流（父 refresh 拿最新 tasks）；
    // 失败 → message.error，前端 tasks 不变（自然反映真实状态，无需 revert）。
    try {
      const nc = await api.setTaskStatus(task.note_id, task.source_line, targetStatus);
      message.success(targetStatus === "done" ? "已完成" : targetStatus === "doing" ? "已标记进行中" : "已移到待办");
      onTaskWritten?.(task, nc, targetStatus);
    } catch (err) {
      // 失败：不更新前端状态（task 引用未变，自然 revert）
      message.error(`改状态失败：${err}`);
    }
  };

  if (tasks.length === 0) {
    return <Empty description="暂无任务" />;
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="kanban-board">
        {COLUMNS.map((col) => (
          <Column
            key={col.key}
            columnKey={col.key}
            label={col.label}
            color={col.color}
            tasks={buckets[col.key]}
            urgencyMap={urgencyMap}
            noteById={noteById}
            onOpen={onOpen}
            onToggle={onToggle}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            sourceNote={noteById.get(activeTask.note_id)}
            effectiveUrgency={urgencyMap?.get(activeTask.id)}
            containerId="overlay"
            compact
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
