import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Col,
  List,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import type { Task } from "../types";

const { Text } = Typography;

/** 今日聚焦（教练面板）—— v0.1 显示索引统计 + 待办任务；主线判定/教练建议 v0.2 接 AI */
export default function TodayPage() {
  const { vault, indexing, stats, index } = useVaultStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const refreshTasks = async () => {
    if (!vault) return;
    setLoadingTasks(true);
    try {
      setTasks(await api.getTasks(vault.id, false, 30));
    } catch {
      setTasks([]);
    } finally {
      setLoadingTasks(false);
    }
  };

  useEffect(() => {
    refreshTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id, stats]);

  if (!vault) return null;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card>
        <Row gutter={16}>
          <Col span={6}>
            <Statistic title="已索引笔记" value={stats?.notes ?? "—"} />
          </Col>
          <Col span={6}>
            <Statistic title="任务总数" value={stats?.tasks ?? "—"} />
          </Col>
          <Col span={6}>
            <Statistic title="wikilink" value={stats?.wikilinks ?? "—"} />
          </Col>
          <Col span={6}>
            <Statistic
              title="索引耗时"
              value={stats?.elapsed_ms ?? "—"}
              suffix="ms"
            />
          </Col>
        </Row>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          loading={indexing}
          onClick={() => index().then(refreshTasks)}
          style={{ marginTop: 16 }}
        >
          重新索引
        </Button>
      </Card>

      <Card title="⚓ 今日聚焦">
        <Text type="secondary">
          主线判定与教练建议将在 v0.2 接入 AI。当前主线信号源：
          袁锐钦.md「当前主攻」+ Q2-OKR P0/P1 + 业务线 project-status。
        </Text>
      </Card>

      <Card title="待办任务（未完成，前 30）" loading={loadingTasks}>
        <List
          dataSource={tasks}
          locale={{ emptyText: "暂无任务——试试重新索引，或检查日志里的「明日待办」section" }}
          renderItem={(t) => (
            <List.Item>
              <List.Item.Meta
                title={<span>{t.text}</span>}
                description={
                  <Space size={4} wrap>
                    <Tag color="blue">{t.source}</Tag>
                    {t.source_line && <Text type="secondary" style={{ fontSize: 12 }}>L{t.source_line}</Text>}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </Space>
  );
}
