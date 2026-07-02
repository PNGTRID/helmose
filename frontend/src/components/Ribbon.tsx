// Ribbon：最左竖排图标+文字条（Obsidian 式左侧导航，带文字便于新用户识别）
// 视觉规约：active 态 = 左侧 2px 主色 indicator + primary-bg（见 Ribbon.css）；图标统一走 AppIcon；
//          原生 title 换 antd Tooltip（带快捷键，mouseEnterDelay=0.3 避免误弹）。
import "./Ribbon.css";
import { Tooltip } from "antd";
import AppIcon from "./AppIcon";
import { useTabsStore, type TabType } from "../stores/tabs";

export default function Ribbon() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const filePanelOpen = useTabsStore((s) => s.filePanelOpen);
  const sidePanelOpen = useTabsStore((s) => s.sidePanelOpen);
  const openView = useTabsStore((s) => s.openView);
  const toggleFile = useTabsStore((s) => s.toggleFile);
  const toggleSide = useTabsStore((s) => s.toggleSide);
  const setPalette = useTabsStore((s) => s.setPalette);

  const active = tabs.find((t) => t.id === activeId);
  const isActiveView = (t: TabType) => active?.type === t && active.id === `view:${t}`;

  return (
    <div className="ob-ribbon">
      <div className="ob-ribbon-brand" title="Helmose">
        <AppIcon name="anchor" size={22} />
      </div>
      <Tooltip title="文件树  ⌘B" placement="right" mouseEnterDelay={0.3}>
        <button
          className={`ob-ribbon-btn ${filePanelOpen ? "active" : ""}`}
          onClick={toggleFile}
        >
          <AppIcon name="folder-open" />
          <span className="ob-ribbon-label">文件</span>
        </button>
      </Tooltip>
      <Tooltip title="搜索  ⌘P" placement="right" mouseEnterDelay={0.3}>
        <button className="ob-ribbon-btn" onClick={() => setPalette(true)}>
          <AppIcon name="search" />
          <span className="ob-ribbon-label">搜索</span>
        </button>
      </Tooltip>
      <Tooltip title="关系图谱" placement="right" mouseEnterDelay={0.3}>
        <button
          className={`ob-ribbon-btn ${isActiveView("graph") ? "active" : ""}`}
          onClick={() => openView("graph", "图谱")}
        >
          <AppIcon name="graph" />
          <span className="ob-ribbon-label">图谱</span>
        </button>
      </Tooltip>
      <Tooltip title="今日聚焦  ⌘J" placement="right" mouseEnterDelay={0.3}>
        <button
          className={`ob-ribbon-btn ${isActiveView("today") ? "active" : ""}`}
          onClick={() => openView("today", "今日聚焦")}
        >
          <AppIcon name="today" />
          <span className="ob-ribbon-label">今日</span>
        </button>
      </Tooltip>
      <Tooltip title="任务" placement="right" mouseEnterDelay={0.3}>
        <button
          className={`ob-ribbon-btn ${isActiveView("tasks") ? "active" : ""}`}
          onClick={() => openView("tasks", "任务")}
        >
          <AppIcon name="task" />
          <span className="ob-ribbon-label">任务</span>
        </button>
      </Tooltip>
      <Tooltip title="今日计划（四象限）" placement="right" mouseEnterDelay={0.3}>
        <button
          className={`ob-ribbon-btn ${isActiveView("planner") ? "active" : ""}`}
          onClick={() => openView("planner", "今日计划")}
        >
          <AppIcon name="planner" />
          <span className="ob-ribbon-label">计划</span>
        </button>
      </Tooltip>
      <Tooltip title="项目与 OKR" placement="right" mouseEnterDelay={0.3}>
        <button
          className={`ob-ribbon-btn ${isActiveView("projects") ? "active" : ""}`}
          onClick={() => openView("projects", "项目")}
        >
          <AppIcon name="project" />
          <span className="ob-ribbon-label">项目</span>
        </button>
      </Tooltip>
      <Tooltip title="日历" placement="right" mouseEnterDelay={0.3}>
        <button
          className={`ob-ribbon-btn ${isActiveView("calendar") ? "active" : ""}`}
          onClick={() => openView("calendar", "日历")}
        >
          <AppIcon name="calendar" />
          <span className="ob-ribbon-label">日历</span>
        </button>
      </Tooltip>
      <Tooltip title="日志" placement="right" mouseEnterDelay={0.3}>
        <button
          className={`ob-ribbon-btn ${isActiveView("journal") ? "active" : ""}`}
          onClick={() => openView("journal", "日志")}
        >
          <AppIcon name="journal" />
          <span className="ob-ribbon-label">日志</span>
        </button>
      </Tooltip>
      <div className="ob-ribbon-spacer" />
      <Tooltip title="右侧面板  ⌘\" placement="right" mouseEnterDelay={0.3}>
        <button
          className={`ob-ribbon-btn ${sidePanelOpen ? "active" : ""}`}
          onClick={toggleSide}
        >
          <AppIcon name="side" />
          <span className="ob-ribbon-label">侧栏</span>
        </button>
      </Tooltip>
      <Tooltip title="设置" placement="right" mouseEnterDelay={0.3}>
        <button
          className={`ob-ribbon-btn ${isActiveView("settings") ? "active" : ""}`}
          onClick={() => openView("settings", "设置")}
        >
          <AppIcon name="setting" />
          <span className="ob-ribbon-label">设置</span>
        </button>
      </Tooltip>
    </div>
  );
}
