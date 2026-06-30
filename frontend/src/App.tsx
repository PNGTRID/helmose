// Helmose · Obsidian 式工作台外壳
// Ribbon + 左文件面板（可拖拽宽）+ 中标签页编辑区 + 右反向链接面板（可拖拽宽）+ 底状态栏
import { useEffect, useState, type MouseEvent } from "react";
import { Spin } from "antd";
import * as api from "./api";
import { useVaultStore } from "./stores/vault";
import { useTabsStore } from "./stores/tabs";
import OnboardingPage from "./pages/OnboardingPage";
import Ribbon from "./components/Ribbon";
import FilePanel from "./components/FilePanel";
import SidePanel from "./components/SidePanel";
import TabBar from "./components/TabBar";
import StatusBar from "./components/StatusBar";
import NoteView from "./components/NoteView";
import CommandPalette from "./components/CommandPalette";
import GraphPage from "./pages/GraphPage";
import TasksPage from "./pages/TasksPage";
import TodayPage from "./pages/TodayPage";
import ProjectsPage from "./pages/ProjectsPage";
import CalendarPage from "./pages/CalendarPage";
import JournalPage from "./pages/JournalPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  const { vault, loading, load } = useVaultStore();
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const filePanelOpen = useTabsStore((s) => s.filePanelOpen);
  const sidePanelOpen = useTabsStore((s) => s.sidePanelOpen);

  const [fileWidth, setFileWidth] = useState(280);
  const [sideWidth, setSideWidth] = useState(300);

  useEffect(() => {
    (async () => {
      await load();
      const v = useVaultStore.getState().vault;
      if (!v) return;
      if (!v.last_indexed) {
        useVaultStore.getState().index();
      } else {
        const needs = await api.shouldReindex(v.id).catch(() => false);
        if (needs) useVaultStore.getState().index();
      }
    })();
  }, [load]);

  useEffect(() => {
    if (vault) api.startWatcher(vault.id).catch(() => {});
  }, [vault?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        const s = useTabsStore.getState();
        s.setPalette(!s.paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 拖拽改面板宽度（左：拖右移变宽；右：拖左移变宽）
  const startResize = (which: "file" | "side") => (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = which === "file" ? fileWidth : sideWidth;
    const onMove = (ev: globalThis.MouseEvent) => {
      const dx = ev.clientX - startX;
      if (which === "file") setFileWidth(Math.max(180, Math.min(560, startW + dx)));
      else setSideWidth(Math.max(180, Math.min(560, startW - dx)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  if (loading) {
    return <Spin fullscreen tip="加载 Helmose…" />;
  }
  if (!vault) {
    return <OnboardingPage />;
  }

  const active = tabs.find((t) => t.id === activeId);
  const renderContent = () => {
    if (!active) {
      return (
        <div className="ob-empty">
          <div style={{ fontSize: 28 }}>⚓</div>
          <div>用 Ctrl/⌘+P 搜索，或点击左侧文件树打开笔记</div>
        </div>
      );
    }
    switch (active.type) {
      case "note":
        return active.noteId ? <NoteView noteId={active.noteId} /> : null;
      case "graph":
        return <GraphPage />;
      case "today":
        return <TodayPage />;
      case "tasks":
        return <TasksPage />;
      case "projects":
        return <ProjectsPage />;
      case "calendar":
        return <CalendarPage />;
      case "journal":
        return <JournalPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return null;
    }
  };

  return (
    <div className="ob-app">
      <Ribbon />
      {filePanelOpen && <FilePanel width={fileWidth} />}
      {filePanelOpen && <div className="ob-resizer" onMouseDown={startResize("file")} />}
      <div className="ob-main">
        <TabBar />
        <div className="ob-content">{renderContent()}</div>
        <StatusBar />
      </div>
      {sidePanelOpen && <div className="ob-resizer" onMouseDown={startResize("side")} />}
      {sidePanelOpen && <SidePanel width={sideWidth} />}
      <CommandPalette />
    </div>
  );
}
