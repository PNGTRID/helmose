// 项目看板：按 status 分组展示项目（Obsidian 看板式）。点击项目 → 开笔记 tab。
import { useEffect, useState } from "react";
import { Tag, Typography } from "antd";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { openNoteFromMeta } from "../utils/note";
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

  useEffect(() => {
    if (!vault) return;
    setLoading(true);
    api
      .getProjects(vault.id)
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  if (!vault) return null;

  // 按 status 分组
  const groups = new Map<string, Project[]>();
  for (const p of projects) {
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
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ fontSize: 16 }}>
          项目看板
        </Text>
        <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
          {projects.length} 个项目 · 按 status 分组 · 点击打开项目笔记
        </Text>
      </div>

      <DataState
        loading={loading}
        empty={projects.length === 0}
        emptyText="暂无项目（需 frontmatter type:project + project-status 标签，并已重新索引）"
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
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  {(p.is_mainline || p.okr_priority) && (
                    <div style={{ marginTop: 4 }}>
                      {p.is_mainline && (
                        <Tag color="purple" style={{ margin: 0, marginRight: 4 }}>
                          主线
                        </Tag>
                      )}
                      {p.okr_priority && <Tag style={{ margin: 0 }}>{p.okr_priority}</Tag>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </DataState>
    </div>
  );
}
