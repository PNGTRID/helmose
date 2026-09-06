// 日历页：antd <Calendar> + 选中日期的事件/笔记列表（就地事件 CRUD + 抽屉编辑笔记，不跳 tab）。
// 事件来自 list_events（按可见月范围），笔记来自 useAllNotesMeta。
// 新建事件 → NewEventModal（ensureDayNote 注入：有则复用，无则建日志）。
// 点击事件/笔记/创建日志 → NoteEditorDrawer（替代 openNoteFromMeta 跳 tab）。
//
// M3 任务 13/14：DnD 增强
//   · 任务侧栏（拉一次未完成任务，作为 drag source）拖到日历单元格 → 时间块（写事件）
//   · 事件卡片（cellRender 内）作为 drag source，拖到另一天单元格 → 改事件日期（deleteLine + appendBullet）
//   · Shift 修饰键 = 复制（不删旧源）
//   · source_line==null 的聚合任务/事件禁拖

import "./CalendarPage.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Calendar, Empty, List, message, Popconfirm, Popover, Space, Spin, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import AppIcon from "../components/AppIcon";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import * as api from "../api";
import { notifyError } from "../utils/notifyError";
import { useVaultStore } from "../stores/vault";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { dateKey } from "../utils/date";
import { dayNoteRelPath, dailyTemplate } from "../utils/journalTemplates";
import { buildEventBullet } from "../utils/quickAdd";
import DataState from "../components/DataState";
import InlineEdit from "../components/InlineEdit";
import NoteEditorDrawer from "../components/NoteEditorDrawer";
import NewEventModal from "../components/NewEventModal";
import TaskCard from "../components/tasks/TaskCard";
import type { Event, NoteMeta, Task } from "../types";

const { Text } = Typography;

/** bump watcherTick 触发 events/notes 列表刷新（写入后增量索引已完成，不调全量 index） */
const bumpTick = () => useVaultStore.getState().bumpTick();

/** DnD payload 类型：drag source data.current 的识别标记 */
type DndPayload =
  | { kind: "task"; task: Task }
  | { kind: "event"; event: Event };

/** 时段默认值（任务拖入单元格时，未指定具体时段用 09:00 占位） */
const DEFAULT_SLOT_HOUR = "09:00";

/** droppable 单元格 id 前缀，避免与 draggable task.id/event.id 冲突 */
const CELL_ID_PREFIX = "cal-cell:";

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
  // NewEventModal：日期格 hover + / 右侧栏「新建事件」按钮触发；defaultDate 预填
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventModalDate, setEventModalDate] = useState<Dayjs | undefined>(undefined);

  // M3 任务 13：任务侧栏数据（拉一次未完成任务，作 drag source）
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);

  // M3 任务 14：拖拽 overlay 显示的 payload（活跃 drag source）
  const [activePayload, setActivePayload] = useState<DndPayload | null>(null);

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

  // 任务侧栏：拉一次未完成任务（受 watcherTick 驱动刷新，写事件后任务可能因 raw_bullet 改变而 id 漂移）
  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    setTasksLoading(true);
    api
      .getTasks(vault.id, false, 500)
      .then((res) => {
        if (cancelled) return;
        setTasks(res);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[CalendarPage] 加载任务失败", e);
        setTasks([]);
      })
      .finally(() => {
        if (!cancelled) setTasksLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

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

  const noteById = useMemo(() => {
    const m = new Map<string, NoteMeta>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);

  const todayKey = dayjs().format("YYYY-MM-DD");
  const selectedKey = selected ? selected.format("YYYY-MM-DD") : null;
  const selectedNotes = selectedKey ? byDate.get(selectedKey) ?? [] : [];
  const selectedEvents = selectedKey ? byDateEvents.get(selectedKey) ?? [] : [];

  // 确保该日日志存在（有则复用，无则创建），返回 note_id。
  // 并发去重：同一 rel 的并发请求复用同一 Promise（审查：避免连点/批量时重复 createNote）。
  const ensuringRef = useRef<Map<string, Promise<string>>>(new Map());

  // —— M3 任务 13/14：DnD ——
  // PointerSensor 5px activation 避免误触；ModifierSensor 读 keyboard shift 状态用于「复制」语义
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  if (!vault) return null;

  // 该日日志相对路径（07_决策与复盘/日志/YYYY-MM/YYYY-MM-DD.md）—— 复用 journalTemplates 单一源
  const dayNoteRel = (d: Dayjs) => dayNoteRelPath(d, "daily");

  const ensureDayNote = async (d: Dayjs): Promise<string> => {
    const rel = dayNoteRel(d);
    const existing = byRelPath.get(rel);
    if (existing) return existing.id;
    const cache = ensuringRef.current;
    const inflight = cache.get(rel);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        // 模板复用 utils/journalTemplates.dailyTemplate（消除与 JournalPage 的漂移）
        const tpl = dailyTemplate(d);
        const nc = await api.createNote(vault.id, rel, tpl);
        bumpTick();
        return nc.id;
      } finally {
        cache.delete(rel); // 完成（成功/失败）后清缓存，下次按 byRelPath 复判
      }
    })();
    cache.set(rel, p);
    return p;
  };

  const createDayNote = async () => {
    if (!selected) return;
    try {
      const id = await ensureDayNote(selected);
      setDrawerNoteId(id);
      message.success(`已创建/打开 ${selected.format("YYYY-MM-DD")} 日志`);
    } catch (e) {
      notifyError("创建", e);
    }
  };

  // —— 事件就地 CRUD（编辑/删除保留）+ 新建事件 Modal ——
  // 打开新建事件 Modal（日期格 + 或右侧栏按钮触发）；不传则用当前选中日或今天
  const openEventModal = (date?: Dayjs) => {
    setEventModalDate(date ?? selected ?? dayjs());
    setEventModalOpen(true);
  };
  const closeEventModal = () => setEventModalOpen(false);
  const onEditEvent = async (ev: Event, newText: string) => {
    if (ev.source_line == null) return;
    try {
      await api.updateLine(ev.note_id, ev.source_line, `- ${newText}`);
      bumpTick();
    } catch (e) {
      notifyError("编辑", e);
    }
  };
  const onDeleteEvent = async (ev: Event) => {
    if (ev.source_line == null) return;
    try {
      await api.deleteLine(ev.note_id, ev.source_line);
      message.success("已删除");
      bumpTick();
    } catch (e) {
      notifyError("删除", e);
    }
  };

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DndPayload | undefined;
    if (data) setActivePayload(data);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActivePayload(null);
    const { active, over } = e;
    if (!over) return;
    const data = active.data.current as DndPayload | undefined;
    if (!data) return;
    // 解析目标日期（cell id = "cal-cell:YYYY-MM-DD"）
    const targetId = String(over.id);
    if (!targetId.startsWith(CELL_ID_PREFIX)) return;
    const dateStr = targetId.slice(CELL_ID_PREFIX.length);
    const targetDate = dayjs(dateStr);
    if (!targetDate.isValid()) return;

    // Shift = 复制（事件拖拽用，任务拖拽本来就是新增不删源）
    const isCopy = Boolean(e.activatorEvent && (e.activatorEvent as KeyboardEvent).shiftKey);

    if (data.kind === "task") {
      // —— 任务 → 时间块：写事件到目标日笔记「关键事件」section ——
      const task = data.task;
      if (task.source_line == null) {
        message.warning("聚合 section 任务不支持拖入日历");
        return;
      }
      try {
        const noteId = await ensureDayNote(targetDate);
        // 任务拖入作时间块，默认 09:00 单点（不带 end，避免臆测时长）
        const bullet = buildEventBullet(task.text, DEFAULT_SLOT_HOUR);
        await api.appendBullet(noteId, "关键事件", bullet, false);
        message.success(`已把任务排到 ${dateStr}（${DEFAULT_SLOT_HOUR}）`);
        bumpTick();
      } catch (err) {
        message.error(`排时间块失败：${err}`);
      }
      return;
    }

    if (data.kind === "event") {
      // —— 事件改日期：deleteLine 旧源 + appendBullet 新日 ——
      const ev = data.event;
      if (ev.source_line == null) {
        message.warning("聚合事件不支持拖拽改日期");
        return;
      }
      const sameDay = ev.event_date === dateStr;
      if (sameDay) return; // 同日拖（顺序不变），静默
      try {
        const noteId = await ensureDayNote(targetDate);
        // 复用原 raw_bullet（保留时间/备注），无则用 title 重构
        const raw = ev.raw_bullet ?? buildEventBullet(ev.title ?? "（未命名）", ev.event_time ?? DEFAULT_SLOT_HOUR);
        await api.appendBullet(noteId, "关键事件", raw, false);
        // 非复制 → 删旧源（复制则保留原事件）
        if (!isCopy) {
          await api.deleteLine(ev.note_id, ev.source_line);
        }
        message.success(isCopy ? `已复制到 ${dateStr}` : `已移到 ${dateStr}`);
        bumpTick();
      } catch (err) {
        // 失败：UI 不 optimistic patch，watcherTick 未 bump，下次 effect 重拉保持原状（自然回滚）
        message.error(`改日期失败：${err}`);
      }
      return;
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* 左侧：任务侧栏（drag source）—— 把未完成任务暴露成可拖单元，拖到日历单元格作时间块 */}
        <div
          style={{
            width: 260,
            flexShrink: 0,
            background: "var(--ob-bg-mod)",
            borderRadius: 8,
            padding: 10,
            maxHeight: "80vh",
            overflowY: "auto",
          }}
        >
          <Text strong style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
            <AppIcon name="task" size={13} /> 任务（拖到日历排时间块）
          </Text>
          <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 8 }}>
            拖任务到日期格 → 自动写「关键事件」时间块
          </Text>
          {tasksLoading ? (
            <div style={{ textAlign: "center", padding: 16 }}><Spin size="small" /></div>
          ) : tasks.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无未完成任务" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {tasks.slice(0, 100).map((t) => (
                <DraggableTaskItem key={t.id} task={t} sourceNote={noteById.get(t.note_id)} />
              ))}
              {tasks.length > 100 && (
                <Text type="secondary" style={{ fontSize: 11, textAlign: "center", marginTop: 4 }}>
                  仅显示前 100 条（共 {tasks.length}）
                </Text>
              )}
            </div>
          )}
        </div>

        {/* 中间：日历 */}
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
              {byDateEvents.size} 个日期有事件 · {byDate.size} 个日期有笔记 · 拖事件改日期（Shift=复制）
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
                const isToday = key === todayKey;
                // 折叠策略：单元格内最多列 2 条事件标题（截断），超出 +N（Popover 列全部）
                const visibleEvents = dayEvents.slice(0, 2);
                const moreCount = Math.max(0, dayEvents.length - 2);
                const eventTitle = (ev: Event) => ev.title ?? ev.raw_bullet ?? "（未命名）";
                return (
                  <DroppableCell dateKey={key} isToday={isToday}>
                    {/* hover 出现的 + 按钮（新建事件，预填该日期） */}
                    <button
                      className="cal-add-btn"
                      title={`在 ${key} 新建事件`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEventModal(date);
                      }}
                    >
                      +
                    </button>
                    {dayNotes.length > 0 && (
                      <Badge count={dayNotes.length} style={{ backgroundColor: "var(--ob-accent)" }} />
                    )}
                    {dayEvents.length > 0 && (
                      <div className="cal-event-list">
                        {visibleEvents.map((ev, i) => (
                          <DraggableEventItem key={`${ev.id}-${i}`} ev={ev} title={eventTitle(ev)} />
                        ))}
                        {moreCount > 0 && (
                          <Popover
                            trigger="hover"
                            placement="rightTop"
                            title={`${key} 共 ${dayEvents.length} 条事件`}
                            content={
                              <div style={{ maxWidth: 280 }}>
                                {dayEvents.map((ev, i) => (
                                  <div key={i} style={{ fontSize: 12, marginBottom: 2 }}>
                                    <Tag color="green" style={{ margin: 0, marginRight: 6, flexShrink: 0 }}>
                                      {ev.event_time ?? "—"}
                                    </Tag>
                                    {eventTitle(ev)}
                                  </div>
                                ))}
                              </div>
                            }
                          >
                            <div className="cal-more">+{moreCount} 更多</div>
                          </Popover>
                        )}
                      </div>
                    )}
                  </DroppableCell>
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

        {/* 右侧：选中日详情 */}
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
            <Button
              block
              size="small"
              type="primary"
              ghost
              icon={<PlusOutlined />}
              onClick={() => openEventModal(selected)}
              style={{ marginBottom: 8 }}
            >
              新建事件
            </Button>
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
      </div>

      {/* Drag overlay：跟随鼠标显示活跃拖拽源 */}
      <DragOverlay>
        {activePayload?.kind === "task" ? (
          <TaskCard
            task={activePayload.task}
            sourceNote={noteById.get(activePayload.task.note_id)}
            containerId="overlay"
            compact
          />
        ) : activePayload?.kind === "event" ? (
          <div className="cal-event-item" style={{ opacity: 0.85, cursor: "grabbing" }}>
            {activePayload.event.event_time ? `${activePayload.event.event_time} ` : ""}
            {activePayload.event.title ?? activePayload.event.raw_bullet ?? "（未命名）"}
          </div>
        ) : null}
      </DragOverlay>

      <NewEventModal
        open={eventModalOpen}
        defaultDate={eventModalDate}
        ensureNote={ensureDayNote}
        onCancel={closeEventModal}
        onSuccess={() => {
          // 关闭弹窗 + bumpTick 刷新事件/笔记列表（watcherTick 驱动 events useEffect 重拉）
          closeEventModal();
          bumpTick();
        }}
      />
      <NoteEditorDrawer
        open={!!drawerNoteId}
        noteId={drawerNoteId}
        onClose={() => setDrawerNoteId(null)}
      />
    </DndContext>
  );
}

// ============================================================
// DnD 子组件：单元格 Droppable + 任务/事件 Draggable
// ============================================================

/** 日历单元格（Droppable）—— 包装 antd Calendar cellRender 内容，附加 drop 目标语义 */
function DroppableCell({
  dateKey,
  isToday,
  children,
}: {
  dateKey: string;
  isToday: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${CELL_ID_PREFIX}${dateKey}` });
  return (
    <div
      ref={setNodeRef}
      className={`cal-cell${isToday ? " cal-cell-today" : ""}${isOver ? " cal-cell-over" : ""}`}
    >
      {children}
    </div>
  );
}

/** 任务侧栏单条（Draggable）—— 复用 TaskCard 渲染 + useDraggable 暴露 task payload */
function DraggableTaskItem({ task, sourceNote }: { task: Task; sourceNote?: NoteMeta }) {
  // TaskCard 内部已用 useDraggable（id=task.id），这里只做包装定位
  // 直接渲染 TaskCard 即可让其内部 useDraggable 注册到上层 DndContext
  return (
    <TaskCard
      task={task}
      sourceNote={sourceNote}
      containerId="cal-task-sidebar"
      compact
    />
  );
}

/** 事件卡片（Draggable）—— 单元格内事件条目包装为可拖单元 */
function DraggableEventItem({ ev, title }: { ev: Event; title: string }) {
  // source_line==null 的聚合事件禁拖（与编辑/删除边界一致）
  const canDrag = ev.source_line != null;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cal-event:${ev.id}`,
    data: { kind: "event", event: ev } satisfies DndPayload,
    disabled: !canDrag,
  });
  return (
    <div
      ref={setNodeRef}
      className={`cal-event-item${isDragging ? " dragging" : ""}`}
      title={canDrag ? title : `${title}（聚合事件不可拖）`}
      style={{ cursor: canDrag ? "grab" : "default" }}
      {...attributes}
      {...listeners}
    >
      {ev.event_time ? `${ev.event_time} ` : ""}
      {title}
    </div>
  );
}
