// 命令面板：Ctrl/⌥+P 触发。
// 有 query：FTS5 全库搜索 → snippet 高亮 → 键盘上下选/Enter 跳转。
// 空 query：快捷跳页（今日/任务/项目/日历/图谱/设置）+ 最近打开的笔记。
// 统一 items + selectedIdx + 键盘导航。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Input, List, Modal, Tag } from "antd";
import {
  ApartmentOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  CompassOutlined,
  FileTextOutlined,
  HistoryOutlined,
  ProjectOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useTabsStore, type TabType } from "../stores/tabs";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { openNoteFromMeta } from "../utils/note";
import type { NoteMeta, SearchResult } from "../types";

interface Item {
  key: string;
  node: ReactNode;
  activate: () => void;
}

const PAGES: { type: TabType; title: string; icon: ReactNode }[] = [
  { type: "today", title: "今日聚焦", icon: <CompassOutlined /> },
  { type: "planner", title: "今日计划", icon: <CheckSquareOutlined /> },
  { type: "projects", title: "项目", icon: <ProjectOutlined /> },
  { type: "calendar", title: "日历", icon: <CalendarOutlined /> },
  { type: "graph", title: "关系图谱", icon: <ApartmentOutlined /> },
  { type: "settings", title: "设置", icon: <SettingOutlined /> },
];

export default function CommandPalette() {
  const open = useTabsStore((s) => s.paletteOpen);
  const setPalette = useTabsStore((s) => s.setPalette);
  const openView = useTabsStore((s) => s.openView);
  const tabs = useTabsStore((s) => s.tabs);
  const vault = useVaultStore((s) => s.vault);
  const { notes } = useAllNotesMeta();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);

  const isQuery = q.trim().length > 0;

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
      setSelected(0);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, vault?.id, open]);

  // 最近笔记：tabs 里 type=note 的，按打开顺序倒序，去重查真实 meta
  const noteById = useMemo(() => {
    const m = new Map<string, NoteMeta>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);

  // 最近搜索：localStorage 记最近 6 个查询，空 query 时点击重填
  const [recentQueries, setRecentQueries] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("helmose-recent-queries") || "[]");
    } catch {
      return [];
    }
  });
  const recordQuery = (kw: string) => {
    setRecentQueries((prev) => {
      const next = [kw, ...prev.filter((x) => x !== kw)].slice(0, 6);
      try {
        localStorage.setItem("helmose-recent-queries", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const items: Item[] = useMemo(() => {
    if (isQuery) {
      const ql = q.trim().toLowerCase();
      const seen = new Set<string>();
      const merged: Item[] = [];
      // 文件名/标题即时匹配（FTS 不索引 file_name，这里补全；输入即出，不必等 200ms FTS）
      for (const n of notes) {
        if (merged.length >= 10) break;
        if (seen.has(n.id)) continue;
        if (
          n.file_name.toLowerCase().includes(ql) ||
          (n.title?.toLowerCase().includes(ql) ?? false)
        ) {
          seen.add(n.id);
          merged.push({
            key: n.id,
            node: (
              <>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {n.note_type && (
                    <Tag style={{ marginRight: 6, fontSize: 11 }}>{n.note_type}</Tag>
                  )}
                  {n.title ?? n.file_name}
                </div>
                <div style={{ fontSize: 12, color: "var(--ob-text-muted)" }}>{n.rel_path}</div>
              </>
            ),
            activate: () => {
              openNoteFromMeta(n);
              setPalette(false);
            },
          });
        }
      }
      // FTS 全文结果补充（snippet 含 <b> 高亮）
      for (const r of results) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push({
          key: r.id,
          node: (
            <>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.note_type && (
                  <Tag style={{ marginRight: 6, fontSize: 11 }}>{r.note_type}</Tag>
                )}
                {r.title ?? r.file_name}
              </div>
              {/* snippet 含 <b> 高亮关键词（后端 FTS5 生成），原文渲染 */}
              <div
                style={{ fontSize: 12, color: "var(--ob-text-muted)" }}
                dangerouslySetInnerHTML={{ __html: r.snippet || r.rel_path }}
              />
            </>
          ),
          activate: () => {
            if (q.trim()) recordQuery(q.trim());
            openNoteFromMeta(r);
            setPalette(false);
          },
        });
      }
      return merged;
    }
    // 空 query：跳页快捷 + 最近笔记
    const pageItems: Item[] = PAGES.map((p) => ({
      key: "page:" + p.type,
      node: (
        <span>
          <span style={{ marginRight: 8 }}>{p.icon}</span>
          {p.title}
        </span>
      ),
      activate: () => {
        openView(p.type, p.title);
        setPalette(false);
      },
    }));
    const seen = new Set<string>();
    const recentItems: Item[] = [];
    for (const t of [...tabs].reverse()) {
      if (t.type !== "note" || !t.noteId || seen.has(t.noteId)) continue;
      seen.add(t.noteId);
      const meta = noteById.get(t.noteId);
      recentItems.push({
        key: "recent:" + t.noteId,
        node: (
          <span>
            <FileTextOutlined style={{ marginRight: 8 }} />
            {t.title}
            <span style={{ fontSize: 12, color: "var(--ob-text-faint)", marginLeft: 8 }}>
              {meta?.rel_path ?? ""}
            </span>
          </span>
        ),
        activate: () => {
          if (meta) openNoteFromMeta(meta);
          setPalette(false);
        },
      });
      if (recentItems.length >= 8) break;
    }
    // 最近搜索（点击重填 q）
    const recentQueryItems: Item[] = recentQueries.map((rq) => ({
      key: "rq:" + rq,
      node: (
        <span>
          <HistoryOutlined style={{ marginRight: 8 }} />
          {rq}
        </span>
      ),
      activate: () => setQ(rq),
    }));
    return [...pageItems, ...recentItems, ...recentQueryItems];
  }, [isQuery, q, results, notes, tabs, noteById, recentQueries, openView, setPalette]);

  // 结果变化时重置选中
  useEffect(() => {
    setSelected(0);
  }, [q, results]);

  const clamp = (i: number) => (items.length === 0 ? 0 : (i + items.length) % items.length);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => clamp(s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => clamp(s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[selected];
      if (it) it.activate();
    }
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
      <Input
        autoFocus
        placeholder="跳转到笔记 / 切换页面…（↑↓ 选择，Enter 确认）"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        style={{ marginBottom: 8 }}
      />
      <List
        style={{ maxHeight: 360, overflow: "auto" }}
        size="small"
        dataSource={items}
        locale={{
          emptyText: isQuery ? "无匹配" : "开始输入搜索笔记，或选择下方快捷入口",
        }}
        renderItem={(item, idx) => (
          <List.Item
            style={{
              cursor: "pointer",
              padding: "6px 8px",
              background:
                idx === selected ? "var(--ob-accent-mod)" : "transparent",
              borderLeft: idx === selected ? "3px solid var(--ob-accent)" : "3px solid transparent",
            }}
            onMouseEnter={() => setSelected(idx)}
            onClick={() => item.activate()}
          >
            {item.node}
          </List.Item>
        )}
      />
    </Modal>
  );
}
