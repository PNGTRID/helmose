// 任务四象限视图（艾森豪威尔矩阵）：2×2 网格 4 桶 Droppable。
//   · Q1 重要+紧急（Do First）：priority>=2 && urgency=='high'
//   · Q2 重要不紧急（Schedule）：priority>=2 && urgency!='high'
//   · Q3 紧急不重要（Delegate）：priority<2 && urgency=='high'
//   · Q4 都不（Eliminate）：priority<2 && urgency!='high'
// 拖入 Q1/Q2 → setTaskPriority(sourceLine, 2)；拖入 Q3/Q4 → setTaskPriority(sourceLine, 1)
// 拖入 Q1/Q3 → setTaskUrgency(sourceLine, 'high')；拖入 Q2/Q4 → setTaskUrgency(sourceLine, 'low')
// urgency 派生（无 🔥 按 due_date 推导）由父组件传入 urgencyMap，决定象限归属；
//   拖入高紧急象限会调 setTaskUrgency 写 🔥 固化（design 边界）。
import "./MatrixView.css";
import { useMemo, useState } from "react";
import { Typography, Empty } from "antd";
import { App } from "antd";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Task, NoteMeta, NoteContent } from "../../types";
import { classifyQuadrant, type Quadrant } from "../../utils/taskGrouping";
import TaskCard from "./TaskCard";
import * as api from "../../api";

const { Text, Title } = Typography;

interface Props {
  tasks: Task[];
  /** 紧急度派生值（无手动 🔥 时按 due_date 推导，父组件 useMemo 算并注入） */
  urgencyMap: Map<string, "high" | "mid" | "low">;
  noteById: Map<string, NoteMeta>;
  onOpen: (t: Task) => void;
  onToggle: (t: Task, done: boolean) => void;
  /** 拖拽写回成功后回调，父组件用新 NoteContent 更新本地 task id */
  onTaskWritten?: (t: Task, nc: NoteContent) => void;
}

interface QuadrantDef {
  key: Quadrant;
  title: string;
  subtitle: string;
  color: string;
}

const QUADRANTS: QuadrantDef[] = [
  { key: "q1", title: "Q1 · 重要且紧急", subtitle: "Do First", color: "#ef4444" },
  { key: "q2", title: "Q2 · 重要不紧急", subtitle: "Schedule", color: "#3b82f6" },
  { key: "q3", title: "Q3 · 紧急不重要", subtitle: "Delegate", color: "#f59e0b" },
  { key: "q4", title: "Q4 · 都不", subtitle: "Eliminate", color: "#9ca3af" },
];

/** 单象限容器 */
function QuadrantBox({
  def,
  tasks,
  noteById,
  onOpen,
  onToggle,
}: {
  def: QuadrantDef;
  tasks: Task[];
  noteById: Map<string, NoteMeta>;
  onOpen: (t: Task) => void;
  onToggle: (t: Task, done: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: def.key });
  return (
    <div
      className={`matrix-box ${isOver ? "over" : ""}`}
      ref={setNodeRef}
      style={{ borderColor: def.color }}
    >
      <div className="matrix-box-header" style={{ borderBottomColor: def.color }}>
        <Title level={5} style={{ margin: 0, color: def.color }}>
          {def.title}
        </Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {def.subtitle} · {tasks.length}
        </Text>
      </div>
      <div className="matrix-box-body">
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            sourceNote={noteById.get(t.note_id)}
            onOpen={onOpen}
            onToggle={onToggle}
            containerId={def.key}
            compact
          />
        ))}
      </div>
    </div>
  );
}

export default function MatrixView({
  tasks,
  urgencyMap,
  noteById,
  onOpen,
  onToggle,
  onTaskWritten,
}: Props) {
  const { message } = App.useApp();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // 按象限分桶
  const buckets = useMemo(() => {
    const out: Record<Quadrant, Task[]> = { q1: [], q2: [], q3: [], q4: [] };
    for (const t of tasks) {
      const eff = urgencyMap.get(t.id) ?? "low";
      out[classifyQuadrant(t, eff)].push(t);
    }
    return out;
  }, [tasks, urgencyMap]);

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
    if (task.source_line == null) {
      message.warning("聚合 section 任务不支持改优先级/紧急度");
      return;
    }
    const target = over.id as Quadrant;
    // 当前象限（拖出前的归属）
    const eff = urgencyMap.get(task.id) ?? "low";
    const currentQ = classifyQuadrant(task, eff);
    if (currentQ === target) return; // 同象限拖（顺序不变），静默

    // 计算目标 priority / urgency
    //   Q1/Q2 = important(prio>=2)；Q3/Q4 = not important(prio=1)
    //   Q1/Q3 = urgent(high)；Q2/Q4 = not urgent(low)
    const newPriority = target === "q1" || target === "q2" ? 2 : 1;
    const newUrgency: "high" | "low" = target === "q1" || target === "q3" ? "high" : "low";

    // 两步写回（priority + urgency）串行：累计最后一次 NoteContent，全部成功后再统一回调
    // onTaskWritten（审查 C4：避免第一步成功后立即 refresh 造成中间态闪烁）。
    // 任一步失败：已写入部分回调一次让父 refresh 反映真实状态（不做乐观假装），并 message.error。
    let lastNc: NoteContent | null = null;
    try {
      if (task.priority !== newPriority) {
        lastNc = await api.setTaskPriority(task.note_id, task.source_line, newPriority);
      }
      // 三态写回（Blocker #1 方案 B）：用 effective（eff，含 due_date 派生）判定，manual low 可压制派生 high。
      // 拖紧急象限且当前非 high → 写 high；拖不紧急象限且当前非 low → 写 low（派生 high 拖入 q2/q4 也写 low 压制，不再跳回）。
      if (newUrgency === "high" && eff !== "high") {
        lastNc = await api.setTaskUrgency(task.note_id, task.source_line, "high");
      } else if (newUrgency === "low" && eff !== "low") {
        lastNc = await api.setTaskUrgency(task.note_id, task.source_line, "low");
      }
      message.success(`已移到 ${QUADRANTS.find((q) => q.key === target)?.title}`);
    } catch (err) {
      message.error(`改优先级/紧急度失败：${err}`);
    } finally {
      // null = 第一步即失败，不回调，父保持原状；否则回调一次让父 refresh 拿真实最新
      if (lastNc) onTaskWritten?.(task, lastNc);
    }
  };

  if (tasks.length === 0) {
    return <Empty description="暂无任务" />;
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="matrix-grid">
        {QUADRANTS.map((q) => (
          <QuadrantBox
            key={q.key}
            def={q}
            tasks={buckets[q.key]}
            noteById={noteById}
            onOpen={onOpen}
            onToggle={onToggle}
          />
        ))}
      </div>
      {/* 轴标签 */}
      <div className="matrix-axes">
        <Text type="secondary" style={{ fontSize: 11 }}>
          纵轴：紧急度（上=高，下=低） · 横轴：重要性（左=高，右=低）
        </Text>
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            sourceNote={noteById.get(activeTask.note_id)}
            containerId="overlay"
            compact
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
