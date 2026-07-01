// 日历页：antd <Calendar> + 选中日期的事件/笔记列表（就地事件 CRUD + 抽屉编辑笔记，不跳 tab）。
// 事件来自 list_events（按可见月范围），笔记来自 useAllNotesMeta。
// 就地：InlineAdd 新建事件（追加该日日志「关键事件」）、InlineEdit/删除事件（source_line）。
// 点击事件/笔记/创建日志 → NoteEditorDrawer（替代 openNoteFromMeta 跳 tab）。

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Calendar, Empty, List, message, Popconfirm, Space, Tag, Typography } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { dateKey } from "../utils/date";
import DataState from "../components/DataState";
import InlineEdit from "../components/InlineEdit";
import InlineAdd from "../components/InlineAdd";
import NoteEditorDrawer from "../components/NoteEditorDrawer";
import type { Event, NoteMeta } from "../types";

const { Text } = Typography;

/** bump watcherTick 触发 events/notes 列表刷新（写入后增量索引已完成，不调全量 index） */
const bumpTick = () => useVaultStore.setState((s) => ({ watcherTick: s.watcherTick + 1 }));

export default function CalendarPage() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const { notes, loading, error } = useAllNotesMeta();
  const [selected, setSelected] = useState<Dayjs | null>(null);
  const [viewMonth, setViewMonth] = useState<Dayjs>(() => dayjs());
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [drawerNoteId, setDrawerNoteId] = useState<string | null>(null);

  // events：按可见月范围拉取（前后各宽 7 天）。cancelled flag 守竞态。
  useEffect(() => {
    if (!vault) return;
    const from = viewMonth.startOf("month").subtract(7, "day").format("YYYY-MM-DD");
    const to = viewMonth.endOf("month").add(7, "day").format("YYYY-MM-DD");
    let cancelled = false;
    setEventsLoading(true);
    setEventsError(null);
    api
      .listEvents(vault.id, from, to)
      .then((res) => {
        if (cancelled) return;
        setEvents(res);
        setEventsError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[CalendarPage] 加载事件失败", e);
        setEvents([]);
        setEventsError(typeof e === "string" ? e : (e?.message ?? String(e)));
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, viewMonth?.format("YYYY-MM"), watcherTick]);

  const byDate = useMemo(() => {
    const m = new Map<string, NoteMeta[]>();
    for (const n of notes) {
      const k = dateKey(n.date_iso);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    }
    return m;
  }, [notes]);

  const byDateEvents = useMemo(() => {
    const m = new Map<string, Event[]>();
    for (const ev of events) {
      const k = dateKey(ev.event_date);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(ev);
    }
    return m;
  }, [events]);

  const byRelPath = useMemo(() => {
    const m = new Map<string, NoteMeta>();
    for (const n of notes) m.set(n.rel_path, n);
    return m;
  }, [notes]);

  const todayKey = dayjs().format("YYYY-MM-DD");
  const selectedKey = selected ? selected.format("YYYY-MM-DD") : null;
  const selectedNotes = selectedKey ? byDate.get(selectedKey) ?? [] : [];
  const selectedEvents = selectedKey ? byDateEvents.get(selectedKey) ?? [] : [];

  if (!vault) return null;

  // 该日日志相对路径（07_决策与复盘/日志/YYYY-MM/YYYY-MM-DD.md）
  const dayNoteRelPath = (d: Dayjs) => {
    const date = d.format("YYYY-MM-DD");
    const month = d.format("YYYY-MM");
    return `07_决策与复盘/日志/${month}/${date}.md`;
  };

  // 确保该日日志存在（有则复用，无则创建），返回 note_id
  const ensureDayNote = async (d: Dayjs): Promise<string> => {
    const rel = dayNoteRelPath(d);
    const existing = byRelPath.get(rel);
    if (existing) return existing.id;
    const date = d.format("YYYY-MM-DD");
    const tpl =
      `---\ntitle: ${date} 日志\ncreated: ${date}\n---\n\n# ${date}\n\n` +
      `## 今日待办\n- [ ] 示例——今日要完成的事 📅 ${date}\n\n` +
      `## 关键事件\n- 09:00 示例——与 XX 1:1\n\n` +
      `## 明日待办\n- 示例——明天跟进 …\n`;
    const nc = await api.createNote(vault.id, rel, tpl);
    bumpTick();
    return nc.id;
  };

  const createDayNote = async () => {
    if (!selected) return;
    try {
      const id = await ensureDayNote(selected);
      setDrawerNoteId(id);
      message.success(`已创建/打开 ${selected.format("YYYY-MM-DD")} 日志`);
    } catch (e) {
      message.error(`创建失败（可能已存在）：${e}`);
    }
  };

  // —— 事件就地 CRUD ——
  const onAddEvent = async (text: string) => {
    if (!selected) return;
    try {
      const id = await ensureDayNote(selected);
      await api.appendBullet(id, "关键事件", text, false);
      message.success("已新建事件");
      bumpTick();
    } catch (e) {
      message.error(`新建失败：${e}`);
    }
  };
  const onEditEvent = async (ev: Event, newText: string) => {
    if (ev.source_line == null) return;
    try {
      await api.updateLine(ev.note_id, ev.source_line, `- ${newText}`);
      bumpTick();
    } catch (e) {
      message.error(`编辑失败：${e}`);
    }
  };
  const onDeleteEvent = async (ev: Event) => {
    if (ev.source_line == null) return;
    try {
      await api.deleteLine(ev.note_id, ev.source_line);
      message.success("已删除");
      bumpTick();
    } catch (e) {
      message.error(`删除失败：${e}`);
    }
  };

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: "var(--ob-bg-mod)",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <Text strong style={{ fontSize: 16 }}>日历</Text>
          <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
            {byDateEvents.size} 个日期有事件 · {byDate.size} 个日期有笔记 · 点击日期查看详情
          </Text>
        </div>
        <DataState loading={loading} error={error} errorTitle="笔记加载失败">
          <Calendar
            value={selected ?? dayjs()}
            onPanelChange={(date) => setViewMonth(date)}
            cellRender={(date, info) => {
              if (info.type !== "date") return info.originNode;
              const key = date.format("YYYY-MM-DD");
              const dayEvents = byDateEvents.get(key) ?? [];
              const dayNotes = byDate.get(key) ?? [];
              if (dayEvents.length === 0 && dayNotes.length === 0) return null;
              const isToday = key === todayKey;
              return (
                <div
                  style={{
                    textAlign: "center",
                    padding: 2,
                    background: isToday ? "var(--ob-bg-today, rgba(124,58,237,0.08))" : "transparent",
                    borderRadius: 4,
                  }}
                >
                  {dayNotes.length > 0 && (
                    <Badge count={dayNotes.length} style={{ backgroundColor: "#7C3AED" }} />
                  )}
                  {dayEvents.length > 0 && (
                    <div style={{ marginTop: 2 }}>
                      <Badge count={dayEvents.length} style={{ backgroundColor: "#10B981" }} />
                    </div>
                  )}
                </div>
              );
            }}
            onSelect={(date, info) => {
              if (info.source === "date") setSelected(date);
            }}
          />
        </DataState>
        {eventsError && (
          <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
            事件加载失败（{eventsError}）——仍可查看有日期的笔记
          </Text>
        )}
      </div>
      <div
        style={{
          width: 340,
          flexShrink: 0,
          background: "var(--ob-bg-mod)",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <Text strong style={{ display: "block", marginBottom: 8 }}>
          {selected
            ? `${selected.format("YYYY-MM-DD")} · ${selectedEvents.length} 事件 / ${selectedNotes.length} 篇`
            : "选中日期的笔记与事件"}
        </Text>
        {selected && (
          <InlineAdd
            placeholder="新建事件（追加该日日志「关键事件」）"
            onAdd={onAddEvent}
            style={{ marginBottom: 8 }}
          />
        )}
        {selectedEvents.length === 0 && selectedNotes.length === 0 ? (
          <>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={selected ? "当天无事件与笔记" : "点击日历上的日期"}
            />
            {selected && (
              <Button block size="small" onClick={createDayNote} style={{ marginTop: 8 }}>
                创建 {selected.format("YYYY-MM-DD")} 日志
              </Button>
            )}
          </>
        ) : (
          <List
            size="small"
            loading={eventsLoading}
            dataSource={[
              ...selectedEvents.map((ev) => ({ kind: "event" as const, ev })),
              ...selectedNotes.map((n) => ({ kind: "note" as const, n })),
            ]}
            renderItem={(item) =>
              item.kind === "event" ? (
                <List.Item style={{ padding: "6px 2px" }}>
                  <Space style={{ width: "100%" }} align="start">
                    <Tag color="green" style={{ margin: 0, flexShrink: 0 }}>事件</Tag>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {item.ev.source_line != null ? (
                        <InlineEdit
                          value={item.ev.raw_bullet ?? item.ev.title ?? ""}
                          onSave={(nt) => onEditEvent(item.ev, nt)}
                        />
                      ) : (
                        <Text ellipsis style={{ maxWidth: 200 }}>
                          {item.ev.title ?? item.ev.raw_bullet ?? "（未命名事件）"}
                        </Text>
                      )}
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.ev.event_time ? `${item.ev.event_time} · ` : ""}
                          <a onClick={() => setDrawerNoteId(item.ev.note_id)}>查看源笔记</a>
                        </Text>
                      </div>
                    </div>
                    {item.ev.source_line != null && (
                      <Popconfirm
                        title="删除该事件？"
                        onConfirm={() => onDeleteEvent(item.ev)}
                        okText="删除"
                        cancelText="取消"
                      >
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    )}
                  </Space>
                </List.Item>
              ) : (
                <List.Item
                  style={{ cursor: "pointer", padding: "6px 2px" }}
                  onClick={() => setDrawerNoteId(item.n.id)}
                >
                  <List.Item.Meta
                    avatar={<Tag color="purple" style={{ margin: 0 }}>笔记</Tag>}
                    title={
                      <Text ellipsis style={{ maxWidth: 200 }}>
                        {item.n.title ?? item.n.file_name}
                      </Text>
                    }
                    description={
                      <Text type="secondary" style={{ fontSize: 12 }}>{item.n.rel_path}</Text>
                    }
                  />
                </List.Item>
              )
            }
          />
        )}
      </div>
      <NoteEditorDrawer
        open={!!drawerNoteId}
        noteId={drawerNoteId}
        onClose={() => setDrawerNoteId(null)}
      />
    </div>
  );
}
