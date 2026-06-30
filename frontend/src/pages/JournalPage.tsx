// 日志页：列出 note_type 为 experience / log 的笔记（前端过滤 useAllNotesMeta）
// 点击复用 openNoteFromMeta → NoteView 打开编辑
import { useMemo } from "react";
import { Alert, Empty, List, Spin, Tag, Typography } from "antd";
import { useVaultStore } from "../stores/vault";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { openNoteFromMeta } from "../utils/note";

const { Text } = Typography;

const TYPE_LABEL: Record<string, string> = {
  log: "日志",
  experience: "经历",
};
const TYPE_COLOR: Record<string, string> = {
  log: "blue",
  experience: "purple",
};

export default function JournalPage() {
  const vault = useVaultStore((s) => s.vault);
  const { notes, loading, error } = useAllNotesMeta();

  // 过滤 experience / log，按 date_iso 倒序（无日期的排末尾）
  const journal = useMemo(() => {
    return notes
      .filter((n) => n.note_type === "experience" || n.note_type === "log")
      .sort((a, b) => {
        const da = a.date_iso ?? "";
        const db = b.date_iso ?? "";
        return da < db ? 1 : da > db ? -1 : 0;
      });
  }, [notes]);

  // 所有 hook 已调用，可早返回（与 ProjectsPage 一致）
  if (!vault) return null;

  const logCount = journal.filter((n) => n.note_type === "log").length;
  const expCount = journal.length - logCount;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ fontSize: 16 }}>
          日志
        </Text>
        <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
          {journal.length} 篇 · 日志 {logCount} / 经历 {expCount} · 点击打开
        </Text>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message="笔记加载失败" description={error} />
      ) : journal.length === 0 ? (
        <Empty description="暂无日志/经历笔记（note_type 需为 experience 或 log，并已索引）" />
      ) : (
        <List
          bordered
          dataSource={journal}
          renderItem={(n) => {
            const t = n.note_type ?? "";
            return (
              <List.Item
                style={{ cursor: "pointer" }}
                onClick={() => openNoteFromMeta(n)}
              >
                <List.Item.Meta
                  title={<span>{n.title ?? n.file_name}</span>}
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
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {n.rel_path}
                      </Text>
                    </span>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
}
