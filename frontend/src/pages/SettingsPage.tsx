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
  Segmented,
  Space,
  Switch,
  Modal,
  Tag,
  Typography,
  message,
} from "antd";
import { DeleteOutlined, ExportOutlined, ReloadOutlined, SaveOutlined, SyncOutlined } from "@ant-design/icons";
import AppIcon from "../components/AppIcon";
import * as api from "../api";
import { notifyError } from "../utils/notifyError";
import { useVaultStore } from "../stores/vault";
import type { AgentExport, AiSettings, BackupInfo, MigratePlan, MigratePreview, UpdateStatus } from "../types";
import { useMarkingStyleStore, type MarkingStyle } from "../stores/markingStyle";
import { isInbox } from "../utils/taskGrouping";
import { clearAllDrafts } from "../utils/drafts";
import { decideApiKeyAction } from "../utils/aiSettings";

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
  // api_key 用独立 useState 而非 Form 字段（B4 安全）：Form state 全局可读，XSS 注入后可 getField 读明文 key；
  // 独立 state + 提交即清，缩短明文 key 残留窗口（用户输入→保存→清空，几秒内完成）
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [aiForm] = Form.useForm<AiSettings>();
  const [aiSaving, setAiSaving] = useState(false);
  // —— 任务标记风格（helmose 文字 / obsidian emoji）——
  const markingStyle = useMarkingStyleStore((s) => s.style);
  const setMarkingStyle = useMarkingStyleStore((s) => s.setStyle);
  // —— 存量任务迁移（GTD 固化：把 isInbox 存量任务显式标记，脱离温和版收集箱）——
  const [migrating, setMigrating] = useState(false);
  const [migratePreview, setMigratePreview] = useState<MigratePreview | null>(null);

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
    // cancelled flag 守竞态：vault 移除/重挂载时，in-flight 的 IPC 响应不再 setState（防卸载后脏写）。
    // loadBackups/loadTrash 复用 reload 按钮（外部调用不应被 cancelled 屏蔽），但其内 try/catch 兜底，
    // 卸载后 setState 在 React 19 无警告且无功能危害；此处只守 effect 内联的 4 个 fetch。
    let cancelled = false;
    loadBackups();
    loadTrash();
    if (vault) {
      api.getNotesStats(vault.id)
        .then((s) => { if (!cancelled) setTypeStats(s); })
        .catch(() => { if (!cancelled) setTypeStats({}); });
    }
    // 加载 AI 设置（首次进入即填入表单）
    api.getAiSettings()
      .then((s) => {
        if (cancelled) return;
        setAiSettings(s);
        aiForm.setFieldsValue(s);
      })
      .catch(() => { if (!cancelled) setAiSettings(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.id]);

  if (!vault) return null;

  // 算迁移计划：温和版 isInbox 任务（priority=0 AND urgency="" AND due=null AND 顶层）→ 固化 priority=1
  // （显式不重要，脱离收集箱的 priority=0 条件；urgency 不动保留 due 派生）。仅顶层可写（source_line 非空）。
  const computeMigrationPlans = async (): Promise<MigratePlan[]> => {
    const tasks = await api.getTasks(vault.id);
    return tasks
      .filter((t) => isInbox(t) && t.source_line != null)
      .map((t) => ({
        note_id: t.note_id,
        source_line: t.source_line as number,
        priority: 1,
        urgency: "",
      }));
  };
  const onMigrateDryRun = async () => {
    setMigrating(true);
    try {
      const plans = await computeMigrationPlans();
      if (plans.length === 0) {
        message.info("没有需要迁移的任务（收集箱为空）");
        return;
      }
      const preview = await api.migrateTaskMarks(plans, markingStyle, true);
      setMigratePreview(preview);
    } catch (e) {
      notifyError("扫描", e);
    } finally {
      setMigrating(false);
    }
  };
  const onMigrateApply = async () => {
    setMigrating(true);
    try {
      const plans = await computeMigrationPlans();
      const result = await api.migrateTaskMarks(plans, markingStyle, false);
      message.success(`已固化 ${result.note_count} 篇笔记的 ${result.item_count} 个任务（已备份到 .helmose/backup）`);
      setMigratePreview(null);
    } catch (e) {
      notifyError("迁移", e);
    } finally {
      setMigrating(false);
    }
  };

  const deleteBackup = async (name: string) => {
    if (!vault) return;
    try {
      await api.deleteBackup(vault.id, name);
      message.success("已删除备份");
      await loadBackups();
    } catch (e) {
      notifyError("删除", e);
    }
  };

  const clearAllTrash = async () => {
    if (!vault) return;
    try {
      const n = await api.clearTrash(vault.id);
      message.success(`已永久清空 ${n} 项`);
      await loadTrash();
    } catch (e) {
      notifyError("清空", e);
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
      notifyError("移除", e);
    }
  };

  const resetApp = async () => {
    try {
      await api.resetApp();
      clearAllDrafts(); // 清本地草稿缓存（防 vault 正文副本残留在 webview localStorage）
      message.success("已重置 Helmose，回到安装引导");
      await load();
    } catch (e) {
      notifyError("重置", e);
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
      notifyError("导出", e);
    } finally {
      setExporting(false);
    }
  };

  // 保存 AI 配置：合并 form 值写 config.json
  const saveAiSettings = async () => {
    try {
      const values = await aiForm.validateFields();
      setAiSaving(true);
      // provider/enabled 走 setAiSettings（key 不经此命令，防 IPC/state 暴露明文）
      let updated = await api.setAiSettings({
        provider: values.provider,
        has_key: aiSettings?.has_key ?? false, // 占位：后端不读，真正 has_key 由下方 get/setApiKey 重读
        enabled: !!values.enabled,
      });
      // 用户输入了新 key → 单独写（key 走 keyring，明文不进 Form state/IPC 返回）
      // 留空保存 = 保留旧 key（不清除）；决策抽 decideApiKeyAction 可单测
      const { shouldSetKey, key } = decideApiKeyAction(apiKeyInput);
      if (shouldSetKey) {
        await api.setApiKey(key);
        updated = await api.getAiSettings(); // 重读最新 has_key
      }
      setAiSettings(updated);
      // 清空 key 输入（独立 state 立即清，防驻留）；provider/enabled 回填 Form
      setApiKeyInput("");
      aiForm.setFieldsValue(updated);
      message.success("AI 配置已保存");
    } catch (e) {
      // validateFields 抛 ValidationError（无 errorFields 字段时为真实异常）
      if (e && typeof e === "object" && "errorFields" in e) return;
      notifyError("保存", e);
    } finally {
      setAiSaving(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title="任务标记风格">
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Segmented
            value={markingStyle}
            onChange={(v) => setMarkingStyle(v as MarkingStyle)}
            options={[
              { label: "Helmose 标准（文字 due:/priority:）", value: "helmose" },
              { label: "Obsidian 兼容（emoji 📅⏫）", value: "obsidian" },
            ]}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            新建/编辑任务时写入 vault 的标记格式。Helmose 标准为独立文字契约（默认，对 Agent 更友好）；
            Obsidian 兼容对齐 Tasks 插件（双端互通）。存量任务不受影响（读侧三格式全兼容）。
          </Text>
          <Button size="small" loading={migrating} onClick={onMigrateDryRun} style={{ alignSelf: "flex-start" }}>
            固化存量任务（脱离收集箱）
          </Button>
        </Space>
      </Card>

      {/* 迁移预览/确认 Modal（dry-run 结果展示 + 用户授权才写盘；写盘前自动备份）*/}
      <Modal
        open={!!migratePreview}
        title="固化存量任务"
        onCancel={() => setMigratePreview(null)}
        okText={`确认固化（${migratePreview?.item_count ?? 0} 个任务）`}
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={migrating}
        onOk={onMigrateApply}
      >
        <div style={{ fontSize: 12, marginBottom: 8, color: "var(--ob-text-muted)" }}>
          将为 <b>{migratePreview?.note_count ?? 0}</b> 篇笔记的 <b>{migratePreview?.item_count ?? 0}</b> 个收集箱任务补写
          <code> priority:1 </code>标记（显式不重要），使其脱离收集箱留在四象限。
          <b>写盘前已自动备份到 .helmose/backup</b>，可在下方「备份管理」回滚。
        </div>
        <List
          size="small"
          dataSource={migratePreview?.items ?? []}
          renderItem={(it) => (
            <List.Item style={{ padding: "4px 0" }}>
              <div style={{ width: "100%", fontSize: 11 }}>
                <div style={{ color: "var(--ob-text-faint)" }}>{it.rel_path}:{it.source_line}</div>
                <div style={{ color: "var(--ob-text-faint)" }}>前：{it.before}</div>
                <div>后：{it.after}</div>
              </div>
            </List.Item>
          )}
        />
      </Modal>

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
            aiSettings ?? { provider: "claude", has_key: false, enabled: false }
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
            label={aiSettings?.has_key ? "API Key（已配置，输入新值可替换）" : "API Key"}
            tooltip="仅存本机钥匙串（keyring），不入 config.json/vault/git；为安全不再回读，留空保存=不变"
          >
            <Input.Password
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={aiSettings?.has_key ? "（已配置，留空不变）" : "sk-..."}
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
                ? (<><AppIcon name="check" size={12} color="#52c41a" /> {updateStatus.message}</>)
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
