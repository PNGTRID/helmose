// Ribbon：最左竖排图标条（Obsidian 标志性左侧导航）
import {
  FolderOpenOutlined,
  SearchOutlined,
  ApartmentOutlined,
  AimOutlined,
  CheckSquareOutlined,
  SettingOutlined,
  BlockOutlined,
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
      </button>
      <button
        className="ob-ribbon-btn"
        title="搜索（Ctrl/⌘+P）"
        onClick={() => setPalette(true)}
      >
        <SearchOutlined />
      </button>
      <button
        className={`ob-ribbon-btn ${isActiveView("graph") ? "active" : ""}`}
        title="图谱"
        onClick={() => openView("graph", "图谱")}
      >
        <ApartmentOutlined />
      </button>
      <button
        className={`ob-ribbon-btn ${isActiveView("today") ? "active" : ""}`}
        title="今日聚焦"
        onClick={() => openView("today", "今日聚焦")}
      >
        <AimOutlined />
      </button>
      <button
        className={`ob-ribbon-btn ${isActiveView("tasks") ? "active" : ""}`}
        title="任务"
        onClick={() => openView("tasks", "任务")}
      >
        <CheckSquareOutlined />
      </button>
      <div className="ob-ribbon-spacer" />
      <button
        className={`ob-ribbon-btn ${sidePanelOpen ? "active" : ""}`}
        title="右侧面板"
        onClick={toggleSide}
      >
        <BlockOutlined />
      </button>
      <button
        className={`ob-ribbon-btn ${isActiveView("settings") ? "active" : ""}`}
        title="设置"
        onClick={() => openView("settings", "设置")}
      >
        <SettingOutlined />
      </button>
    </div>
  );
}
