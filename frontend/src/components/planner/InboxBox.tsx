// 收集箱列表（GTD 未排程任务）：useDroppable({id:"inbox"}) + 任务用 PlannerTaskCard（useDraggable）。
// 与 QuadrantArea 的 QuadBox 对称；超 5 条默认折叠（避免挤占左栏）。
// 点击任务进详情（onSelect）；拖入象限排程、拖回收集箱清标记（handleDragEnd 在 PlannerPage）。
//
// 注意：本组件渲染的是 GTD 未排程任务（utils/taskGrouping 的 isInbox 口径），
// 与 stores/plannerCategories 的分类收集箱（SYS_INBOX）是不同概念——后者在下方「任务分类」列表。
import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import AppIcon from "../AppIcon";
import PlannerTaskCard from "./PlannerTaskCard";
import { catName } from "./utils";
import type { Task } from "../../types";
import type { PlannerCategory } from "../../stores/plannerCategories";

export interface InboxBoxProps {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (t: Task, done: boolean) => void;
  taskCat: Map<string, string>;
  categories: PlannerCategory[];
  childCountByTask: Map<string, number>;
  draggingRef: { current: boolean };
}

const FOLD = 5;

export default function InboxBox({
  tasks,
  selectedId,
  onSelect,
  onToggle,
  taskCat,
  categories,
  childCountByTask,
  draggingRef,
}: InboxBoxProps) {
  const { setNodeRef, isOver } = useDroppable({ id: "inbox" });
  const [expanded, setExpanded] = useState(false);
  const shown = expanded || tasks.length <= FOLD ? tasks : tasks.slice(0, FOLD);
  const hidden = tasks.length - shown.length;

  return (
    <div ref={setNodeRef} className={`planner-inbox-list ${isOver ? "over" : ""}`}>
      <div className="planner-inbox-row">
        <div className="planner-inbox-title">
          <AppIcon name="inbox" size={14} /> 未排程
          {tasks.length > 0 && <span className="planner-inbox-badge">{tasks.length}</span>}
        </div>
      </div>
      <div className="planner-inbox-foot">待排程 · 拖入象限排程</div>
      <div className="planner-inbox-tasks">
        {tasks.length === 0 ? (
          <div className="planner-empty-tip">无未排程任务</div>
        ) : (
          <>
            {shown.map((t) => (
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
            ))}
            {hidden > 0 && (
              <button className="planner-inbox-more" onClick={() => setExpanded(true)}>
                展开其余 {hidden} 条
              </button>
            )}
            {expanded && tasks.length > FOLD && (
              <button className="planner-inbox-more" onClick={() => setExpanded(false)}>
                收起
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
