// 顶部标签页栏（Obsidian 式多 tab）
import {
  ApartmentOutlined,
  AimOutlined,
  CheckSquareOutlined,
  CloseOutlined,
  FileTextOutlined,
  ProjectOutlined,
  SettingOutlined,
  CalendarOutlined,
  BookOutlined,
} from "@ant-design/icons";
import { useTabsStore, type Tab } from "../stores/tabs";

function iconFor(t: Tab) {
  switch (t.type) {
    case "note":
      return <FileTextOutlined />;
    case "graph":
      return <ApartmentOutlined />;
    case "today":
      return <AimOutlined />;
    case "tasks":
      return <CheckSquareOutlined />;
    case "projects":
      return <ProjectOutlined />;
    case "calendar":
      return <CalendarOutlined />;
    case "journal":
      return <BookOutlined />;
    case "settings":
      return <SettingOutlined />;
  }
}

export default function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const activate = useTabsStore((s) => s.activate);
  const close = useTabsStore((s) => s.close);

  if (tabs.length === 0) return null;

  return (
    <div className="ob-tabbar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`ob-tab ${t.id === activeId ? "active" : ""}`}
          onClick={() => activate(t.id)}
        >
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            {iconFor(t)}
          </span>
          <span className="ob-tab-label">{t.title}</span>
          <span
            className="ob-tab-close"
            onClick={(e) => {
              e.stopPropagation();
              close(t.id);
            }}
          >
            <CloseOutlined />
          </span>
        </div>
      ))}
    </div>
  );
}
