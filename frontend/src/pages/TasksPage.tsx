// 任务页：多视图（列表/看板/四象限）+ 拖拽写回 + urgency 派生。
// 顶部 Segmented 切视图（taskView store 持久化），InlineAdd 换 TaskForm（参数表单）。
// urgency 派生：useMemo 按 due_date 推导（无手动 🔥 时：逾期/今天=high，本周=mid，之后/无=low）。
// 数据一次 get_tasks 拉取，内存切视图（不重复 IPC）；Drawer 预览源笔记保留。
// 拖拽写回：setTaskStatus/setTaskPriority/setTaskUrgency，await 成功后 refresh 回流（非乐观，失败前端不变）。

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Card, Drawer, Segmented, Space, Spin, Tabs, Typography, message } from "antd";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useTaskViewStore, type TaskView, type TaskGroupBy } from "../stores/taskView";
import { useWikilinkNavigation } from "../hooks/useWikilinkNavigation";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import DataState from "../components/DataState";
import TaskForm from "../components/TaskForm";
import ListView from "../components/tasks/ListView";
import KanbanView from "../components/tasks/KanbanView";
import MatrixView from "../components/tasks/MatrixView";
import type { NoteContent, NoteMeta, Task } from "../types";
import { computeUrgencyMap } from "../utils/taskGrouping";

const { Text, Title } = Typography;

const VIEW_OPTIONS = [
  { label: "📋 列表", value: "list" as const },
  { label: "🗂 看板", value: "kanban" as const },
  { label: "🎯 四象限", value: "matrix" as const },
];

export default function TasksPage() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const { notes } = useAllNotesMeta();
  const view = useTaskViewStore((s) => s.view);
  const groupBy = useTaskViewStore((s) => s.groupBy);
  const setView = useTaskViewStore((s) => s.setView);
  const setGroupBy = useTaskViewStore((s) => s.setGroupBy);

  const [tab, setTab] = useState<"open" | "done">("open");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  // refresh 请求序号守卫：避免 onToggle/onTaskWritten 的 await refresh 与 effect 的 refresh 竞态脏写
  const refreshSeq = useRef(0);
  // 截断提示阈值（与 get_tasks limit 一致）
  const TASK_LIMIT_OPEN = 500;
  const TASK_LIMIT_DONE = 200;

  // note_id → NoteMeta（卡片显示来源 file_name）
  const noteById = useMemo(() => {
    const m = new Map<string, NoteMeta>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);

  // Drawer 源笔记预览
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState<NoteContent | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);

  const { handleClick: onDrawerClick } = useWikilinkNavigation({
    onNavigate: async (hit) => {
      const c = await api.getNoteContent(hit.id);
      setNoteContent(c);
    },
  });

  const refresh = async () => {
    if (!vault) return;
    const mySeq = ++refreshSeq.current;
    setLoading(true);
    try {
      const done = tab === "done";
      const data = await api.getTasks(vault.id, done, done ? TASK_LIMIT_DONE : TASK_LIMIT_OPEN);
      if (refreshSeq.current !== mySeq) return; // 已被更新请求覆盖，丢弃
      setTasks(data);
    } catch {
      if (refreshSeq.current !== mySeq) return;
      setTasks([]);
    } finally {
      if (refreshSeq.current === mySeq) setLoading(false);
    }
  };

  // 勾选完成 → toggleTask 写回（看板/列表/象限共享）
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

  // urgency 派生（复用 utils/taskGrouping.computeUrgencyMap，单一源 + 可单测）
  const urgencyMap = useMemo(() => computeUrgencyMap(tasks), [tasks]);

  // 拖拽写回成功后回调：触发 refresh 重新拉取最新 tasks（content_hash 变 → note id 变，
  // 旧 id 失效；refresh 比 local patch 可靠，拖拽低频多一次 IPC 可接受）。
  // 看板/象限共用：KanbanView 多传的 newStatus 参数在此忽略（未使用）。
  const onTaskWritten = async (_t: Task, _nc: NoteContent) => {
    await refresh();
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

  if (!vault) return null;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card>
        {/* 顶部：视图切换 Segmented（左） + 完成 Tab（右） */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <Segmented
            options={VIEW_OPTIONS}
            value={view}
            onChange={(v) => setView(v as TaskView)}
            size="small"
          />
          <Tabs
            activeKey={tab}
            onChange={(k) => setTab(k as "open" | "done")}
            size="small"
            items={[
              { key: "open", label: "未完成" },
              { key: "done", label: "已完成" },
            ]}
            style={{ marginBottom: 0 }}
          />
        </div>

        {/* 行内新建任务（替换 InlineAdd） */}
        {tab === "open" && <TaskForm onSubmitted={refresh} />}

        {/* 截断提示：达到 limit 阈值时静默截断，提醒用户可能还有更多（重要任务已按 due_date/priority 排序靠前） */}
        {tasks.length === (tab === "done" ? TASK_LIMIT_DONE : TASK_LIMIT_OPEN) && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={`仅显示前 ${tasks.length} 条任务（按截止/优先级排序，可能还有更多）`}
          />
        )}

        <DataState
          loading={loading}
          empty={tasks.length === 0}
          emptyText={tab === "open" ? "暂无未完成任务" : "暂无已完成任务"}
        >
          {/* 视图分发：一次数据拉取，内存切视图（不重复 IPC） */}
          {view === "list" && (
            <ListView
              tasks={tasks}
              urgencyMap={urgencyMap}
              groupBy={groupBy}
              onGroupByChange={(g: TaskGroupBy) => setGroupBy(g)}
              noteById={noteById}
              onOpen={(t) => setOpenTaskId(t.id)}
              onToggle={onToggle}
            />
          )}
          {view === "kanban" && (
            <KanbanView
              tasks={tasks}
              urgencyMap={urgencyMap}
              noteById={noteById}
              onOpen={(t) => setOpenTaskId(t.id)}
              onToggle={onToggle}
              onTaskWritten={onTaskWritten}
            />
          )}
          {view === "matrix" && (
            <MatrixView
              tasks={tasks}
              urgencyMap={urgencyMap}
              noteById={noteById}
              onOpen={(t) => setOpenTaskId(t.id)}
              onToggle={onToggle}
              onTaskWritten={onTaskWritten}
            />
          )}
        </DataState>
      </Card>

      {/* 源笔记预览抽屉（点卡片打开） */}
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
