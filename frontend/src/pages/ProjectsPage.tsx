// 项目看板：按 status 分组展示（Obsidian 看板式）+ 就地改 status/mainline/priority + 抽屉编辑项目笔记（不跳 tab）。
// 就地：每项目卡 inline Select（status→setTag）+ Switch（mainline→setTag）+ InputNumber（priority→patchFrontmatter）。
// 写入后 bump watcherTick 刷新看板。点击项目卡 → NoteEditorDrawer。
import { useEffect, useMemo, useState } from "react";
import { Button, Input, InputNumber, message, Modal, Select, Space, Switch, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { relativeTime } from "../utils/date";
import DataState from "../components/DataState";
import NoteEditorDrawer from "../components/NoteEditorDrawer";
import type { Project } from "../types";

const { Text } = Typography;

const STATUS_ORDER = ["active", "pending", "paused", "completed", "abandoned"];
const STATUS_LABEL: Record<string, string> = {
  active: "进行中",
  pending: "筹备中",
  paused: "暂停",
  completed: "已完成",
  abandoned: "已放弃",
};
const STATUS_COLOR: Record<string, string> = {
  active: "green",
  pending: "blue",
  paused: "orange",
  completed: "default",
  abandoned: "red",
};

const bumpTick = () => useVaultStore.setState((s) => ({ watcherTick: s.watcherTick + 1 }));

/** 项目新建模板：含 frontmatter + 示例内容（目标/KR/行动），引导用户填写。 */
const PROJECT_TEMPLATE = (name: string, today: string) =>
  `---\ntitle: ${name}\ntype: project\ntags: [project-status:active]\ncreated: ${today}\n---\n\n` +
  `# ${name}\n\n` +
  `> 一句话定位：这个项目要达成什么？（示例：把 X 做成 Y，服务 Z 人群）\n\n` +
  `## 目标 (O)\n\n` +
  `- O1：示例——3 个月内达成 …\n\n` +
  `## 关键结果 (KR)\n\n` +
  `- KR1：示例——转化率达到 5%\n` +
  `- KR2：示例——次日留存 40%\n\n` +
  `## 行动\n\n` +
  `- [ ] 示例——完成市场调研 📅 ${today}\n` +
  `- [ ] 示例——搭出 MVP 原型\n\n` +
  `## 相关链接\n\n` +
  `- [[主索引]]\n`;

export default function ProjectsPage() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyMainline, setOnlyMainline] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [drawerNoteId, setDrawerNoteId] = useState<string | null>(null);

  // 显式重拉看板（与 TasksPage 同构；就地改/新建后立即刷新，不只靠 watcherTick 隐式触发）
  const refresh = async () => {
    if (!vault) return;
    setLoading(true);
    try {
      setProjects(await api.getProjects(vault.id));
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  // 新建项目：01_企业与项目资产/<name>/<name>.md（createNote 带路径安全+不覆盖）→ 开抽屉编辑全字段
  const createProject = async () => {
    if (!vault) return;
    const name = projectName.trim();
    if (!name) {
      message.warning("请输入项目名");
      return;
    }
    setCreating(true);
    try {
      const relPath = `01_企业与项目资产/${name}/${name}.md`;
      const today = dayjs().format("YYYY-MM-DD");
      const nc = await api.createNote(vault.id, relPath, PROJECT_TEMPLATE(name, today));
      message.success(`已创建项目「${name}」，请在抽屉里完善信息`);
      setCreateOpen(false);
      setProjectName("");
      setDrawerNoteId(nc.id); // 打开抽屉（字段表单 + WYSIWYG 正文）
      bumpTick();
      await refresh(); // 显式重拉看板（修「新建后消失」：不只靠 watcherTick 隐式刷新）
    } catch (e) {
      message.error(`创建失败：${e}`);
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  if (!vault) return null;

  const shown = useMemo(
    () => (onlyMainline ? projects.filter((p) => p.is_mainline) : projects),
    [projects, onlyMainline]
  );

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
      message.error(`状态修改失败：${e}`);
    }
  };
  const onMainlineChange = async (p: Project, on: boolean) => {
    try {
      await api.setTag(p.note_id, "mainline", on ? "mainline" : null);
      bumpTick();
    } catch (e) {
      message.error(`主线修改失败：${e}`);
    }
  };
  const onPriorityChange = async (p: Project, priority: number | null) => {
    if (priority == null) return;
    try {
      await api.patchFrontmatter(p.note_id, "priority", priority);
      bumpTick();
    } catch (e) {
      message.error(`优先级修改失败：${e}`);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <Text strong style={{ fontSize: 16 }}>项目看板</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {shown.length} 个项目 · 按 status 分组 · 主线置顶 · 就地改状态/主线/优先级 · 点击打开
        </Text>
        <Space size={4} style={{ marginLeft: "auto" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>只看主线</Text>
          <Switch checked={onlyMainline} onChange={setOnlyMainline} size="small" />
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建项目
          </Button>
        </Space>
      </div>

      <Modal
        open={createOpen}
        title="新建项目"
        onCancel={() => setCreateOpen(false)}
        onOk={createProject}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
      >
        <Input
          autoFocus
          placeholder="项目名（将创建 01_企业与项目资产/<项目名>/<项目名>.md）"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          onPressEnter={createProject}
        />
      </Modal>

      <DataState
        loading={loading}
        empty={shown.length === 0}
        emptyText={
          onlyMainline
            ? "暂无主线项目（frontmatter mainline:true，或 active 优先级/活跃度 top-3）"
            : "暂无项目（需 frontmatter type:project + project-status 标签，并已重新索引）"
        }
      >
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
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
                  style={{ marginBottom: 6, background: "var(--ob-bg)", border: "1px solid var(--ob-border)" }}
                  onClick={() => setDrawerNoteId(p.note_id)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                    </span>
                    {p.is_mainline && (
                      <Tag color="purple" style={{ margin: 0, flexShrink: 0 }}>主线</Tag>
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
                      options={STATUS_ORDER.map((st) => ({ value: st, label: STATUS_LABEL[st] }))}
                      placeholder="状态"
                    />
                    <span style={{ fontSize: 11, color: "var(--ob-text-faint)" }}>主线</span>
                    <Switch size="small" checked={p.is_mainline} onChange={(on) => onMainlineChange(p, on)} />
                    <span style={{ fontSize: 11, color: "var(--ob-text-faint)" }}>优先</span>
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
      </DataState>

      <NoteEditorDrawer
        open={!!drawerNoteId}
        noteId={drawerNoteId}
        onClose={() => setDrawerNoteId(null)}
      />
    </div>
  );
}
