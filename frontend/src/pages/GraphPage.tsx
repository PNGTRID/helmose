// 图谱视图：全库双链关系力导向可视化。点击节点 → 开笔记 tab（用真实 NoteMeta）。
// 标签栏已移至右侧大纲侧边栏（SidePanel），这里只保留图谱。
// 节点搜索：输入关键词过滤节点（label 含关键词）+ 保留匹配节点间的边。
import { useEffect, useMemo, useState } from "react";
import { Input, Typography } from "antd";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { openNoteFromMeta } from "../utils/note";
import DataState from "../components/DataState";
import type { GraphData, GraphNode, NoteMeta } from "../types";
import ForceGraph from "../components/ForceGraph";

const { Text } = Typography;

export default function GraphPage() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const { notes } = useAllNotesMeta();
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  // 节点搜索过滤：label 含关键词的节点 + 它们之间的边
  const filtered = useMemo(() => {
    if (!data) return null;
    const kw = q.trim().toLowerCase();
    if (!kw) return data;
    const matched = data.nodes.filter((n) => n.label.toLowerCase().includes(kw));
    const ids = new Set(matched.map((n) => n.id));
    const edges = data.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes: matched, edges };
  }, [data, q]);

  useEffect(() => {
    if (!vault) return;
    setLoading(true);
    api
      .getGraphData(vault.id) // 不传 limit → 后端默认取所有有连接的节点（top 1000）
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  // id → NoteMeta：点击节点时解析真实 rel_path/file_name/title（GraphNode 只有 id+label）
  const noteById = useMemo(() => {
    const m = new Map<string, NoteMeta>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);

  if (!vault) return null;

  const onSelect = (n: GraphNode) => {
    const meta = noteById.get(n.id);
    openNoteFromMeta(
      meta
        ? { id: meta.id, title: meta.title, file_name: meta.file_name, rel_path: meta.rel_path }
        : { id: n.id, rel_path: n.label, file_name: n.label, title: n.label }
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <Text strong style={{ fontSize: 16 }}>
          图谱视图
        </Text>
        <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
          双链关系（全部有连接的节点）· 拖拽节点重排，点击节点跳转
        </Text>
      </div>
      {/* children 在 GraphPage render 时即时求值，必须 {data && …} 短路保护：
          data=null（加载前 / fetch 失败）时 data.nodes 会崩 —— DataState 的 empty
          判断拦不住 JSX 构造期求值（这是我上次用 data! 误判引入的回归）。 */}
      <DataState
        loading={loading}
        empty={!data || data.nodes.length === 0}
        emptyText="暂无可视化的双链关系（需先索引含 [[wikilink]] 的笔记）"
      >
        {data && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {q.trim() ? `${filtered?.nodes.length ?? 0} / ${data.nodes.length} 节点` : `${data.nodes.length} 节点`} · {filtered?.edges.length ?? data.edges.length} 连接
              </Text>
              <Input
                size="small"
                allowClear
                placeholder="过滤节点（按笔记名）…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ width: 220 }}
              />
            </div>
            {filtered && filtered.nodes.length > 0 ? (
              <ForceGraph data={filtered} onSelect={onSelect} />
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                无匹配节点
              </Text>
            )}
          </>
        )}
      </DataState>
    </div>
  );
}
