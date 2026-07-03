// 品牌化空态：几何图标（AppIcon，主色舵手靛蓝）+ 标题 + 描述 + 下一步行动。
// 替代 antd <Empty>，让空态从"无数据描述"变"下一步行动"——空态是引导用户感受下一步价值的最佳位面。
// 图标用主色 + 降透明度，克制不抢戏；compact 模式嵌入列表/卡片内。
import type { ReactNode } from "react";
import AppIcon from "./AppIcon";
import "./EmptyState.css";

interface EmptyStateProps {
  /** AppIcon name，默认 note */
  icon?: string;
  /** 自定义图标节点（优先于 icon name，给特殊插画用）*/
  iconNode?: ReactNode;
  title: string;
  description?: string;
  /** 下一步行动（按钮等）*/
  action?: ReactNode;
  /** 紧凑模式（嵌入列表/卡片内，小图标小间距）*/
  compact?: boolean;
}

export default function EmptyState({
  icon = "note",
  iconNode,
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={`empty-state ${compact ? "empty-state-compact" : ""}`}>
      <div className="empty-state-icon">
        {iconNode ?? <AppIcon name={icon} size={compact ? 28 : 40} />}
      </div>
      <div className="empty-state-title">{title}</div>
      {description && <div className="empty-state-desc">{description}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
