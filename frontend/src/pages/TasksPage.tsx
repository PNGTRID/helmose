// 任务页：未完成/已完成 Tab + 按到期日期分组 + 点击查看源笔记（Drawer 预览）
// 后端 get_tasks 已就绪（按 done 筛选），本页做分组展示与源笔记钻取。

import { useEffect, useMemo, useState } from "react";
import { Card, Checkbox, Drawer, List, message, Space, Spin, Tabs, Tag, Typography } from "antd";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useWikilinkNavigation } from "../hooks/useWikilinkNavigation";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import DataState from "../components/DataState";
import type { NoteContent, NoteMeta, Task } from "../types";

const { Text, Title } = Typography;

interface Group {
  label: string;
  items: Task[];
}

const DAY_MS = 86400000;

/** 未完成任务按到期日期分组：逾期 / 今天 / 本周 / 之后 / 无日期 */
function dueGroups(tasks: Task[]): Group[] {
  const t = new Date();
  const startToday = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const weekEnd = startToday + 7 * DAY_MS;
  const overdue: Task[] = [];
  const today: Task[] = [];
  const week: Task[] = [];
  const later: Task[] = [];
  const none: Task[] = [];
  for (const task of tasks) {
    if (!task.due_date) {
      none.push(task);
      continue;
    }
    // replace('-','/') 兼容 Safari 解析 "YYYY-MM-DD"
    const ts = new Date(task.due_date.replace(/-/g, "/")).getTime();
    if (isNaN(ts)) {
      none.push(task);
      continue;
    }
    if (ts < startToday) overdue.push(task);
    else if (ts < startToday + DAY_MS) today.push(task);
    else if (ts < weekEnd) week.push(task);
    else later.push(task);
  }
  const out: Group[] = [];
  if (overdue.length) out.push({ label: `逾期（${overdue.length}）`, items: overdue });
  if (today.length) out.push({ label: `今天（${today.length}）`, items: today });
  if (week.length) out.push({ label: `本周内（${week.length}）`, items: week });
  if (later.length) out.push({ label: `之后（${later.length}）`, items: later });
  if (none.length) out.push({ label: `无到期日（${none.length}）`, items: none });
  return out;
}

/** 已完成任务按 completed_at 日期分组（倒序） */
function completedGroups(tasks: Task[]): Group[] {
  const byDate = new Map<string, Task[]>();
  for (const t of tasks) {
    const d = (t.completed_at ?? "未知").slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(t);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([label, items]) => ({ label, items }));
}

export default function TasksPage() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const { notes } = useAllNotesMeta();
  const [tab, setTab] = useState<"open" | "done">("open");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  // note_id → NoteMeta（任务显示来源笔记名用）
  const noteById = useMemo(() => {
    const m = new Map<string, NoteMeta>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);

  // Drawer：源笔记预览
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState<NoteContent | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);

  // Drawer 内 wikilink 跳转：点击 → 全库搜 target → 替换 Drawer 内容（与重构前一致）
  const { handleClick: onDrawerClick } = useWikilinkNavigation({
    onNavigate: async (hit) => {
      const c = await api.getNoteContent(hit.id);
      setNoteContent(c);
    },
  });

  const refresh = async () => {
    if (!vault) return;
    setLoading(true);
    try {
      const done = tab === "done";
      setTasks(await api.getTasks(vault.id, done, done ? 200 : 500));
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  // 勾选任务 → 写回 vault checkbox（仅 source_line!=null 的 checkbox 类任务可勾）+ 重新拉取
  const [toggling, setToggling] = useState(false);
  const onToggle = async (t: Task, done: boolean) => {
    if (t.source_line == null || toggling) return;
    setToggling(true);
    try {
      await api.toggleTask(t.note_id, t.source_line, done);
      message.success(done ? "已完成" : "已取消完成");
      await refresh();
    } catch (e) {
      message.error(`勾选失败：${e}`);
    } finally {
      setToggling(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, tab, watcherTick]);

  // 打开任务 → 加载其源笔记
  useEffect(() => {
    if (!openTaskId) {
      setNoteContent(null);
      return;
    }
    const task = tasks.find((t) => t.id === openTaskId);
    if (!task) return;
    setLoadingNote(true);
    api
      .getNoteContent(task.note_id)
      .then(setNoteContent)
      .catch(() => setNoteContent(null))
      .finally(() => setLoadingNote(false));
  }, [openTaskId, tasks]);

  const groups = useMemo(
    () => (tab === "open" ? dueGroups(tasks) : completedGroups(tasks)),
    [tasks, tab]
  );

  if (!vault) return null;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as "open" | "done")}
          items={[
            { key: "open", label: "未完成" },
            { key: "done", label: "已完成" },
          ]}
        />
        <DataState
          loading={loading}
          empty={groups.length === 0}
          emptyText={tab === "open" ? "暂无未完成任务" : "暂无已完成任务"}
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {groups.map((g) => (
              <div key={g.label}>
                <Text
                  strong
                  style={{
                    display: "block",
                    margin: "8px 0",
                    color: g.label.startsWith("逾期")
                      ? "#ef4444"
                      : g.label.startsWith("今天")
                        ? "#10b981"
                        : g.label.startsWith("本周")
                          ? "#3b82f6"
                          : undefined,
                  }}
                >
                  {g.label}
                </Text>
                <List
                  bordered
                  dataSource={g.items}
                  renderItem={(t) => (
                    <List.Item
                      style={{ cursor: "pointer" }}
                      onClick={() => setOpenTaskId(t.id)}
                    >
                      <List.Item.Meta
                        title={
                          <Space>
                            {t.source_line != null && (
                              <Checkbox
                                checked={t.done}
                                disabled={toggling}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => onToggle(t, e.target.checked)}
                              />
                            )}
                            <span>{t.done ? "✓ " : ""}{t.text}</span>
                          </Space>
                        }
                        description={
                          <Space size={4} wrap>
                            <Tag color="blue">{t.source}</Tag>
                            {t.due_date && <Tag color="orange">{t.due_date}</Tag>}
                            {t.source_line && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                L{t.source_line}
                              </Text>
                            )}
                            {noteById.get(t.note_id) && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {noteById.get(t.note_id)?.file_name}
                              </Text>
                            )}
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              点击查看源笔记
                            </Text>
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              </div>
            ))}
          </Space>
        </DataState>
      </Card>

      <Drawer
        title="源笔记"
        width={720}
        open={!!openTaskId}
        onClose={() => setOpenTaskId(null)}
        styles={{ body: { padding: 24 } }}
      >
        {loadingNote || !noteContent ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin />
          </div>
        ) : (
          <div onClick={onDrawerClick}>
            <Title level={4} style={{ marginBottom: 4 }}>
              {noteContent.title ?? "（无标题）"}
            </Title>
            <Text type="secondary" code style={{ fontSize: 12 }}>
              {noteContent.rel_path}
            </Text>
            <div
              className="md-preview"
              dangerouslySetInnerHTML={{ __html: noteContent.html }}
            />
          </div>
        )}
      </Drawer>
    </Space>
  );
}
