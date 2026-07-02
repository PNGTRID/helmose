// 顶部标签页栏（Obsidian 式多 tab）+ 右键菜单（关闭其他/右侧/全部）
// 图标统一走 AppIcon（name 注册表），收敛直 import。
import "./TabBar.css";
import { Dropdown } from "antd";
import AppIcon from "./AppIcon";
import { useTabsStore, type Tab } from "../stores/tabs";

function iconFor(t: Tab) {
  switch (t.type) {
    case "note":
      return <AppIcon name="note" size={14} />;
    case "graph":
      return <AppIcon name="graph" size={14} />;
    case "today":
      return <AppIcon name="today" size={14} />;
    case "tasks":
      return <AppIcon name="task" size={14} />;
    case "projects":
      return <AppIcon name="project" size={14} />;
    case "calendar":
      return <AppIcon name="calendar" size={14} />;
    case "journal":
      return <AppIcon name="journal" size={14} />;
    case "settings":
      return <AppIcon name="setting" size={14} />;
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
              <AppIcon name="close" size={12} />
            </span>
          </div>
        </Dropdown>
      ))}
    </div>
  );
}
