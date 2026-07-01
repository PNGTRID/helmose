// 任务列表视图：抽出 TasksPage dueGroups 逻辑 + 顶部多分组维度 Segmented。
// 维度：按到期日 / 项目 / 状态 / 优先级。组可折叠（简单 toggle）。
// 分组逻辑复用 utils/taskGrouping（单一源 + 可单测）；本组件只管 UI（Collapse + 卡片渲染）。
import { useMemo, useState } from "react";
import { Segmented, Collapse, Typography, Empty } from "antd";
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
}: Props) {
  // 折叠状态："all" = 全展开（默认）；用户点折叠某组后变具体 string[]。
  const [activeKeys, setActiveKeys] = useState<string[] | "all">("all");

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

  // "all" 展开为当前所有 group label（受控 activeKey 不能依赖 defaultActiveKey，故显式展开）
  const effectiveActiveKeys =
    activeKeys === "all" ? groups.map((g) => g.label) : activeKeys;

  if (tasks.length === 0) {
    return <Empty description="暂无任务" />;
  }

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
              {g.items.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  sourceNote={noteById.get(t.note_id)}
                  effectiveUrgency={urgencyMap?.get(t.id)}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  containerId={`list-${groupBy}-${idx}`}
                  draggable={false}
                />
              ))}
            </div>
          ),
        }))}
        size="small"
        bordered={false}
      />
    </div>
  );
}
