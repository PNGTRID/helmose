// 任务统一卡片：所有视图（ListView/KanbanView/MatrixView）共享单元。
// 内容：checkbox(toggleTask) + 文本 + due_date Tag + ⭐priority + 🔄status(doing) + 来源 Tag。
// 包装：useDraggable（dnd-kit），source_line==null 的任务（聚合 section）禁用拖拽。
import "./TaskCard.css";
import { Checkbox, Tag, Tooltip, Space, Typography } from "antd";
import { useDraggable } from "@dnd-kit/core";
import AppIcon from "../../components/AppIcon";
import { useMarkingStyleStore, MARKING_STYLE_OBSIDIAN } from "../../stores/markingStyle";
import type { Task, NoteMeta } from "../../types";

const { Text } = Typography;

interface Props {
  task: Task;
  /** 来源笔记元数据（显示 file_name） */
  sourceNote?: NoteMeta;
  /** 紧急度（前端派生，用于卡片紧急角标，可选） */
  effectiveUrgency?: "high" | "mid" | "low";
  /** 点击卡片某区域（非 checkbox 非 delete）→ 打开 Drawer 预览源笔记 */
  onOpen?: (t: Task) => void;
  /** 勾选完成态写回（仅 source_line!=null 可勾） */
  onToggle?: (t: Task, done: boolean) => void;
  /** 拖拽容器 ID（看板列 / 象限桶），draggable 关联到此容器 */
  containerId?: string;
  /** 是否禁用拖拽（外部强制，如已完成列表里也允许拖但通常源 source_line==null 已禁） */
  draggable?: boolean;
  /** 是否紧凑显示（看板/象限用，行内更小） */
  compact?: boolean;
}

export default function TaskCard({
  task,
  sourceNote,
  effectiveUrgency,
  onOpen,
  onToggle,
  containerId,
  draggable = true,
  compact = false,
}: Props) {
  // 标记风格（B2：obsidian 模式 priority 显示箭头 emoji，与 buildTaskBullet 写入契约一致，切模式有可见反馈）
  const style = useMarkingStyleStore((s) => s.style);
  // useDraggable：source_line==null 的聚合任务禁拖（与就地编辑边界一致）
  const canDrag = draggable && task.source_line != null;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task, containerId },
    disabled: !canDrag,
  });

  const onClick = () => onOpen?.(task);
  const onCheckboxChange = (e: { target: { checked: boolean } }) => {
    onToggle?.(task, e.target.checked);
  };

  return (
    <div
      ref={setNodeRef}
      className={`task-card ${isDragging ? "dragging" : ""} ${compact ? "compact" : ""}`}
      {...attributes}
      {...listeners}
    >
      <div className="task-card-main" onClick={onClick}>
        <Space size={6} align="start" wrap={false} style={{ width: "100%" }}>
          {task.source_line != null && (
            <Checkbox
              checked={task.done}
              onClick={(e) => e.stopPropagation()}
              onChange={onCheckboxChange}
              style={{ marginTop: 2 }}
            />
          )}
          <div className="task-card-text">
            <Text
              delete={task.done}
              type={task.done ? "secondary" : undefined}
              style={{ wordBreak: "break-word" }}
            >
              {task.text}
            </Text>
            <div className="task-card-meta">
              <Space size={4} wrap>
                {task.due_date && <Tag color="orange">{task.due_date}</Tag>}
                {task.priority > 0 && (
                  <span
                    title={`优先级 P${4 - task.priority}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 1 }}
                  >
                    {style === MARKING_STYLE_OBSIDIAN ? (
                      // obsidian 模式：与 buildTaskBullet 写入契约一致，单箭头 emoji（3→⏫ 2→🔼 1→🔽）
                      <span style={{ fontSize: 12, lineHeight: 1 }}>
                        {task.priority === 3 ? "⏫" : task.priority === 2 ? "🔼" : "🔽"}
                      </span>
                    ) : (
                      // helmose 模式：⭐×N
                      Array.from({ length: task.priority }).map((_, i) => (
                        <AppIcon key={i} name="star" size={11} color="#faad14" />
                      ))
                    )}
                  </span>
                )}
                {task.status === "doing" && <Tag color="processing"><AppIcon name="reload" size={11} spin /> 进行中</Tag>}
                {effectiveUrgency === "high" && task.urgency === "" && (
                  <Tooltip title="按截止日期派生（未手动标记为紧急）">
                    <Tag color="red"><AppIcon name="thunder" size={11} /> 紧急</Tag>
                  </Tooltip>
                )}
                {task.urgency === "high" && <Tag color="red"><AppIcon name="fire" size={11} /></Tag>}
                {sourceNote && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {sourceNote.file_name}
                  </Text>
                )}
              </Space>
            </div>
          </div>
        </Space>
      </div>
      {!canDrag && task.source_line == null && (
        <Tooltip title="聚合 section 任务不支持拖拽改字段">
          <span className="task-card-lock"><AppIcon name="lock" size={12} /></span>
        </Tooltip>
      )}
    </div>
  );
}
