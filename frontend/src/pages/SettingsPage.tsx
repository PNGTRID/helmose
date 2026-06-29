import { useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Popconfirm,
  Space,
  Typography,
  message,
} from "antd";
import { DeleteOutlined, ExportOutlined } from "@ant-design/icons";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import type { AgentExport } from "../types";

const { Text } = Typography;

/** 设置页：vault 管理 + Agent 状态导出 */
export default function SettingsPage() {
  const { vault, stats, load } = useVaultStore();
  const [exporting, setExporting] = useState(false);
  const [exportLog, setExportLog] = useState<AgentExport | null>(null);

  if (!vault) return null;

  const removeVault = async () => {
    try {
      await api.deleteVault(vault.id);
      message.success("已移除当前 vault，回到 onboarding");
      await load();
    } catch (e) {
      message.error(`移除失败：${e}`);
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const out = await api.exportLifeState(vault.id);
      setExportLog(out);
      message.success(
        `已导出（${out.pending_tasks} 待办 / ${out.total_notes} 笔记）`
      );
    } catch (e) {
      message.error(`导出失败：${e}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title="当前 Vault">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="名称">{vault.name}</Descriptions.Item>
          <Descriptions.Item label="路径">
            <Text code copyable>
              {vault.root_path}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="Obsidian 共存">
            {vault.is_obsidian_shared ? "是" : "否"}
          </Descriptions.Item>
          <Descriptions.Item label="最后索引">
            {vault.last_indexed ?? "未索引"}
          </Descriptions.Item>
          <Descriptions.Item label="索引统计">
            {stats
              ? `${stats.notes} 笔记 / ${stats.tasks} 任务 / ${stats.wikilinks} wikilink`
              : "—"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Agent 状态导出">
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Text type="secondary">
            聚合当前 vault 状态，生成「人读 + Agent 读」双产物，供外部智能体消费。
            写到 app_data_dir/agent/，<Text strong>不碰 vault 原文</Text>。
          </Text>
          <Button
            type="primary"
            icon={<ExportOutlined />}
            loading={exporting}
            onClick={doExport}
          >
            导出 LIFE-STATE.md + state.json
          </Button>
          {exportLog && (
            <Descriptions column={1} size="small" bordered style={{ marginTop: 8 }}>
              <Descriptions.Item label="日期">{exportLog.date_iso}</Descriptions.Item>
              <Descriptions.Item label="摘要">
                {exportLog.pending_tasks} 待办 / {exportLog.total_notes} 笔记
              </Descriptions.Item>
              <Descriptions.Item label="LIFE-STATE.md">
                <Text code copyable style={{ fontSize: 12 }}>
                  {exportLog.md_path}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="state.json">
                <Text code copyable style={{ fontSize: 12 }}>
                  {exportLog.json_path}
                </Text>
              </Descriptions.Item>
            </Descriptions>
          )}
        </Space>
      </Card>

      <Card title="切换 Vault">
        <Space direction="vertical" size="small">
          <Text type="secondary">
            想换一个文件夹？移除当前 vault 后会回到 onboarding，可重新选择。
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            （只清除 Helmose 的索引缓存，你的 wiki 原文完全不受影响）
          </Text>
          <Popconfirm
            title="移除当前 vault？"
            description="索引数据会清除，wiki 原文不动，可重新选择文件夹"
            onConfirm={removeVault}
            okText="移除并重选"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />}>
              移除当前 Vault，重新选择
            </Button>
          </Popconfirm>
        </Space>
      </Card>
    </Space>
  );
}
