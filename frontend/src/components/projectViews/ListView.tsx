// 项目列表视图：antd Table 展示项目核心字段，行点击打开 NoteEditorDrawer。
// 列：名称 / 状态 Tag / 优先级 P标 / 主线 ✓ / OKR / 负责人(owner) / 最近活动(relativeTime)。
// 数据源由父组件 ProjectsPage 一次拉取传入（内存切视图，不重复 IPC）。
import { Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { relativeTime } from "../../utils/date";
import { priorityLabel, statusColor, statusLabel } from "./shared";
import type { Project } from "../../types";

const { Text } = Typography;

interface Props {
  projects: Project[];
  onOpen: (noteId: string) => void;
}

export default function ListView({ projects, onOpen }: Props) {
  const columns: ColumnsType<Project> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (_, r) => <Text strong>{r.name}</Text>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 96,
      render: (_, r) => (
        <Tag color={statusColor(r.status)} style={{ margin: 0 }}>
          {statusLabel(r.status)}
        </Tag>
      ),
    },
    {
      title: "优先级",
      dataIndex: "priority",
      key: "priority",
      width: 72,
      render: (_, r) => {
        const p = priorityLabel(r.priority);
        return p ? <Tag style={{ margin: 0 }}>{p}</Tag> : null;
      },
    },
    {
      title: "主线",
      dataIndex: "is_mainline",
      key: "is_mainline",
      width: 56,
      align: "center" as const,
      render: (_, r) => (r.is_mainline ? <Text type="success">✓</Text> : null),
    },
    {
      title: "OKR",
      dataIndex: "okr_priority",
      key: "okr_priority",
      width: 100,
      ellipsis: true,
      render: (_, r) =>
        r.okr_priority ? <Text type="secondary">{r.okr_priority}</Text> : null,
    },
    {
      title: "负责人",
      dataIndex: "owner",
      key: "owner",
      width: 100,
      ellipsis: true,
      render: (_, r) =>
        r.owner ? <Text>{r.owner}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: "最近活动",
      dataIndex: "last_activity",
      key: "last_activity",
      width: 120,
      render: (_, r) =>
        r.last_activity ? (
          <Text type="secondary">{relativeTime(r.last_activity)}</Text>
        ) : null,
    },
  ];

  return (
    <Table<Project>
      rowKey="id"
      columns={columns}
      dataSource={projects}
      size="small"
      pagination={{ pageSize: 50, showSizeChanger: false }}
      onRow={(r) => ({
        onClick: () => onOpen(r.note_id),
        style: { cursor: "pointer" },
      })}
    />
  );
}
