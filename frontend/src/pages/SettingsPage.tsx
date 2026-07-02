import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  List,
  Popconfirm,
  Radio,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { DeleteOutlined, ExportOutlined, ReloadOutlined, SaveOutlined, SyncOutlined } from "@ant-design/icons";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import type { AgentExport, AiSettings, BackupInfo, UpdateStatus } from "../types";

const { Text } = Typography;

/** 设置页：vault 管理 + Agent 状态导出 + 检查更新 + 备份管理 + 重置 */
export default function SettingsPage() {
  const { vault, stats, load } = useVaultStore();
  const [exporting, setExporting] = useState(false);
  const [exportLog, setExportLog] = useState<AgentExport | null>(null);
  const [checking, setChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [typeStats, setTypeStats] = useState<Record<string, number>>({});
  const [trash, setTrash] = useState<BackupInfo[]>([]);
  // —— AI 配置 ——
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [aiForm] = Form.useForm<AiSettings>();
  const [aiSaving, setAiSaving] = useState(false);

  if (!vault) return null;

  const loadBackups = async () => {
    if (!vault) return;
    setLoadingBackups(true);
    try {
      setBackups(await api.listBackups(vault.id));
    } catch {
      setBackups([]);
    } finally {
      setLoadingBackups(false);
    }
  };

  const loadTrash = async () => {
    if (!vault) return;
    try {
      setTrash(await api.listTrash(vault.id));
    } catch {
      setTrash([]);
    }
  };

  useEffect(() => {
    loadBackups();
    loadTrash();
    if (vault) {
      api.getNotesStats(vault.id).then(setTypeStats).catch(() => setTypeStats({}));
    }
    // 加载 AI 设置（首次进入即填入表单）
    api.getAiSettings()
      .then((s) => {
        setAiSettings(s);
        aiForm.setFieldsValue(s);
      })
      .catch(() => setAiSettings(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id]);

  const deleteBackup = async (name: string) => {
    if (!vault) return;
    try {
      await api.deleteBackup(vault.id, name);
      message.success("已删除备份");
      await loadBackups();
    } catch (e) {
      message.error(`删除失败：${e}`);
    }
  };

  const clearAllTrash = async () => {
    if (!vault) return;
    try {
      const n = await api.clearTrash(vault.id);
      message.success(`已永久清空 ${n} 项`);
      await loadTrash();
    } catch (e) {
      message.error(`清空失败：${e}`);
    }
  };

  const fmtSize = (b: number) =>
    b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

  const removeVault = async () => {
    try {
      await api.deleteVault(vault.id);
      message.success("已移除当前 vault，回到 onboarding");
      await load();
    } catch (e) {
      message.error(`移除失败：${e}`);
    }
  };

  const resetApp = async () => {
    try {
      await api.resetApp();
      message.success("已重置 Helmose，回到安装引导");
      await load();
    } catch (e) {
      message.error(`重置失败：${e}`);
    }
  };

  const doCheckUpdate = async () => {
    setChecking(true);
    try {
      const s = await api.checkUpdate();
      setUpdateStatus(s);
      if (s.available) {
        message.info(`发现新版本 v${s.version}`);
      }
    } catch (e) {
      setUpdateStatus({
        available: false,
        version: null,
        message: `检查失败：${e}`,
      });
    } finally {
      setChecking(false);
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

  // 保存 AI 配置：合并 form 值写 config.json
  const saveAiSettings = async () => {
    try {
      const values = await aiForm.validateFields();
      setAiSaving(true);
      const updated = await api.setAiSettings({
        provider: values.provider,
        api_key: values.api_key ?? "",
        enabled: !!values.enabled,
      });
      setAiSettings(updated);
      aiForm.setFieldsValue(updated);
      message.success("AI 配置已保存");
    } catch (e) {
      // validateFields 抛 ValidationError（无 errorFields 字段时为真实异常）
      if (e && typeof e === "object" && "errorFields" in e) return;
      message.error(`保存失败：${e}`);
    } finally {
      setAiSaving(false);
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
          <Descriptions.Item label="类型分布">
            {Object.keys(typeStats).length === 0
              ? "—"
              : Object.entries(typeStats)
                  .sort((a, b) => b[1] - a[1])
                  .map(([t, c]) => (
                    <Tag key={t} style={{ margin: 2 }}>
                      {t}: {c}
                    </Tag>
                  ))}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title="AI 教练配置"
        extra={
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={aiSaving}
            onClick={saveAiSettings}
          >
            保存
          </Button>
        }
      >
        <Form
          form={aiForm}
          layout="vertical"
          initialValues={
            aiSettings ?? { provider: "claude", api_key: "", enabled: false }
          }
        >
          <Form.Item
            name="enabled"
            label="启用 AI"
            valuePropName="checked"
            tooltip="关闭后所有 AI 命令走本地启发式降级"
          >
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
          <Form.Item
            name="provider"
            label="AI 服务商"
            tooltip="选 Claude 或 OpenAI；其他/未知会走降级"
          >
            <Radio.Group>
              <Radio value="claude">Claude（Anthropic）</Radio>
              <Radio value="openai">OpenAI</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            name="api_key"
            label="API Key"
            tooltip="仅存本机 app_data_dir/config.json，不入 vault 不入 git"
          >
            <Input.Password
              placeholder="sk-..."
              autoComplete="off"
              visibilityToggle
            />
          </Form.Item>
        </Form>
        <Text type="secondary" style={{ fontSize: 12 }}>
          · key 仅存本机 <Text code>app_data_dir/config.json</Text>，
          <Text strong>不入 vault 不入 git</Text>。
          <br />· 未填 key 或关闭启用 → 所有 AI 命令自动走本地启发式降级
         （TodayPage 卡片标「本地推断」灰色标签）。
        </Text>
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

      <Card title="检查更新">
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Text type="secondary">
            检查 Helmose 是否有新版本。当前为开发构建，更新源尚未配置真实地址。
          </Text>
          <Button
            icon={<SyncOutlined />}
            loading={checking}
            onClick={doCheckUpdate}
          >
            检查更新
          </Button>
          {updateStatus && (
            <Text
              type={updateStatus.available ? "success" : "secondary"}
              style={{ fontSize: 12 }}
            >
              {updateStatus.available
                ? `✓ ${updateStatus.message}`
                : updateStatus.message}
            </Text>
          )}
        </Space>
      </Card>

      <Card
        title={
          <Space>
            <span>备份管理</span>
            <Button size="small" type="text" icon={<ReloadOutlined />} loading={loadingBackups} onClick={loadBackups} />
          </Space>
        }
      >
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Text type="secondary">
            编辑保存时自动备份到 <Text code>{vault.root_path}/.helmose/backup/</Text>。可清理旧备份释放空间。
          </Text>
          {backups.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无备份（编辑笔记后会自动生成）" />
          ) : (
            <List
              size="small"
              dataSource={backups}
              renderItem={(b) => (
                <List.Item
                  actions={[
                    <Popconfirm
                      key="del"
                      title="删除该备份？"
                      onConfirm={() => deleteBackup(b.name)}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={<Text ellipsis style={{ maxWidth: 320 }}>{b.name}</Text>}
                    description={
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {fmtSize(b.size)} · {b.mtime ? b.mtime.slice(0, 19).replace("T", " ") : ""}
                      </Text>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Space>
      </Card>

      <Card
        title={
          <Space>
            <span>回收站</span>
            <Tag>{trash.length}</Tag>
          </Space>
        }
      >
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Text type="secondary">
            删除的笔记移到 <Text code>.helmose/trash/</Text>（可从文件系统手动恢复）。{trash.length} 项。
          </Text>
          {trash.length > 0 && (
            <>
              <List
                size="small"
                dataSource={trash.slice(0, 10)}
                renderItem={(b) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<Text ellipsis style={{ maxWidth: 320, fontSize: 12 }}>{b.name}</Text>}
                      description={
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {fmtSize(b.size)} · {b.mtime ? b.mtime.slice(0, 19).replace("T", " ") : ""}
                        </Text>
                      }
                    />
                  </List.Item>
                )}
              />
              <Popconfirm
                title="永久清空回收站？"
                description="不可恢复，所有软删除的笔记将被彻底删除"
                onConfirm={clearAllTrash}
                okText="清空"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button danger size="small" icon={<DeleteOutlined />}>
                  永久清空
                </Button>
              </Popconfirm>
            </>
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

      <Card title="重置 Helmose">
        <Space direction="vertical" size="small">
          <Text type="secondary">
            清除所有派生缓存（SQLite 索引库 + Agent 状态导出）并移除 vault 注册，回到首次安装状态。
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            （<Text strong>绝不触碰 vault 原文</Text>——只清 Helmose 自己生成的缓存，可随时重新索引恢复）
          </Text>
          <Popconfirm
            title="重置 Helmose？"
            description="将清除全部索引数据与 vault 注册，wiki 原文不动。操作不可撤销。"
            onConfirm={resetApp}
            okText="确认重置"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />}>
              重置 Helmose，回到安装引导
            </Button>
          </Popconfirm>
        </Space>
      </Card>

      <Card title="关于本地化">
        <Space direction="vertical" size="small">
          <Text type="secondary">
            应用界面、菜单、右键菜单跟随系统语言（简体中文）。
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            · macOS 系统级菜单（含 WKWebView 右键 Copy / Paste / Look Up / Search / Share）的语言由 app bundle 声明的本地化决定，已声明 zh-Hans。
            <br />
            · <Text strong>仅 release 构建生效</Text>——开发模式（tauri dev）不打包 bundle，右键英文是已知行为，非 bug。
            <br />· antd 组件（弹窗 / 日期选择器 / 表单）已统一中文 locale。
          </Text>
        </Space>
      </Card>
    </Space>
  );
}
