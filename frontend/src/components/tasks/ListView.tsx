// 任务列表视图：抽出 TasksPage dueGroups 逻辑 + 顶部多分组维度 Segmented。
// 维度：按到期日 / 项目 / 状态 / 优先级。组可折叠（简单 toggle）。
// M2：组内按 parent_task_id 二次分组——顶层任务为主卡片，子任务折叠在父下「+N 子任务」
// 可点展开（缩进显示）；子任务全完成时父任务卡片下方提示「可勾选完成父任务」。
// 分组逻辑复用 utils/taskGrouping（单一源 + 可单测）；本组件只管 UI（Collapse + 卡片渲染）。
import { useMemo, useState } from "react";
import { Button, Segmented, Collapse, Typography } from "antd";
import EmptyState from "../EmptyState";
import type { Task, NoteMeta } from "../../types";
import type { TaskGroupBy } from "../../stores/taskView";
import {
  groupTasksByDue,
  groupTasksByProject,
  groupTasksByStatus,
  groupTasksByPriority,
  type TaskGroup,
} from "../../utils/taskGrouping";
import TaskCard from "./TaskCard";

const { Text } = Typography;

interface Props {
  tasks: Task[];
  /** 紧急度派生值（由父 TasksPage useMemo 计算并注入），key=task.id，value='high'|'mid'|'low' */
  urgencyMap?: Map<string, "high" | "mid" | "low">;
  /** 当前分组维度（受控） */
  groupBy: TaskGroupBy;
  onGroupByChange: (g: TaskGroupBy) => void;
  /** 来源笔记元数据（卡片显示 file_name 用） */
  noteById: Map<string, NoteMeta>;
  /** 点击卡片 → 父打开 Drawer */
  onOpen: (t: Task) => void;
  /** 勾选完成态写回 */
  onToggle: (t: Task, done: boolean) => void;
  /**
   * 已完成的子任务列表（TasksPage 在 tab=open 时额外拉一次 done 传入，用于判定
   * 「父任务的子任务是否全部完成」）。tab=done 时无意义（已是已完成列表）。
   */
  doneChildrenHint?: Task[];
}

const GROUP_OPTIONS = [
  { label: "按到期日", value: "due" as const },
  { label: "按项目", value: "project" as const },
  { label: "按状态", value: "status" as const },
  { label: "按优先级", value: "priority" as const },
];

export default function ListView({
  tasks,
  urgencyMap,
  groupBy,
  onGroupByChange,
  noteById,
  onOpen,
  onToggle,
  doneChildrenHint,
}: Props) {
  // 折叠状态："all" = 全展开（默认）；用户点折叠某组后变具体 string[]。
  const [activeKeys, setActiveKeys] = useState<string[] | "all">("all");
  // 展开的父任务 id 集合（每个父任务下「+N 子任务」按钮独立 toggle）
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  const groups = useMemo<TaskGroup[]>(() => {
    switch (groupBy) {
      case "due":
        return groupTasksByDue(tasks);
      case "project":
        return groupTasksByProject(tasks, noteById);
      case "status":
        return groupTasksByStatus(tasks);
      case "priority":
        return groupTasksByPriority(tasks);
      default:
        return groupTasksByDue(tasks);
    }
  }, [tasks, groupBy, noteById]);

  // 按 parent_task_id 二次分组：返回 parentId → 子任务列表 的映射。
  // 接收「当前要计算的任务集合」——分组场景传入 g.items（仅本组任务），
  // 保证「+N 子任务」计数与展开渲染都只含落在该组的子任务（杜绝跨组虚高）。
  const buildChildrenByParent = (items: Task[]): Map<string, Task[]> => {
    const m = new Map<string, Task[]>();
    for (const t of items) {
      const pid = t.parent_task_id;
      if (!pid) continue;
      if (!m.has(pid)) m.set(pid, []);
      m.get(pid)!.push(t);
    }
    return m;
  };

  // 全局已完成子任务 → 父 id 集合（仅 doneChildrenHint 非空时计算）。
  // 用于「父任务的所有子任务是否全部完成」判定。
  const doneChildrenByParent = useMemo(() => {
    const m = new Map<string, number>();
    if (!doneChildrenHint) return m;
    for (const t of doneChildrenHint) {
      const pid = t.parent_task_id;
      if (!pid) continue;
      m.set(pid, (m.get(pid) ?? 0) + 1);
    }
    return m;
  }, [doneChildrenHint]);

  // "all" 展开为当前所有 group label（受控 activeKey 不能依赖 defaultActiveKey，故显式展开）
  const effectiveActiveKeys =
    activeKeys === "all" ? groups.map((g) => g.label) : activeKeys;

  if (tasks.length === 0) {
    return <EmptyState icon="task" title="暂无任务" compact />;
  }

  const toggleParent = (pid: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Segmented
          options={GROUP_OPTIONS}
          value={groupBy}
          onChange={(v) => onGroupByChange(v as TaskGroupBy)}
          size="small"
        />
      </div>
      <Collapse
        activeKey={effectiveActiveKeys}
        onChange={(keys) => setActiveKeys(keys as string[])}
        items={groups.map((g, idx) => ({
          key: g.label,
          label: (
            <Text
              strong
              style={{
                color: g.label.startsWith("逾期")
                  ? "#ef4444"
                  : g.label.startsWith("今天")
                    ? "#10b981"
                    : g.label.startsWith("本周")
                      ? "#3b82f6"
                      : undefined,
              }}
            >
              {g.label}
            </Text>
          ),
          children: (
            <div>
              {(() => {
                // 本组内按 parent_task_id 二次分组——只含落在 g.items 的子任务。
                // 关键：分组维度不同时，同一父的子任务可能落在别组，这里只统计本组可见的。
                const childrenByParentInGroup = buildChildrenByParent(g.items);
                return g.items.map((t) => {
                // 顶层任务（parent_task_id=null）才作为主卡片渲染；
                // 子任务（parent_task_id 非空）只在父任务展开时缩进显示，不独立渲染。
                if (t.parent_task_id != null) return null;
                const children = childrenByParentInGroup.get(t.id) ?? [];
                const expanded = expandedParents.has(t.id);
                // 「子任务全完成」判定：父在本组无可见未完成子（children.length===0），
                // 但 doneChildrenHint 显示该父有 ≥1 已完成子任务（即子任务都完成）。
                // 仅 tab=open 父任务本身未完成时提示（提示用户可勾选完成父）。
                const doneCount = doneChildrenByParent.get(t.id) ?? 0;
                const allChildrenDone =
                  children.length === 0 &&
                  doneCount > 0 &&
                  t.status !== "done";
                return (
                  <div key={t.id}>
                    <TaskCard
                      task={t}
                      sourceNote={noteById.get(t.note_id)}
                      effectiveUrgency={urgencyMap?.get(t.id)}
                      onOpen={onOpen}
                      onToggle={onToggle}
                      containerId={`list-${groupBy}-${idx}`}
                      draggable={false}
                    />
                    {/* 父任务折叠态显示「+N 子任务」可展开按钮 */}
                    {children.length > 0 && (
                      <div style={{ marginLeft: 28, marginTop: 2 }}>
                        <Button
                          type="link"
                          size="small"
                          onClick={() => toggleParent(t.id)}
                          style={{ padding: 0, height: "auto", fontSize: 12 }}
                        >
                          {expanded
                            ? "▾ 收起子任务"
                            : `+${children.length} 子任务（已完成 ${
                                children.filter((c) => c.status === "done").length
                              }/${children.length}）`}
                        </Button>
                      </div>
                    )}
                    {/* 父任务的子任务全部完成 → 提示勾选完成父任务（仅 tab=open 出现，因父本身未完成） */}
                    {allChildrenDone && (
                      <div
                        style={{
                          marginLeft: 28,
                          marginTop: 4,
                          fontSize: 12,
                          color: "#10b981",
                        }}
                      >
                        ✓ 子任务全部完成，可勾选完成父任务
                      </div>
                    )}
                    {/* 展开态：渲染子任务列表（缩进显示） */}
                    {expanded &&
                      children.map((c) => (
                        <div
                          key={c.id}
                          style={{ marginLeft: 28, marginTop: 4 }}
                        >
                          <TaskCard
                            task={c}
                            sourceNote={noteById.get(c.note_id)}
                            effectiveUrgency={urgencyMap?.get(c.id)}
                            onOpen={onOpen}
                            onToggle={onToggle}
                            containerId={`list-${groupBy}-${idx}`}
                            draggable={false}
                            compact
                          />
                        </div>
                      ))}
                  </div>
                );
                });
              })()}
            </div>
          ),
        }))}
        size="small"
        bordered={false}
      />
    </div>
  );
}
