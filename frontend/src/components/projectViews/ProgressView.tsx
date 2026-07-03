// 项目进度视图：调 get_project_progress 运行时聚合 → Card + Progress 条（done/total 百分比）+ 逾期红色角标。
// 进度数据用 project_id 关联项目（与 ProjectsPage projects 数据 join）。
// 注意：当前 tasks.project_id 无写入路径（backlog），真实 vault 进度可能全部 0 —— 0 数据也要友好显示。
import "./ProgressView.css";
import { Badge, Progress, Row, Col, Tag, Typography } from "antd";
import EmptyState from "../EmptyState";
import * as api from "../../api";
import { useVaultStore } from "../../stores/vault";
import { useEffect, useState } from "react";
import { statusColor, statusLabel } from "./shared";
import type { Project, ProjectProgress } from "../../types";

const { Text } = Typography;

interface Props {
  projects: Project[];
  onOpen: (noteId: string) => void;
}

export default function ProgressView({ projects, onOpen }: Props) {
  const vault = useVaultStore((s) => s.vault);
  const watcherTick = useVaultStore((s) => s.watcherTick);
  const [progress, setProgress] = useState<ProjectProgress[]>([]);
  const [loading, setLoading] = useState(false);

  // 拉进度：cancelled flag 守竞态。watcherTick 变化时重拉（任务变动后刷新）。
  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    setLoading(true);
    api
      .getProjectProgress(vault.id)
      .then((res) => {
        if (!cancelled) setProgress(res);
      })
      .catch(() => {
        if (!cancelled) setProgress([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, watcherTick]);

  // 全部项目进度为 0（无关联任务）→ 友好空态
  const hasAnyTask = progress.some((p) => p.total > 0);
  if (!loading && progress.length > 0 && !hasAnyTask) {
    return (
      <EmptyState
        icon="project"
        title="暂无任务关联"
        description="任务需带 #project:名称 标签才会聚合到项目进度"
        compact
      />
    );
  }
  if (progress.length === 0 && !loading) {
    return <EmptyState icon="project" title="暂无项目进度数据" compact />;
  }

  // 用 project_id 关联项目（取 status / note_id / 主线信息）
  const projById = new Map<string, Project>();
  for (const p of projects) projById.set(p.id, p);

  return (
    <Row gutter={[16, 16]}>
      {progress.map((pg) => {
        const proj = projById.get(pg.project_id);
        const percent = pg.total > 0 ? Math.round((pg.done / pg.total) * 100) : 0;
        const status = proj?.status ?? null;
        return (
          <Col key={pg.project_id} xs={24} sm={12} md={8} lg={6}>
            <div
              className="pv-progress-card"
              style={{ cursor: proj ? "pointer" : "default" }}
              onClick={() => proj && onOpen(proj.note_id)}
            >
              <div className="pv-progress-head">
                <span className="pv-progress-name" title={pg.name}>
                  {pg.name}
                </span>
                {status && (
                  <Tag color={statusColor(status)} style={{ margin: 0 }}>
                    {statusLabel(status)}
                  </Tag>
                )}
                {pg.due_overdue > 0 && (
                  <Badge count={pg.due_overdue} overflowCount={99} color="red" />
                )}
              </div>
              <Progress percent={percent} size="small" />
              <div className="pv-progress-foot">
                {pg.total > 0 ? (
                  <Text type="secondary">
                    {pg.done}/{pg.total} 完成
                    {pg.due_overdue > 0 && (
                      <Text type="danger" style={{ marginLeft: 8 }}>
                        逾期 {pg.due_overdue}
                      </Text>
                    )}
                  </Text>
                ) : (
                  <Text type="secondary">暂无任务关联</Text>
                )}
              </div>
            </div>
          </Col>
        );
      })}
    </Row>
  );
}
