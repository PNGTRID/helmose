// 日志页：列出 note_type 为 experience / log 的笔记，按月分组（Collapse 折叠，默认展开最新月）。
// 点击 openNoteFromMeta → NoteView 打开。destroyInactivePanel 只渲染展开月，省 DOM。
import { useMemo } from "react";
import { Collapse, List, Tag, Typography } from "antd";
import { useVaultStore } from "../stores/vault";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { openNoteFromMeta } from "../utils/note";
import DataState from "../components/DataState";
import type { NoteMeta } from "../types";

const { Text } = Typography;

const TYPE_LABEL: Record<string, string> = {
  log: "日志",
  experience: "经历",
};
const TYPE_COLOR: Record<string, string> = {
  log: "blue",
  experience: "purple",
};

export default function JournalPage() {
  const vault = useVaultStore((s) => s.vault);
  const { notes, loading, error } = useAllNotesMeta();

  // 过滤 experience / log，按 date_iso 倒序
  const journal = useMemo(() => {
    return notes
      .filter((n) => n.note_type === "experience" || n.note_type === "log")
      .sort((a, b) => {
        const da = a.date_iso ?? "";
        const db = b.date_iso ?? "";
        return da < db ? 1 : da > db ? -1 : 0;
      });
  }, [notes]);

  // 按月分组（YYYY-MM，无日期归"未知"），月份倒序
  const groups = useMemo(() => {
    const m = new Map<string, NoteMeta[]>();
    for (const n of journal) {
      const month = n.date_iso?.slice(0, 7) ?? "未知";
      if (!m.has(month)) m.set(month, []);
      m.get(month)!.push(n);
    }
    return [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      .map(([month, items]) => ({ month, items }));
  }, [journal]);

  if (!vault) return null;

  const logCount = journal.filter((n) => n.note_type === "log").length;
  const expCount = journal.length - logCount;

  const collapseItems = groups.map((g) => ({
    key: g.month,
    label: (
      <span>
        <Text strong>{g.month}</Text>
        <Tag style={{ marginLeft: 8 }}>{g.items.length}</Tag>
      </span>
    ),
    children: (
      <List
        size="small"
        dataSource={g.items}
        renderItem={(n) => {
          const t = n.note_type ?? "";
          return (
            <List.Item
              style={{ cursor: "pointer", padding: "6px 0" }}
              onClick={() => openNoteFromMeta(n)}
            >
              <List.Item.Meta
                title={<Text ellipsis>{n.title ?? n.file_name}</Text>}
                description={
                  <span>
                    <Tag color={TYPE_COLOR[t] ?? "default"} style={{ marginRight: 6 }}>
                      {TYPE_LABEL[t] ?? t}
                    </Tag>
                    {n.date_iso && (
                      <Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>
                        {n.date_iso}
                      </Text>
                    )}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {n.rel_path}
                    </Text>
                  </span>
                }
              />
            </List.Item>
          );
        }}
      />
    ),
  }));

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ fontSize: 16 }}>
          日志
        </Text>
        <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
          {journal.length} 篇 · 日志 {logCount} / 经历 {expCount} · 按月分组 · 点击打开
        </Text>
      </div>

      <DataState
        loading={loading}
        error={error}
        errorTitle="笔记加载失败"
        empty={journal.length === 0}
        emptyText="暂无日志/经历笔记（note_type 需为 experience 或 log，并已索引）"
      >
        <Collapse
          items={collapseItems}
          defaultActiveKey={groups[0] ? [groups[0].month] : []}
          destroyInactivePanel
        />
      </DataState>
    </div>
  );
}
