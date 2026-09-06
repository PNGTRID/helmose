// 项目页：5 视图（看板 / 列表 / 网格 / 进度 / 负责人）+ 快速创建弹窗（4 模板）。
// 数据源：get_projects 一次拉取内存切视图（不重复 IPC）；进度视图单独调 get_project_progress。
// 就地：看板 inline 改 status/mainline/priority；列表/网格/负责人点击 → NoteEditorDrawer。
// 视图状态 localStorage 持久化（与 tabs/theme 同模式）。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  InputNumber,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import AppIcon from "../components/AppIcon";
import * as api from "../api";
import { notifyError } from "../utils/notifyError";
import { useVaultStore } from "../stores/vault";
import { useProjectViewStore, type ProjectView } from "../stores/projectView";
import { relativeTime } from "../utils/date";
import DataState from "../components/DataState";
import NoteEditorDrawer from "../components/NoteEditorDrawer";
import QuickAddProjectModal from "../components/QuickAddProjectModal";
import ListView from "../components/projectViews/ListView";
import GridView from "../components/projectViews/GridView";
import ProgressView from "../components/projectViews/ProgressView";
import OwnerView from "../components/projectViews/OwnerView";
import {
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_ORDER,
} from "../components/projectViews/shared";
import type { Project } from "../types";

const { Text } = Typography;

const VIEW_OPTIONS: { label: ReactNode; value: ProjectView }[] = [
  { label: (<><AppIcon name="apps" size={13} /> 看板</>), value: "kanban" },
  { label: (<><AppIcon name="list" size={13} /> 列表</>), value: "list" },
  { label: (<><AppIcon name="table" size={13} /> 网格</>), value: "grid" },
  { label: (<><AppIcon name="dashboard" size={13} /> 进度</>), value: "progress" },
  { label: (<><AppIcon name="user" size={13} /> 负责人</>), value: "owner" },
];

const bumpTick = () => useVaultStore.getState().bumpTick();

export default function ProjectsPage() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyMainline, setOnlyMainline] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [drawerNoteId, setDrawerNoteId] = useState<string | null>(null);
  // refresh 请求序号守卫：watcherTick 抖动 + 就地改 bumpTick 双触发时丢弃过期响应，避免脏写
  const refreshSeq = useRef(0);
  // 视图状态用 store 持久化（与 taskView 一致，localStorage 不可用时静默降级）
  const view = useProjectViewStore((s) => s.view);
  const setView = useProjectViewStore((s) => s.setView);

  // 显式重拉看板（与 TasksPage 同构；就地改/新建后立即刷新，不只靠 watcherTick 隐式触发）
  // seq 守卫：并发 refresh 时只采纳最新一次的响应（watcherTick 抖动 + bumpTick 双触发）
  const refresh = async () => {
    if (!vault) return;
    const mySeq = ++refreshSeq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProjects(vault.id);
      if (refreshSeq.current !== mySeq) return; // 已被更新请求覆盖，丢弃
      setProjects(data);
    } catch (e) {
      if (refreshSeq.current !== mySeq) return;
      console.error("[ProjectsPage] 加载项目失败", e);
      setError(String(e));
      setProjects([]);
    } finally {
      if (refreshSeq.current === mySeq) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  const shown = useMemo(
    () => (onlyMainline ? projects.filter((p) => p.is_mainline) : projects),
    [projects, onlyMainline]
  );

  if (!vault) return null;

  // 看板分组（按 status）
  const groups = new Map<string, Project[]>();
  for (const p of shown) {
    const s = p.status ?? "(未标记)";
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s)!.push(p);
  }
  const orderedStatus = [
    ...STATUS_ORDER.filter((s) => groups.has(s)),
    ...[...groups.keys()].filter((s) => !STATUS_ORDER.includes(s)),
  ];

  // —— 就地改项目属性（写回 frontmatter/tags）——
  const onStatusChange = async (p: Project, status: string) => {
    try {
      await api.setTag(p.note_id, "project-status", status);
      bumpTick();
    } catch (e) {
      notifyError("状态修改", e);
      void refresh(); // 回滚 UI 到真实状态（vault 未改，刷新后下拉框还原）
    }
  };
  const onMainlineChange = async (p: Project, on: boolean) => {
    try {
      await api.setTag(p.note_id, "mainline", on ? "mainline" : null);
      bumpTick();
    } catch (e) {
      notifyError("主线修改", e);
      void refresh();
    }
  };
  const onPriorityChange = async (p: Project, priority: number | null) => {
    if (priority == null) return;
    try {
      await api.patchFrontmatter(p.note_id, "priority", priority);
      bumpTick();
    } catch (e) {
      notifyError("优先级修改", e);
      void refresh();
    }
  };

  return (
    <div>
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          项目
        </Text>
        <Segmented<ProjectView>
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
          size="small"
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {shown.length} 个项目
        </Text>
        <Space size={4} style={{ marginLeft: "auto" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            只看主线
          </Text>
          <Switch checked={onlyMainline} onChange={setOnlyMainline} size="small" />
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            新建项目
          </Button>
        </Space>
      </div>

      {/* 快速创建项目弹窗（4 模板）—— 成功后 bumpTick + refresh，不自动开抽屉（弹窗已填完） */}
      <QuickAddProjectModal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onSuccess={() => {
          bumpTick();
          void refresh();
        }}
      />

      <DataState
        loading={loading}
        error={error ?? undefined}
        errorTitle="项目加载失败"
        empty={shown.length === 0}
        emptyText={
          onlyMainline
            ? "暂无主线项目（frontmatter mainline:true，或 active 优先级/活跃度 top-3）"
            : "暂无项目（需 frontmatter type:project + project-status 标签，并已重新索引）"
        }
      >
        {view === "kanban" && (
          <div
            style={{
              display: "flex",
              gap: 16,
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            {orderedStatus.map((s) => (
              <div
                key={s}
                style={{
                  width: 260,
                  flexShrink: 0,
                  background: "var(--ob-bg-mod)",
                  borderRadius: 8,
                  padding: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 6px 8px",
                    borderBottom: "1px solid var(--ob-border)",
                    marginBottom: 8,
                  }}
                >
                  <Tag color={STATUS_COLOR[s] ?? "default"} style={{ margin: 0 }}>
                    {STATUS_LABEL[s] ?? s}
                  </Tag>
                  <span style={{ fontSize: 12, color: "var(--ob-text-faint)" }}>
                    {groups.get(s)!.length}
                  </span>
                </div>
                {groups.get(s)!.map((p) => (
                  <div
                    key={p.id}
                    className="ob-file-item"
                    style={{
                      marginBottom: 6,
                      background: "var(--ob-bg)",
                      border: "1px solid var(--ob-border)",
                    }}
                    onClick={() => setDrawerNoteId(p.note_id)}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 500,
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.name}
                      </span>
                      {p.is_mainline && (
                        <Tag color="purple" style={{ margin: 0, flexShrink: 0 }}>
                          主线
                        </Tag>
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Select
                        size="small"
                        value={p.status ?? undefined}
                        onChange={(v) => onStatusChange(p, v)}
                        style={{ width: 92 }}
                        options={STATUS_ORDER.map((st) => ({
                          value: st,
                          label: STATUS_LABEL[st],
                        }))}
                        placeholder="状态"
                      />
                      <span style={{ fontSize: 11, color: "var(--ob-text-faint)" }}>
                        主线
                      </span>
                      <Switch
                        size="small"
                        checked={p.is_mainline}
                        onChange={(on) => onMainlineChange(p, on)}
                      />
                      <span style={{ fontSize: 11, color: "var(--ob-text-faint)" }}>
                        优先
                      </span>
                      <InputNumber
                        size="small"
                        value={p.priority ?? undefined}
                        onChange={(v) => onPriorityChange(p, v ?? null)}
                        style={{ width: 56 }}
                        placeholder="—"
                      />
                      {p.last_activity && (
                        <span style={{ fontSize: 11, color: "var(--ob-text-faint)" }}>
                          {relativeTime(p.last_activity)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {view === "list" && (
          <ListView projects={shown} onOpen={(id) => setDrawerNoteId(id)} />
        )}

        {view === "grid" && (
          <GridView projects={shown} onOpen={(id) => setDrawerNoteId(id)} />
        )}

        {view === "progress" && (
          <ProgressView
            projects={shown}
            onOpen={(id) => setDrawerNoteId(id)}
          />
        )}

        {view === "owner" && (
          <OwnerView projects={shown} onOpen={(id) => setDrawerNoteId(id)} />
        )}
      </DataState>

      <NoteEditorDrawer
        open={!!drawerNoteId}
        noteId={drawerNoteId}
        onClose={() => setDrawerNoteId(null)}
      />
    </div>
  );
}
