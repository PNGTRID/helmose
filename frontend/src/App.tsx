// Helmose · Obsidian 式工作台外壳
// Ribbon + 左文件面板（可拖拽宽）+ 中标签页编辑区 + 右反向链接面板（可拖拽宽）+ 底状态栏
import { useEffect, useState, type MouseEvent } from "react";
import { Input, List, Modal, Spin, Typography } from "antd";
import * as api from "./api";
import { useVaultStore } from "./stores/vault";
import { useTabsStore } from "./stores/tabs";
import type { SearchResult } from "./types";
import OnboardingPage from "./pages/OnboardingPage";
import Ribbon from "./components/Ribbon";
import FilePanel from "./components/FilePanel";
import SidePanel from "./components/SidePanel";
import TabBar from "./components/TabBar";
import StatusBar from "./components/StatusBar";
import NoteView from "./components/NoteView";
import GraphPage from "./pages/GraphPage";
import TasksPage from "./pages/TasksPage";
import TodayPage from "./pages/TodayPage";
import SettingsPage from "./pages/SettingsPage";

const { Text } = Typography;

function CommandPalette() {
  const open = useTabsStore((s) => s.paletteOpen);
  const setPalette = useTabsStore((s) => s.setPalette);
  const vault = useVaultStore((s) => s.vault);
  const openNote = useTabsStore((s) => s.openNote);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!vault) return;
    const kw = q.trim();
    if (!kw) {
      setResults([]);
      return;
    }
    const h = setTimeout(() => {
      api.searchNotes(vault.id, kw, 20).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(h);
  }, [q, vault?.id, open]);

  const pick = (r: SearchResult) => {
    openNote({ id: r.id, title: r.title, file_name: r.file_name, rel_path: r.rel_path });
    setPalette(false);
  };

  return (
    <Modal
      open={open}
      onCancel={() => setPalette(false)}
      footer={null}
      closable={false}
      width={560}
      styles={{ body: { padding: 12 } }}
    >
      <Input.Search
        autoFocus
        placeholder="跳转到笔记…（输入关键词，复用 FTS5 全库搜索）"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <List
        style={{ maxHeight: 360, overflow: "auto" }}
        size="small"
        dataSource={results}
        locale={{ emptyText: q.trim() ? "无匹配" : "输入关键词搜索笔记" }}
        renderItem={(r) => (
          <List.Item style={{ cursor: "pointer" }} onClick={() => pick(r)}>
            <List.Item.Meta
              title={<Text ellipsis>{r.title ?? r.file_name}</Text>}
              description={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {r.rel_path}
                </Text>
              }
            />
          </List.Item>
        )}
      />
    </Modal>
  );
}

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
