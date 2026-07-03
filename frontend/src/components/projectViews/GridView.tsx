// 项目网格视图：antd Row+Col+Card 布局。
// 卡片：项目名（主线紫色左条）+ status Tag + priority P 标 + last_activity 相对时间。
// 响应式断点：xs=24（1 列）/ sm=12（2 列）/ md=8（3 列）/ lg=6（4 列）。
// 数据源由父组件 ProjectsPage 传入（内存切视图，不重复 IPC）。
import "./GridView.css";
import { Card, Col, Row, Tag, Typography } from "antd";
import EmptyState from "../EmptyState";
import { relativeTime } from "../../utils/date";
import { priorityLabel, statusColor, statusLabel } from "./shared";
import type { Project } from "../../types";

const { Text } = Typography;

interface Props {
  projects: Project[];
  onOpen: (noteId: string) => void;
}

export default function GridView({ projects, onOpen }: Props) {
  if (projects.length === 0) {
    return <EmptyState icon="project" title="暂无项目" compact />;
  }
  return (
    <Row gutter={[16, 16]}>
      {projects.map((p) => {
        const pLabel = priorityLabel(p.priority);
        return (
          <Col key={p.id} xs={24} sm={12} md={8} lg={6}>
            <Card
              size="small"
              className={`pv-grid-card${p.is_mainline ? " pv-mainline" : ""}`}
              onClick={() => onOpen(p.note_id)}
            >
              <div className="pv-grid-name" title={p.name}>
                {p.name}
              </div>
              <div className="pv-grid-meta">
                <Tag color={statusColor(p.status)} style={{ margin: 0 }}>
                  {statusLabel(p.status)}
                </Tag>
                {pLabel && <Tag style={{ margin: 0 }}>{pLabel}</Tag>}
                {p.is_mainline && (
                  <Tag color="purple" style={{ margin: 0 }}>
                    主线
                  </Tag>
                )}
              </div>
              {p.last_activity && (
                <div className="pv-grid-activity">
                  <Text type="secondary">{relativeTime(p.last_activity)}</Text>
                </div>
              )}
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
