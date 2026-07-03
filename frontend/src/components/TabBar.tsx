// 顶部标签页栏（Obsidian 式多 tab）+ 拖拽重排 + 溢出滚动 + 中键关闭 + 右键菜单。
// 拖拽用 @dnd-kit（PointerSensor distance:5，避免误触 click）；active tab 自动滚入视区。
// 图标统一走 AppIcon（name 注册表），收敛直 import。
import "./TabBar.css";
import { useEffect, useRef } from "react";
import { Dropdown } from "antd";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
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

/** 单个 tab：同时是 draggable（可拖）+ droppable（可接收重排）+ Dropdown trigger（右键菜单）。
 *  三者共用同一根 div（合并 useDraggable/useDroppable 的 ref）。*/
function TabItem({
  tab,
  active,
  menu,
}: {
  tab: Tab;
  active: boolean;
  menu: { items: Array<{ key: string; label: string; onClick: () => void }> };
}) {
  const activate = useTabsStore((s) => s.activate);
  const close = useTabsStore((s) => s.close);
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: tab.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: tab.id });
  // 合并两个 ref 到同一根 div
  const setRef = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };
  const style = transform ? { transform: `translateX(${Math.round(transform.x)}px)` } : undefined;
  return (
    <Dropdown menu={menu} trigger={["contextMenu"]}>
      <div
        ref={setRef}
        className={`ob-tab ${active ? "active" : ""} ${isDragging ? "dragging" : ""} ${
          isOver ? "drop-target" : ""
        }`}
        style={style}
        onClick={() => activate(tab.id)}
        onMouseDown={(e) => {
          // 中键关闭（Obsidian / 浏览器习惯）
          if (e.button === 1) {
            e.preventDefault();
            close(tab.id);
          }
        }}
        {...attributes}
        {...listeners}
      >
        <span style={{ display: "inline-flex", alignItems: "center" }}>{iconFor(tab)}</span>
        <span className="ob-tab-label">{tab.title}</span>
        <span
          className="ob-tab-close"
          onClick={(e) => {
            e.stopPropagation();
            close(tab.id);
          }}
        >
          <AppIcon name="close" size={12} />
        </span>
      </div>
    </Dropdown>
  );
}

export default function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const close = useTabsStore((s) => s.close);
  const closeOthers = useTabsStore((s) => s.closeOthers);
  const closeToRight = useTabsStore((s) => s.closeToRight);
  const closeAll = useTabsStore((s) => s.closeAll);
  const moveTab = useTabsStore((s) => s.moveTab);

  // active tab 自动滚入视区（多 tab 横向溢出时，切换不被挤出可见区）
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeId || !barRef.current) return;
    const el = barRef.current.querySelector<HTMLElement>(".ob-tab.active");
    el?.scrollIntoView({ inline: "nearest", behavior: "smooth", block: "nearest" });
  }, [activeId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) moveTab(String(active.id), String(over.id));
  };

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
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="ob-tabbar" ref={barRef}>
        {tabs.map((t) => (
          <TabItem key={t.id} tab={t} active={t.id === activeId} menu={menuFor(t)} />
        ))}
      </div>
    </DndContext>
  );
}
