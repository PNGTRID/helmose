// 图谱视图：全库双链关系力导向可视化。点击节点 → 开笔记 tab。
// 标签栏已移至右侧大纲侧边栏（SidePanel），这里只保留图谱。
import { useEffect, useState } from "react";
import { Empty, Spin, Typography } from "antd";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useTabsStore } from "../stores/tabs";
import type { GraphData, GraphNode } from "../types";
import ForceGraph from "../components/ForceGraph";

const { Text } = Typography;

export default function GraphPage() {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const openNote = useTabsStore((s) => s.openNote);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);

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

  if (!vault) return null;

  const onSelect = (n: GraphNode) => {
    openNote({ id: n.id, rel_path: n.label, file_name: n.label, title: n.label });
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
      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Spin />
        </div>
      ) : !data || data.nodes.length === 0 ? (
        <Empty description="暂无可视化的双链关系（需先索引含 [[wikilink]] 的笔记）" />
      ) : (
        <>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {data.nodes.length} 节点 / {data.edges.length} 连接
          </Text>
          <ForceGraph data={data} onSelect={onSelect} />
        </>
      )}
    </div>
  );
}
