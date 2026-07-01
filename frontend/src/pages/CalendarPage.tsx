// 日历页：antd <Calendar>，每个日期单元格标注「事件点」+「笔记数」。
// 事件来自 list_events（按可见月范围拉取），笔记来自 useAllNotesMeta（共享全量元数据）。
// 点击事件 → 解析 note_id → openNoteFromMeta 开笔记 tab；点击笔记 → 同。
// 竞态：events 拉取用 cancelled flag（组件卸载/月切换丢弃旧响应）；notes 走 useAllNotesMeta 自带守卫。
// 无 events 时 byDateEvents 为空 → 自然退化只显示有 date_iso 的笔记（向后兼容）。

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Calendar, Empty, List, Tag, Typography, message } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { dateKey } from "../utils/date";
import { openNoteFromMeta } from "../utils/note";
import DataState from "../components/DataState";
import type { Event, NoteMeta } from "../types";

const { Text } = Typography;

export default function CalendarPage() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const { notes, loading, error } = useAllNotesMeta();
  const [selected, setSelected] = useState<Dayjs | null>(null);
  // 可见月（面板当前月份），驱动 events 拉取范围
  const [viewMonth, setViewMonth] = useState<Dayjs>(() => dayjs());
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // events：按可见月范围拉取（前后各宽 7 天，覆盖 antd 月格边缘的邻月日期）。
  // cancelled flag：月切换/卸载时丢弃旧响应，避免旧数据覆盖新数据（竞态）。
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

  // 按 date_iso 聚合笔记（无有效日期的不进日历）
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

  // 按 event_date 聚合事件
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

  // note_id → NoteMeta（点击事件时解析源笔记用）
  const noteById = useMemo(() => {
    const m = new Map<string, NoteMeta>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);

  const todayKey = dayjs().format("YYYY-MM-DD");
  const selectedKey = selected ? selected.format("YYYY-MM-DD") : null;
  const selectedNotes = selectedKey ? byDate.get(selectedKey) ?? [] : [];
  const selectedEvents = selectedKey ? byDateEvents.get(selectedKey) ?? [] : [];

  // 所有 hook 已调用，可早返回
  if (!vault) return null;

  // 点击事件 → 解析源笔记 → 开 tab。找不到 note 时用事件信息兜底（极罕见，FK 级联下不应发生）。
  const openEvent = (ev: Event) => {
    const meta = noteById.get(ev.note_id);
    openNoteFromMeta(
      meta
        ? { id: meta.id, title: meta.title, file_name: meta.file_name, rel_path: meta.rel_path }
        : { id: ev.note_id, title: ev.title, file_name: ev.title ?? ev.note_id, rel_path: "" }
    );
  };

  // 为选中日期创建日志笔记（07_.../日志/YYYY-MM/YYYY-MM-DD.md）；已存在则提示
  const createDayNote = async () => {
    if (!vault || !selected) return;
    const date = selected.format("YYYY-MM-DD");
    const month = selected.format("YYYY-MM");
    const relPath = `07_决策与复盘/日志/${month}/${date}.md`;
    const tpl =
      `---\ntitle: ${date} 日志\ncreated: ${date}\n---\n\n# ${date}\n\n` +
      `## 今日待办\n- \n\n## 关键事件\n- \n\n## 明日待办\n- \n`;
    try {
      const nc = await api.createNote(vault.id, relPath, tpl);
      openNoteFromMeta({
        id: nc.id,
        title: `${date} 日志`,
        file_name: `${date}.md`,
        rel_path: nc.rel_path,
      });
      message.success(`已创建 ${date} 日志`);
      await useVaultStore.getState().index();
    } catch (e) {
      message.error(`创建失败（可能已存在）：${e}`);
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
          <Text strong style={{ fontSize: 16 }}>
            日历
          </Text>
          <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
            {byDateEvents.size} 个日期有事件 · {byDate.size} 个日期有笔记 · 点击日期查看详情
          </Text>
        </div>
        <DataState loading={loading} error={error} errorTitle="笔记加载失败">
          <Calendar
            value={selected ?? dayjs()}
            onPanelChange={(date) => setViewMonth(date)}
            cellRender={(date, info) => {
              // 仅月视图日期单元格标注；年视图月份单元格保留默认渲染
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
                    // 今日轻量高亮（antd 默认已高亮日期数字，此处加底色强化事件/笔记格）
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
              // 仅点击日期单元格才选中（切换月份/年份不改变选中态）
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
          width: 300,
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
                <List.Item
                  style={{ cursor: "pointer", padding: "6px 2px" }}
                  onClick={() => openEvent(item.ev)}
                >
                  <List.Item.Meta
                    avatar={<Tag color="green" style={{ margin: 0 }}>事件</Tag>}
                    title={
                      <Text ellipsis style={{ maxWidth: 200 }}>
                        {item.ev.title ?? item.ev.raw_bullet ?? "（未命名事件）"}
                      </Text>
                    }
                    description={
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.ev.event_time ? `${item.ev.event_time} · ` : ""}点击查看源笔记
                      </Text>
                    }
                  />
                </List.Item>
              ) : (
                <List.Item
                  style={{ cursor: "pointer", padding: "6px 2px" }}
                  onClick={() => openNoteFromMeta(item.n)}
                >
                  <List.Item.Meta
                    avatar={<Tag color="purple" style={{ margin: 0 }}>笔记</Tag>}
                    title={
                      <Text ellipsis style={{ maxWidth: 200 }}>
                        {item.n.title ?? item.n.file_name}
                      </Text>
                    }
                    description={
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.n.rel_path}
                      </Text>
                    }
                  />
                </List.Item>
              )
            }
          />
        )}
      </div>
    </div>
  );
}
