// 日志页：列出 note_type 为 experience / log 的笔记，按月分组（Collapse，默认展开最新月）。
// 点击笔记 → NoteEditorDrawer（抽屉编辑，不跳 tab）。
// 新建：Dropdown 选模板（daily/weekly/monthly/review）→ Modal（日期 + 心情/精力[daily] + 复盘类型[review]）→
//   用 utils/journalTemplates.ts 拼 frontmatter+正文 → createNote（零新命令）。
// 顶部筛选器：Segmented（全部/日报/经历）+ RangePicker（默认最近 3 月）+ 标签 Select，纯前端 useMemo。
// 数据源 useAllNotesMeta（全量内存，无 IPC 增量），watcherTick 驱动刷新。

import { useEffect, useMemo, useState } from "react";
import {
  Collapse,
  DatePicker,
  Dropdown,
  InputNumber,
  List,
  Modal,
  Segmented,
  Select,
  Tag,
  Typography,
  message,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import DataState from "../components/DataState";
import NoteEditorDrawer from "../components/NoteEditorDrawer";
import type { JournalTemplate } from "../utils/journalTemplates";
import { dayNoteRelPath, renderJournalTemplate } from "../utils/journalTemplates";
import type { NoteMeta, TagCount } from "../types";

const { Text } = Typography;

const { RangePicker } = DatePicker;

const TYPE_LABEL: Record<string, string> = {
  log: "日志",
  experience: "经历",
};
const TYPE_COLOR: Record<string, string> = {
  log: "blue",
  experience: "purple",
};

/** 顶部 Segmented 过滤选项 */
type TypeFilter = "all" | "log" | "experience";

/** 模板下拉菜单选项（key = 模板名，label = 中文显示） */
const TEMPLATE_ITEMS: { key: JournalTemplate; label: string; noteType: string }[] = [
  { key: "daily", label: "日报（今日待办 / 关键事件 / 复盘）", noteType: "log" },
  { key: "weekly", label: "周报（本周目标 / 完成情况 / 下周计划）", noteType: "log" },
  { key: "monthly", label: "月报（月度回顾 / 关键成就 / 反思）", noteType: "experience" },
  { key: "review", label: "复盘（背景 / 做了什么 / 学到什么）", noteType: "experience" },
];

export default function JournalPage() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const { notes, loading, error } = useAllNotesMeta();
  const [drawerNoteId, setDrawerNoteId] = useState<string | null>(null);

  // —— 顶部筛选 state ——
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  // 默认最近 3 月（含今天）
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(2, "month").startOf("month"),
    dayjs().endOf("month"),
  ]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // 标签计数（仅拉一次，watcherTick 变化时重拉以同步新写入）
  const [tagsStats, setTagsStats] = useState<TagCount[]>([]);
  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    api
      .getTagsStats(vault.id)
      .then((res) => {
        if (!cancelled) setTagsStats(res);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[JournalPage] 加载标签失败", e);
        setTagsStats([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  // —— 新建 Modal state ——
  const [modalOpen, setModalOpen] = useState(false);
  const [tplKey, setTplKey] = useState<JournalTemplate>("daily");
  const [tplDate, setTplDate] = useState<Dayjs>(dayjs());
  // 仅 daily 显示心情/精力
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  // 仅 review 显示复盘类型
  const [reviewType, setReviewType] = useState<string>("项目");
  const [saving, setSaving] = useState(false);

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

  // 应用 3 重筛选（type / 时间范围 / 标签），纯前端 useMemo
  const filtered = useMemo(() => {
    const [from, to] = range;
    const fromStr = from.format("YYYY-MM-DD");
    const toStr = to.format("YYYY-MM-DD");
    return journal.filter((n) => {
      // type
      if (typeFilter !== "all" && n.note_type !== typeFilter) return false;
      // 时间范围（无 date_iso 视为不在区间，避免误展示）
      if (n.date_iso) {
        if (n.date_iso < fromStr || n.date_iso > toStr) return false;
      } else {
        return false;
      }
      // 标签精确匹配（tags 数组含该 tag）
      if (tagFilter && !n.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [journal, typeFilter, range, tagFilter]);

  // 按月分组（YYYY-MM，无日期归"未知"），月份倒序
  const groups = useMemo(() => {
    const m = new Map<string, NoteMeta[]>();
    for (const n of filtered) {
      const month = n.date_iso?.slice(0, 7) ?? "未知";
      if (!m.has(month)) m.set(month, []);
      m.get(month)!.push(n);
    }
    return [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      .map(([month, items]) => ({ month, items }));
  }, [filtered]);

  if (!vault) return null;

  const logCount = journal.filter((n) => n.note_type === "log").length;
  const expCount = journal.length - logCount;

  // 打开新建 Modal（Dropdown 菜单点击触发）
  const openModal = (key: string) => {
    const t = key as JournalTemplate;
    setTplKey(t);
    setTplDate(dayjs());
    setMood(null);
    setEnergy(null);
    setReviewType("项目");
    setModalOpen(true);
  };

  // 提交：renderJournalTemplate 拼 frontmatter+正文 → 写回 mood/energy（仅 daily）→ createNote
  const onModalOk = async () => {
    setSaving(true);
    try {
      const rel = dayNoteRelPath(tplDate, tplKey);
      const content = renderJournalTemplate(tplKey, tplDate, { reviewType });
      // daily 模板在 fm 内已含 mood/energy 空键，createNote 后用 patchFrontmatter 写值（非空才写）
      const nc = await api.createNote(vault.id, rel, content);
      // daily：mood/energy 写回 fm（仅当用户填了）
      if (tplKey === "daily") {
        if (mood != null) await api.patchFrontmatter(nc.id, "mood", mood);
        if (energy != null) await api.patchFrontmatter(nc.id, "energy", energy);
      }
      message.success(`已创建 ${tplDate.format("YYYY-MM-DD")} 日志`);
      setModalOpen(false);
      // bump watcherTick 刷新列表（增量索引已完成）
      useVaultStore.getState().bumpTick();
      setDrawerNoteId(nc.id);
    } catch (e) {
      message.error(`新建失败（可能已存在）：${e}`);
    } finally {
      setSaving(false);
    }
  };

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
              onClick={() => setDrawerNoteId(n.id)}
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
                    <Text type="secondary" style={{ fontSize: 12 }}>{n.rel_path}</Text>
                  </span>
                }
              />
            </List.Item>
          );
        }}
      />
    ),
  }));

  const isDaily = tplKey === "daily";
  const isReview = tplKey === "review";

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Text strong style={{ fontSize: 16 }}>日志</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {journal.length} 篇 · 日志 {logCount} / 经历 {expCount} · 当前筛选 {filtered.length} 篇
        </Text>
        <div style={{ marginLeft: "auto" }}>
          <Dropdown.Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openModal("daily")}
            menu={{
              items: TEMPLATE_ITEMS.map((it) => ({ key: it.key, label: it.label })),
              onClick: ({ key }) => openModal(key),
            }}
          >
            新建日志
          </Dropdown.Button>
        </div>
      </div>

      {/* 筛选器：type Segmented + RangePicker + 标签 Select */}
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Segmented<TypeFilter>
          value={typeFilter}
          onChange={(v) => setTypeFilter(v)}
          options={[
            { value: "all", label: "全部" },
            { value: "log", label: "日报" },
            { value: "experience", label: "经历" },
          ]}
        />
        <RangePicker
          value={range}
          onChange={(v) => {
            if (v && v[0] && v[1]) setRange([v[0], v[1]]);
          }}
          allowClear={false}
        />
        <Select<string>
          allowClear
          showSearch
          optionFilterProp="children"
          placeholder="按标签筛选"
          value={tagFilter ?? undefined}
          onChange={(v) => setTagFilter(v ?? null)}
          style={{ minWidth: 160 }}
          options={tagsStats.map(([t, c]) => ({ value: t, label: `${t} (${c})` }))}
        />
      </div>

      <DataState
        loading={loading}
        error={error}
        errorTitle="笔记加载失败"
        empty={filtered.length === 0}
        emptyText={
          journal.length === 0
            ? "暂无日志/经历笔记（note_type 需为 experience 或 log，并已索引）"
            : "当前筛选条件下无匹配笔记，可调整筛选或扩大时间范围"
        }
      >
        <Collapse
          items={collapseItems}
          defaultActiveKey={groups[0] ? [groups[0].month] : []}
          destroyInactivePanel
        />
      </DataState>

      {/* 新建 Modal：日期 + 心情/精力（仅 daily）+ 复盘类型（仅 review） */}
      <Modal
        title={`新建${TEMPLATE_ITEMS.find((t) => t.key === tplKey)?.label.split("（")[0] ?? "日志"}`}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onModalOk}
        okText="创建"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
        width={460}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--ob-text-muted)" }}>日期</span>
            <DatePicker
              value={tplDate}
              onChange={(d) => d && setTplDate(d)}
              allowClear={false}
              style={{ width: 160 }}
            />
          </div>
          {isDaily && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--ob-text-muted)" }}>心情（1-5，可空）</span>
                <InputNumber
                  min={1}
                  max={5}
                  value={mood ?? undefined}
                  onChange={(v) => setMood(v ?? null)}
                  placeholder="—"
                  style={{ width: 80 }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--ob-text-muted)" }}>精力（1-10，可空）</span>
                <InputNumber
                  min={1}
                  max={10}
                  value={energy ?? undefined}
                  onChange={(v) => setEnergy(v ?? null)}
                  placeholder="—"
                  style={{ width: 80 }}
                />
              </div>
            </>
          )}
          {isReview && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--ob-text-muted)" }}>复盘类型</span>
              <Select
                value={reviewType}
                onChange={setReviewType}
                style={{ width: 160 }}
                options={[
                  { value: "项目", label: "项目" },
                  { value: "事件", label: "事件" },
                  { value: "季度", label: "季度" },
                  { value: "学习", label: "学习" },
                ]}
              />
            </div>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            模板将创建于：{dayNoteRelPath(tplDate, tplKey)}
          </Text>
        </div>
      </Modal>

      <NoteEditorDrawer
        open={!!drawerNoteId}
        noteId={drawerNoteId}
        onClose={() => setDrawerNoteId(null)}
      />
    </div>
  );
}
