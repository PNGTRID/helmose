// Helmose · Obsidian 式工作台外壳
// Ribbon + 左文件面板（可拖拽宽）+ 中标签页编辑区 + 右反向链接面板（可拖拽宽）+ 底状态栏
import "./components/App.css";
import { useEffect, useState, type MouseEvent } from "react";
import { App as AntdApp, Modal, Spin } from "antd";
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
import ErrorBoundary from "./components/ErrorBoundary";
import { openOrCreateTodayNote } from "./utils/note";
import TasksPage from "./pages/TasksPage";
import TodayPage from "./pages/TodayPage";
import ProjectsPage from "./pages/ProjectsPage";
import CalendarPage from "./pages/CalendarPage";
import JournalPage from "./pages/JournalPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  // 经 antd <App>（main.tsx 已包）拿 context 化的 message：消费 ConfigProvider locale（task 6）。
  // 硬编码中文文案不受 locale 影响，但走 useApp 模式与 antd 6 推荐一致（why-not-static）。
  const { message } = AntdApp.useApp();
  const { vault, loading, load } = useVaultStore();
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const filePanelOpen = useTabsStore((s) => s.filePanelOpen);
  const sidePanelOpen = useTabsStore((s) => s.sidePanelOpen);

  const [fileWidth, setFileWidth] = useState(280);
  const [sideWidth, setSideWidth] = useState(300);
  const [helpOpen, setHelpOpen] = useState(false);

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

  // M2：到期提醒——拆两个独立 interval，避免每分钟做候选扫描（绝大多数周期无可发提醒）。
  //   - fireDueReminders：每 60s（走 idx_reminders_at 索引，便宜；查到期未发 → 桌面通知 + 标 fired）
  //   - ensureReminders：每 300s（5 分钟；扫 due 任务生成 reminders，幂等无副作用，降低空跑频率）
  // 注：应用未运行不发（本期不做后台守护，权限被拒静默跳过）。
  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    const fireTick = async () => {
      if (cancelled) return;
      try {
        await api.fireDueReminders();
      } catch (err) {
        console.warn("[reminders] fire 轮询失败（静默跳过）", err);
      }
    };
    const ensureTick = async () => {
      if (cancelled) return;
      try {
        await api.ensureReminders(vault.id);
      } catch (err) {
        console.warn("[reminders] ensure 轮询失败（静默跳过）", err);
      }
    };
    // 启动即触发一次（同步：先 ensure 生成候选，再 fire 发到期）
    (async () => {
      if (cancelled) return;
      try {
        await api.ensureReminders(vault.id);
        await api.fireDueReminders();
      } catch (err) {
        console.warn("[reminders] 启动轮询失败（静默跳过）", err);
      }
    })();
    const fireTimer = window.setInterval(fireTick, 60_000);
    const ensureTimer = window.setInterval(ensureTick, 300_000);
    return () => {
      cancelled = true;
      window.clearInterval(fireTimer);
      window.clearInterval(ensureTimer);
    };
  }, [vault?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const s = useTabsStore.getState();
      if (k === "p") {
        e.preventDefault();
        s.setPalette(!s.paletteOpen);
      } else if (k === "j") {
        // 今日笔记（打开或创建）
        e.preventDefault();
        openOrCreateTodayNote().catch((err) => console.error("[Ctrl+J] 今日笔记失败", err));
      } else if (k === "b") {
        // 切换左文件面板（Obsidian 式）
        e.preventDefault();
        s.toggleFile();
      } else if (k === "\\") {
        // 切换右侧栏：仅笔记页可用（侧栏内容是大纲/反链，非 note 页无意义）
        e.preventDefault();
        const cur = s.tabs.find((t) => t.id === s.activeId);
        if (cur?.type !== "note") {
          message.info("侧栏仅在笔记页可用");
          return;
        }
        s.toggleSide();
      } else if (k === "?") {
        // 帮助（避免在输入框内触发）
        const tag = (e.target as HTMLElement)?.tagName;
        const inField = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
        if (!inField) {
          e.preventDefault();
          setHelpOpen(true);
        }
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
        <div className="ob-content">
          <ErrorBoundary label="当前标签页渲染失败">
            {renderContent()}
          </ErrorBoundary>
        </div>
        <StatusBar />
      </div>
      {/* M4：侧栏仅在笔记页显示（大纲/反链对非 note 页无意义） */}
      {sidePanelOpen && active?.type === "note" && (
        <div className="ob-resizer" onMouseDown={startResize("side")} />
      )}
      {sidePanelOpen && active?.type === "note" && <SidePanel width={sideWidth} />}
      <CommandPalette />
      <Modal
        open={helpOpen}
        onCancel={() => setHelpOpen(false)}
        footer={null}
        title="键盘快捷键"
        width={440}
      >
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "8px 12px" }}>
          <kbd>⌘/Ctrl + P</kbd><span>命令面板（搜索笔记 / 跳页 / 最近）</span>
          <kbd>⌘/Ctrl + J</kbd><span>今日笔记（打开或创建）</span>
          <kbd>⌘/Ctrl + B</kbd><span>切换文件面板</span>
          <kbd>⌘/Ctrl + \\</kbd><span>切换侧栏</span>
          <kbd>?</kbd><span>显示本帮助</span>
          <kbd>Esc</kbd><span>关闭弹窗</span>
        </div>
      </Modal>
    </div>
  );
}
