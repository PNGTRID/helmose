// 顶部标签页栏（Obsidian 式多 tab）+ 右键菜单（关闭其他/右侧/全部）
import "./TabBar.css";
import { Dropdown } from "antd";
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
  const closeOthers = useTabsStore((s) => s.closeOthers);
  const closeToRight = useTabsStore((s) => s.closeToRight);
  const closeAll = useTabsStore((s) => s.closeAll);

  if (tabs.length === 0) return null;

  const menuFor = (t: Tab) => ({
    items: [
      { key: "close", label: "关闭", onClick: () => close(t.id) },
      { key: "others", label: "关闭其他", onClick: () => closeOthers(t.id) },
      { key: "right", label: "关闭右侧", onClick: () => closeToRight(t.id) },
      { key: "all", label: "关闭全部", onClick: () => closeAll() },
    ],
  });

  return (
    <div className="ob-tabbar">
      {tabs.map((t) => (
        <Dropdown key={t.id} menu={menuFor(t)} trigger={["contextMenu"]}>
          <div
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
        </Dropdown>
      ))}
    </div>
  );
}

