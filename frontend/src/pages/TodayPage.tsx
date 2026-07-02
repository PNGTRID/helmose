// 今日聚焦（教练面板）：聚合「今日待办 / 今日事件 / 主线项目 / 索引统计」四张卡片。
// 数据源：tasks(undone) + events(today) + projects(is_mainline) + stats(已有)。
// 就地 CRUD：今日事件 InlineAdd 新建 + 行内 InlineEdit/删除；今日待办勾选 + InlineEdit/删除。
// 今日笔记按钮 / 主线项目点击 → NoteEditorDrawer（不跳 tab）。竞态：useEffect cancelled flag。

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  List,
  message,
  Popconfirm,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import {
  CalendarOutlined,
  CheckSquareOutlined,
  CompassOutlined,
  DeleteOutlined,
  FileAddOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useTabsStore } from "../stores/tabs";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { dateKey } from "../utils/date";
import InlineEdit from "../components/InlineEdit";
import NoteEditorDrawer from "../components/NoteEditorDrawer";
import QuickAddTaskModal from "../components/QuickAddTaskModal";
import QuickAddEventModal from "../components/QuickAddEventModal";
import QuickAddProjectModal from "../components/QuickAddProjectModal";
import AiCoachCard from "../components/ai/AiCoachCard";
import type { AiSettings, Event, Project, Task } from "../types";

const { Text } = Typography;

/** 今日聚焦（教练面板）—— v0.1 聚合四源信号；主线判定/教练建议 v0.2 接 AI */
export default function TodayPage() {
  const { vault, indexing, stats, index } = useVaultStore();
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const { notes } = useAllNotesMeta();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [yesterdaySentence, setYesterdaySentence] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [drawerNoteId, setDrawerNoteId] = useState<string | null>(null);
  // refresh 请求序号守卫：4 路 IPC 并发 + watcherTick 抖动时丢弃过期响应，避免脏写
  const refreshSeq = useRef(0);
  // M2：三快速创建弹窗开关（待办/事件/项目）
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  // M4：AI 设置（决定显降级态卡还是 AiCoachCard 三卡）
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);

  const today = dayjs().format("YYYY-MM-DD");

  const refresh = async () => {
    if (!vault) return;
    const mySeq = ++refreshSeq.current;
    setLoading(true);
    try {
      const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
      const [t, e, p, ys] = await Promise.all([
        api.getTasks(vault.id, false, 200),
        api.listEvents(vault.id, today, today),
        api.getProjects(vault.id, undefined, true),
        api.getTomorrowSentence(vault.id, yesterday),
      ]);
      // 批量 set 前一次检查：已被更新请求覆盖则丢弃整批结果
      if (refreshSeq.current !== mySeq) return;
      setTasks(t);
      setEvents(e);
      setProjects(p);
      setYesterdaySentence(ys);
    } catch {
      if (refreshSeq.current !== mySeq) return;
      setTasks([]);
      setEvents([]);
      setProjects([]);
      setYesterdaySentence(null);
    } finally {
      if (refreshSeq.current === mySeq) setLoading(false);
    }
  };

  // refresh 触发条件：vault 切换 / 文件监听 tick。
  // 注意：stats 不放入 deps —— stats 是 store 中的派生缓存（index() 完成后写入），
  // 与本页 4 路 IPC 互相独立；放 deps 会因 stats 变化触发不必要的 4 路重拉。
  useEffect(() => {
    if (!vault) return;
    void refresh();
    // AI 设置不随 watcherTick 抖动重拉（用户在 SettingsPage 改才会变）
    api.getAiSettings().then(setAiSettings).catch(() => setAiSettings(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  if (!vault) return null;

  // 今日笔记 id 集（用于筛「今日待办」）
  const todayNoteIds = new Set(
    notes.filter((n) => dateKey(n.date_iso) === today).map((n) => n.id)
  );
  // 今日待办：due_date==今天，或来自今日笔记的未完成 task（两路并集）
  const todayTasks = tasks.filter(
    (t) => t.due_date === today || todayNoteIds.has(t.note_id)
  );
  // 逾期未完成（due_date < 今天）：醒目提醒，跳任务页处理
  const overdueTasks = tasks.filter((t) => t.due_date && t.due_date < today);

  const goTo = (type: "tasks" | "calendar" | "projects", title: string) =>
    useTabsStore.getState().openView(type, title);

  // 打开或创建今日笔记（抽屉编辑，不跳 tab）
  const openOrCreateToday = async () => {
    try {
      const nc = await api.createTodayNote(vault.id);
      setDrawerNoteId(nc.id);
    } catch (e) {
      message.error(`操作失败：${e}`);
    }
  };

  // —— 事件就地编辑/删除（新建走 QuickAddEventModal，此处仅留行内编辑/删除）——
  const onEditEvent = async (ev: Event, newText: string) => {
    if (ev.source_line == null) return;
    try {
      await api.updateLine(ev.note_id, ev.source_line, `- ${newText}`);
      await refresh();
    } catch (e) {
      message.error(`编辑失败：${e}`);
    }
  };
  const onDeleteEvent = async (ev: Event) => {
    if (ev.source_line == null) return;
    try {
      await api.deleteLine(ev.note_id, ev.source_line);
      message.success("已删除");
      await refresh();
    } catch (e) {
      message.error(`删除失败：${e}`);
    }
  };

  // —— 今日待办就地编辑/删除/勾选 ——
  const onToggleTask = async (t: Task, done: boolean) => {
    if (t.source_line == null) return;
    try {
      await api.toggleTask(t.note_id, t.source_line, done);
      await refresh();
    } catch (e) {
      message.error(`勾选失败：${e}`);
    }
  };
  const onEditTask = async (t: Task, newText: string) => {
    if (t.source_line == null) return;
    const prefix = t.done ? "- [x] " : "- [ ] ";
    try {
      await api.updateLine(t.note_id, t.source_line, prefix + newText);
      await refresh();
    } catch (e) {
      message.error(`编辑失败：${e}`);
    }
  };
  const onDeleteTask = async (t: Task) => {
    if (t.source_line == null) return;
    try {
      await api.deleteLine(t.note_id, t.source_line);
      message.success("已删除");
      await refresh();
    } catch (e) {
      message.error(`删除失败：${e}`);
    }
  };

  const hasFocus =
    todayTasks.length > 0 || events.length > 0 || projects.length > 0;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row gutter={16}>
        <Col span={6}>
          <Statistic title="已索引笔记" value={stats?.notes ?? "—"} />
        </Col>
        <Col span={6}>
          <Statistic title="任务总数" value={stats?.tasks ?? "—"} />
        </Col>
        <Col span={6}>
          <Statistic title="wikilink" value={stats?.wikilinks ?? "—"} />
        </Col>
        <Col span={6}>
          <Statistic title="索引耗时" value={stats?.elapsed_ms ?? "—"} suffix="ms" />
        </Col>
      </Row>
      <Space>
        <Button type="primary" icon={<FileAddOutlined />} onClick={openOrCreateToday}>
          今日笔记
        </Button>
        <Button icon={<ReloadOutlined />} loading={indexing} onClick={() => index().then(refresh)}>
          重新索引
        </Button>
      </Space>

      {overdueTasks.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ cursor: "pointer" }}
          message={`有 ${overdueTasks.length} 个逾期任务`}
          description={
            <span>
              {overdueTasks.slice(0, 3).map((t) => t.text).join(" · ")}
              {overdueTasks.length > 3 ? " …" : ""}
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                点击查看全部
              </Typography.Text>
            </span>
          }
          onClick={() => goTo("tasks", "任务")}
        />
      )}

      {yesterdaySentence && (
        <Card>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ⚓ 昨日定下的今日寄语
          </Typography.Text>
          <div style={{ fontSize: 18, marginTop: 4 }}>{yesterdaySentence}</div>
        </Card>
      )}

      {/* M4：AI 教练面板。
          · 未启用 / 未配 key → 显降级态卡（引导去设置）
          · 已启用且配 key → 显三卡（heuristic 结果也显，标「本地推断」） */}
      {aiSettings && aiSettings.enabled && aiSettings.api_key ? (
        <Row>
          <Col span={24}>
            <Card title={<Space><SettingOutlined /><span>AI 教练</span></Space>} loading={loading}>
              <AiCoachCard vaultId={vault.id} />
            </Card>
          </Col>
        </Row>
      ) : (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                未配置 AI —— 仅显示本地启发式信号。
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  配置 Claude / OpenAI API Key 后启用主线判定、每日教练、明日一句。
                </Text>
              </span>
            }
          >
            <Button
              type="primary"
              icon={<SettingOutlined />}
              onClick={() => useTabsStore.getState().openView("settings", "设置")}
            >
              去设置
            </Button>
          </Empty>
        </Card>
      )}

      {!hasFocus && !loading && (
        <Card>
          <Empty
            description={
              <span>
                今天还没有聚焦信号——试着在今日日志里写「今日待办 / 关键事件」，
                或给重要项目加 <Text code>mainline: true</Text>，重新索引后这里会汇总。
              </span>
            }
          />
        </Card>
      )}

      <Row gutter={[16, 16]}>
        {/* 今日待办（就地勾选/编辑/删除） */}
        <Col span={12}>
          <Card
            title={
              <Space>
                <CheckSquareOutlined />
                <span>今日待办</span>
                <Tag color="blue" style={{ margin: 0 }}>{todayTasks.length}</Tag>
                <Button
                  size="small"
                  type="text"
                  icon={<PlusOutlined />}
                  onClick={() => setTaskModalOpen(true)}
                  aria-label="快速添加待办"
                />
              </Space>
            }
            loading={loading}
            style={{ height: "100%" }}
          >
            {todayTasks.length === 0 ? (
              <Text type="secondary">今日笔记无未完成待办</Text>
            ) : (
              <List
                size="small"
                dataSource={todayTasks.slice(0, 5)}
                renderItem={(t) => (
                  <List.Item>
                    <Space style={{ width: "100%" }} align="center">
                      {t.source_line != null && (
                        <Checkbox
                          checked={t.done}
                          onChange={(e) => onToggleTask(t, e.target.checked)}
                        />
                      )}
                      {t.source_line != null ? (
                        <InlineEdit value={t.text} onSave={(nt) => onEditTask(t, nt)} />
                      ) : (
                        <Text ellipsis style={{ maxWidth: "100%" }}>{t.text}</Text>
                      )}
                      {t.source_line != null && (
                        <Popconfirm
                          title="删除该待办？"
                          onConfirm={() => onDeleteTask(t)}
                          okText="删除"
                          cancelText="取消"
                        >
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      )}
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* 今日事件（就地新建/编辑/删除） */}
        <Col span={12}>
          <Card
            title={
              <Space>
                <CalendarOutlined />
                <span>今日事件</span>
                <Tag color="green" style={{ margin: 0 }}>{events.length}</Tag>
                <Button
                  size="small"
                  type="text"
                  icon={<PlusOutlined />}
                  onClick={() => setEventModalOpen(true)}
                  aria-label="快速添加事件"
                />
              </Space>
            }
            loading={loading}
            style={{ height: "100%" }}
          >
            {events.length === 0 ? (
              <Text type="secondary">今日无事件</Text>
            ) : (
              <List
                size="small"
                dataSource={events.slice(0, 5)}
                renderItem={(ev) => (
                  <List.Item>
                    <Space style={{ width: "100%" }} align="center">
                      {ev.event_time && <Text type="secondary">{ev.event_time}</Text>}
                      {ev.source_line != null ? (
                        <InlineEdit
                          value={ev.raw_bullet ?? ev.title ?? ""}
                          onSave={(nt) => onEditEvent(ev, nt)}
                        />
                      ) : (
                        <Text ellipsis style={{ maxWidth: 200 }}>
                          {ev.title ?? ev.raw_bullet ?? "（未命名事件）"}
                        </Text>
                      )}
                      {ev.source_line != null && (
                        <Popconfirm
                          title="删除该事件？"
                          onConfirm={() => onDeleteEvent(ev)}
                          okText="删除"
                          cancelText="取消"
                        >
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      )}
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* 主线项目（点击开抽屉编辑，卡片整体跳项目页） */}
        <Col span={12}>
          <Card
            title={
              <Space>
                <CompassOutlined />
                <span>主线项目</span>
                <Tag color="purple" style={{ margin: 0 }}>{projects.length}</Tag>
                <Button
                  size="small"
                  type="text"
                  icon={<PlusOutlined />}
                  // 整卡 onClick 跳项目页，按钮须拦冒泡避免触发跳转
                  onClick={(e) => {
                    e.stopPropagation();
                    setProjectModalOpen(true);
                  }}
                  aria-label="快速创建项目"
                />
              </Space>
            }
            hoverable
            loading={loading}
            onClick={() => goTo("projects", "项目")}
            style={{ height: "100%" }}
          >
            {projects.length === 0 ? (
              <Text type="secondary">
                暂无主线项目（frontmatter <Text code>mainline: true</Text> 或 active top-3）
              </Text>
            ) : (
              <List
                size="small"
                dataSource={projects.slice(0, 5)}
                renderItem={(p) => (
                  <List.Item
                    onClick={(e) => {
                      e.stopPropagation();
                      setDrawerNoteId(p.note_id);
                    }}
                  >
                    <Space>
                      <Text strong>{p.name}</Text>
                      {p.okr_priority && <Tag style={{ margin: 0 }}>{p.okr_priority}</Tag>}
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* 索引统计（快捷入口） */}
        <Col span={12}>
          <Card title={<Space><ReloadOutlined /><span>索引状态</span></Space>} hoverable loading={loading}>
            <Space direction="vertical" size="small">
              <Text>
                {vault.indexing_state === "scanning"
                  ? "正在索引…"
                  : vault.last_indexed
                    ? `最后索引：${vault.last_indexed.slice(0, 19).replace("T", " ")}`
                    : "尚未索引"}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                点击左上「重新索引」可追赶磁盘变化；文件监听会自动增量更新。
              </Text>
            </Space>
          </Card>
        </Col>
      </Row>

      <NoteEditorDrawer
        open={!!drawerNoteId}
        noteId={drawerNoteId}
        onClose={() => setDrawerNoteId(null)}
        onSaved={() => refresh()}
      />

      {/* M2：三快速创建弹窗。onSuccess 后 refresh 刷新今日卡数据 */}
      <QuickAddTaskModal
        open={taskModalOpen}
        onCancel={() => setTaskModalOpen(false)}
        onSuccess={() => refresh()}
      />
      <QuickAddEventModal
        open={eventModalOpen}
        onCancel={() => setEventModalOpen(false)}
        onSuccess={() => refresh()}
      />
      <QuickAddProjectModal
        open={projectModalOpen}
        onCancel={() => setProjectModalOpen(false)}
        onSuccess={() => refresh()}
      />
    </Space>
  );
}
