// 属性行（▶ 可展开）。纯展示。从 PlannerPage 抽离（阶段 3a 纯展示拆分）。
// 详情面板的「计划分类 / 重要优先级 / 重复」三行可折叠属性共用此组件。
import type { ReactNode } from "react";
import AppIcon from "../AppIcon";

export interface AttrRowProps {
  label: ReactNode;
  value: ReactNode;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

export default function AttrRow({ label, value, open, onToggle, children }: AttrRowProps) {
  return (
    <div className="planner-field">
      <div className={`planner-attr-row ${open ? "open" : ""}`} onClick={onToggle}>
        <span className="planner-attr-label">{label}</span>
        <span className="planner-attr-value">
          {value} <span className="planner-attr-arrow"><AppIcon name="caret-right" size={9} /></span>
        </span>
      </div>
      <div className={`planner-attr-options ${open ? "show" : ""}`}>{children}</div>
    </div>
  );
}
