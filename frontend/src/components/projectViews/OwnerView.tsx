// 项目负责人视图：按 project.owner 分组（无 owner 归「未分配」），每组用 GridView 形态展示。
// 分组纯前端 useMemo（数据源由父组件传入），不重复 IPC。
import { useMemo } from "react";
import { Empty, Typography } from "antd";
import GridView from "./GridView";
import type { Project } from "../../types";

const { Text } = Typography;

interface Props {
  projects: Project[];
  onOpen: (noteId: string) => void;
}

const NO_OWNER = "未分配";

export default function OwnerView({ projects, onOpen }: Props) {
  // 按 owner 分组：owner 为 null/空字符串 归「未分配」，置末尾。
  const groups = useMemo(() => {
    const m = new Map<string, Project[]>();
    for (const p of projects) {
      const key = p.owner && p.owner.trim() ? p.owner.trim() : NO_OWNER;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    // 「未分配」组排末尾
    const entries = [...m.entries()].sort((a, b) => {
      if (a[0] === NO_OWNER) return 1;
      if (b[0] === NO_OWNER) return -1;
      return a[0].localeCompare(b[0], "zh-Hans");
    });
    return entries;
  }, [projects]);

  if (projects.length === 0) {
    return <Empty description="暂无项目" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {groups.map(([owner, items]) => (
        <div key={owner}>
          <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <Text strong>{owner}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {items.length} 个项目
            </Text>
          </div>
          <GridView projects={items} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}
