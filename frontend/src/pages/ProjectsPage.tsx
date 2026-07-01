// 项目看板：按 status 分组展示项目（Obsidian 看板式）。点击项目 → 开笔记 tab。
// 显示 M1 算出的 priority / is_mainline 徽标 / last_activity 相对时间。
// 「只看主线」Switch：本地过滤 is_mainline=1（后端排序已主线置顶，过滤后仍保序）。
import { useEffect, useMemo, useState } from "react";
import { Button, Input, message, Modal, Space, Switch, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { openNoteFromMeta } from "../utils/note";
import { relativeTime } from "../utils/date";
import DataState from "../components/DataState";
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

export default function ProjectsPage() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyMainline, setOnlyMainline] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);

  // 新建项目：在 01_企业与项目资产/<name>/<name>.md 创建项目模板笔记（用户按钮触发，createNote 带路径安全+不覆盖）
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
      const tpl =
        `---\ntitle: ${name}\ntype: project\ntags: [project-status:active]\ncreated: ${today}\n---\n\n` +
        `# ${name}\n\n## 目标\n\n\n## 关键结果\n\n\n## 行动\n\n- \n`;
      const nc = await api.createNote(vault.id, relPath, tpl);
      message.success(`已创建项目「${name}」`);
      setCreateOpen(false);
      setProjectName("");
      openNoteFromMeta({
        id: nc.id,
        title: name,
        file_name: `${name}.md`,
        rel_path: nc.rel_path,
      });
      // 重新索引让新项目进入看板
      await useVaultStore.getState().index();
    } catch (e) {
      message.error(`创建失败：${e}`);
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    setLoading(true);
    api
      .getProjects(vault.id)
      .then((res) => {
        if (cancelled) return;
        setProjects(res);
      })
      .catch(() => {
        if (cancelled) return;
        setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  if (!vault) return null;

  // 只看主线：客户端过滤（后端排序已主线置顶，过滤后仍保序）
  const shown = useMemo(
    () => (onlyMainline ? projects.filter((p) => p.is_mainline) : projects),
    [projects, onlyMainline]
  );

  // 按 status 分组
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

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <Text strong style={{ fontSize: 16 }}>
          项目看板
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {shown.length} 个项目 · 按 status 分组 · 主线置顶 · 点击打开项目笔记
        </Text>
        <Space size={4} style={{ marginLeft: "auto" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>只看主线</Text>
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
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          {orderedStatus.map((s) => (
            <div
              key={s}
              style={{
                width: 240,
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
                  onClick={() =>
                    openNoteFromMeta({
                      id: p.note_id,
                      title: p.name,
                      file_name: p.name,
                      rel_path: p.home_rel_path ?? "",
                    })
                  }
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                      marginTop: 4,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    {p.okr_priority && <Tag style={{ margin: 0 }}>{p.okr_priority}</Tag>}
                    {p.priority != null && (
                      <span style={{ fontSize: 11, color: "var(--ob-text-faint)" }}>
                        优先级 {p.priority}
                      </span>
                    )}
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
    </div>
  );
}
