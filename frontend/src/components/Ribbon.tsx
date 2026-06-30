// Ribbon：最左竖排图标+文字条（Obsidian 式左侧导航，带文字便于新用户识别）
import "./Ribbon.css";
import {
  FolderOpenOutlined,
  SearchOutlined,
  ApartmentOutlined,
  AimOutlined,
  CheckSquareOutlined,
  ProjectOutlined,
  SettingOutlined,
  BlockOutlined,
  CalendarOutlined,
  BookOutlined,
} from "@ant-design/icons";
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
      <div className="ob-ribbon-brand">⚓</div>
      <button
        className={`ob-ribbon-btn ${filePanelOpen ? "active" : ""}`}
        title="文件树"
        onClick={toggleFile}
      >
        <FolderOpenOutlined />
        <span className="ob-ribbon-label">文件</span>
      </button>
      <button
        className="ob-ribbon-btn"
        title="搜索（Ctrl/⌘+P）"
        onClick={() => setPalette(true)}
      >
        <SearchOutlined />
        <span className="ob-ribbon-label">搜索</span>
      </button>
      <button
        className={`ob-ribbon-btn ${isActiveView("graph") ? "active" : ""}`}
        title="图谱"
        onClick={() => openView("graph", "图谱")}
      >
        <ApartmentOutlined />
        <span className="ob-ribbon-label">图谱</span>
      </button>
      <button
        className={`ob-ribbon-btn ${isActiveView("today") ? "active" : ""}`}
        title="今日聚焦"
        onClick={() => openView("today", "今日聚焦")}
      >
        <AimOutlined />
        <span className="ob-ribbon-label">今日</span>
      </button>
      <button
        className={`ob-ribbon-btn ${isActiveView("tasks") ? "active" : ""}`}
        title="任务"
        onClick={() => openView("tasks", "任务")}
      >
        <CheckSquareOutlined />
        <span className="ob-ribbon-label">任务</span>
      </button>
      <button
        className={`ob-ribbon-btn ${isActiveView("projects") ? "active" : ""}`}
        title="项目"
        onClick={() => openView("projects", "项目")}
      >
        <ProjectOutlined />
        <span className="ob-ribbon-label">项目</span>
      </button>
      <button
        className={`ob-ribbon-btn ${isActiveView("calendar") ? "active" : ""}`}
        title="日历"
        onClick={() => openView("calendar", "日历")}
      >
        <CalendarOutlined />
        <span className="ob-ribbon-label">日历</span>
      </button>
      <button
        className={`ob-ribbon-btn ${isActiveView("journal") ? "active" : ""}`}
        title="日志"
        onClick={() => openView("journal", "日志")}
      >
        <BookOutlined />
        <span className="ob-ribbon-label">日志</span>
      </button>
      <div className="ob-ribbon-spacer" />
      <button
        className={`ob-ribbon-btn ${sidePanelOpen ? "active" : ""}`}
        title="右侧面板"
        onClick={toggleSide}
      >
        <BlockOutlined />
        <span className="ob-ribbon-label">侧栏</span>
      </button>
      <button
        className={`ob-ribbon-btn ${isActiveView("settings") ? "active" : ""}`}
        title="设置"
        onClick={() => openView("settings", "设置")}
      >
        <SettingOutlined />
        <span className="ob-ribbon-label">设置</span>
      </button>
    </div>
  );
}
