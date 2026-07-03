// 四象限区（4 桶 droppable，视觉照搬预览：左上q3/右上q1/左下q4/右下q2 + 右下装饰大图标）。
// 从 PlannerPage 抽离（阶段 3a 纯展示拆分）。含内部 QuadBox 组件。
//
// DnD 架构（阶段四 GTD）：DndContext / sensors / handleDragEnd / DragOverlay / activeTask 已
// 提升到 PlannerPage 顶层，包裹左栏收集箱 + 中栏四象限，使收集箱↔象限可互拖。本组件只保留
// QuadBox（useDroppable + 任务卡渲染）；draggingRef 由 PlannerPage 传入（click 守卫共享）。
import { useDroppable } from "@dnd-kit/core";
import AppIcon from "../AppIcon";
import { QUADS, QUAD_ORDER, type QuadDef } from "./constants";
import { catName } from "./utils";
import PlannerTaskCard from "./PlannerTaskCard";
import type { Task } from "../../types";
import type { Quadrant } from "../../utils/taskGrouping";
import type { PlannerCategory } from "../../stores/plannerCategories";

export interface QuadrantAreaProps {
  buckets: Record<Quadrant, Task[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (t: Task, done: boolean) => void;
  taskCat: Map<string, string>;
  categories: PlannerCategory[];
  childCountByTask: Map<string, number>;
  draggingRef: { current: boolean };
}

export default function QuadrantArea({
  buckets,
  selectedId,
  onSelect,
  onToggle,
  taskCat,
  categories,
  childCountByTask,
  draggingRef,
}: QuadrantAreaProps) {
  return (
    <div className="planner-quads">
      {QUAD_ORDER.map((key) => (
        <QuadBox
          key={key}
          def={QUADS[key]}
          tasks={buckets[key]}
          selectedId={selectedId}
          onSelect={onSelect}
          onToggle={onToggle}
          taskCat={taskCat}
          categories={categories}
          childCountByTask={childCountByTask}
          draggingRef={draggingRef}
        />
      ))}
    </div>
  );
}

/** 单象限容器（Droppable + 任务卡列表） */
function QuadBox({
  def,
  tasks,
  selectedId,
  onSelect,
  onToggle,
  taskCat,
  categories,
  childCountByTask,
  draggingRef,
}: {
  def: QuadDef;
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (t: Task, done: boolean) => void;
  taskCat: Map<string, string>;
  categories: PlannerCategory[];
  childCountByTask: Map<string, number>;
  draggingRef: { current: boolean };
}) {
  const { setNodeRef, isOver } = useDroppable({ id: def.key });
  return (
    <div ref={setNodeRef} className={`planner-quad ${def.cls} ${isOver ? "over" : ""}`}>
      <div className="planner-quad-head">
        <span className="planner-quad-emoji">
          <AppIcon name={def.icon} size={15} />
        </span>
        <span className="planner-quad-name">{def.name}</span>
        <span className="planner-quad-tag">
          {def.tip} · {tasks.length}
        </span>
      </div>
      <div className="planner-quad-sub">{def.sub}</div>
      <div className="planner-quad-tasks">
        {tasks.length === 0 ? (
          <div className="planner-empty-tip">暂无任务</div>
        ) : (
          tasks.map((t) => (
            <PlannerTaskCard
              key={t.id}
              task={t}
              selected={selectedId === t.id}
              childCount={childCountByTask.get(t.id) ?? 0}
              onSelect={() => onSelect(t.id)}
              onToggle={onToggle}
              catName={catName(taskCat.get(t.id), categories)}
              draggingRef={draggingRef}
            />
          ))
        )}
      </div>
    </div>
  );
}
