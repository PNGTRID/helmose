// 图谱视图：全库双链关系力导向可视化 + 标签栏（点击 tag 搜笔记）。
// 点击节点 → 开笔记 tab。
import { useEffect, useState } from "react";
import { Empty, Spin, Typography } from "antd";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useTabsStore } from "../stores/tabs";
import type { GraphData, GraphNode, SearchResult, TagCount } from "../types";
import ForceGraph from "../components/ForceGraph";

const { Text } = Typography;

export default function GraphPage() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const openNote = useTabsStore((s) => s.openNote);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);

  // 标签栏（从文件面板移到这里）
  const [tags, setTags] = useState<TagCount[]>([]);
  const [tagQuery, setTagQuery] = useState<string | null>(null);
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);
  const [tagLoading, setTagLoading] = useState(false);

  useEffect(() => {
    if (!vault) return;
    setLoading(true);
    api
      .getGraphData(vault.id) // 不传 limit → 后端默认取所有有连接的节点（top 1000）
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    api.getTagsStats(vault.id).then(setTags).catch(() => setTags([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  const onTagClick = async (t: string) => {
    if (!vault) return;
    setTagQuery(t);
    setTagLoading(true);
    try {
      setTagResults(await api.searchNotes(vault.id, t, 50));
    } catch {
      setTagResults([]);
    } finally {
      setTagLoading(false);
    }
  };

  if (!vault) return null;

  const onSelect = (n: GraphNode) => {
    openNote({ id: n.id, rel_path: n.label, file_name: n.label, title: n.label });
  };

  return (
    <div style={{ display: "flex", gap: 12, minHeight: "calc(100vh - 160px)" }}>
      {/* 图谱 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 8 }}>
          <Text strong style={{ fontSize: 16 }}>
            图谱视图
          </Text>
          <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
            双链关系（全部有连接的节点）
          </Text>
        </div>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60 }}>
            <Spin />
          </div>
        ) : !data || data.nodes.length === 0 ? (
          <Empty description="暂无可视化的双链关系（需先索引含 [[wikilink]] 的笔记）" />
        ) : (
          <>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {data.nodes.length} 节点 / {data.edges.length} 连接 · 拖拽节点重排，点击节点跳转
            </Text>
            <ForceGraph data={data} onSelect={onSelect} />
          </>
        )}
      </div>

      {/* 标签栏 */}
      <div
        style={{
          width: 240,
          flexShrink: 0,
          overflow: "auto",
          borderLeft: "1px solid var(--ob-border)",
          paddingLeft: 12,
        }}
      >
        <div className="ob-side-title">标签</div>
        <div style={{ marginBottom: 16 }}>
          {tags.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              无标签
            </Text>
          ) : (
            tags.slice(0, 80).map(([t, c]) => (
              <span
                key={t}
                className="ob-tag"
                style={tagQuery === t ? { background: "var(--ob-accent)", color: "#fff" } : undefined}
                onClick={() => onTagClick(t)}
              >
                {t} · {c}
              </span>
            ))
          )}
        </div>

        {tagQuery && (
          <>
            <div className="ob-side-title">「{tagQuery}」的笔记</div>
            {tagLoading ? (
              <Spin size="small" />
            ) : tagResults.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                无
              </Text>
            ) : (
              tagResults.map((r) => (
                <div
                  key={r.id}
                  className="ob-file-item"
                  onClick={() =>
                    openNote({
                      id: r.id,
                      title: r.title,
                      file_name: r.file_name,
                      rel_path: r.rel_path,
                    })
                  }
                >
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.title ?? r.file_name}
                  </div>
                  <div className="ob-file-sub">{r.rel_path}</div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
