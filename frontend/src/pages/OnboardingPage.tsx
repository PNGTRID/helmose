import { useState } from "react";
import { Alert, Button, Card, Input, Space, Typography, message } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import AppIcon from "../components/AppIcon";
import { exists } from "@tauri-apps/plugin-fs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";

const { Title, Text } = Typography;

/** Onboarding：选择已有文件夹或新建 vault（Obsidian 式） */
export default function OnboardingPage() {
  const setVault = useVaultStore((s) => s.setVault);
  const index = useVaultStore((s) => s.index);
  // 路径/名称记忆上次输入（localStorage），减少重复输入
  const [path, setPath] = useState(
    () => {
      try {
        return localStorage.getItem("helmose-last-path") || "/Users/yuanruiqin/wiki";
      } catch {
        return "/Users/yuanruiqin/wiki";
      }
    }
  );
  const [name, setName] = useState("袁锐钦的人生Wiki");
  const [obsidian, setObsidian] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const rememberPath = (p: string) => {
    setPath(p);
    try {
      localStorage.setItem("helmose-last-path", p);
    } catch {
      /* ignore */
    }
  };

  const detectObsidian = async (p: string) => {
    try {
      setObsidian(await exists(`${p}/.obsidian`));
    } catch {
      setObsidian(null);
    }
  };

  const pick = async () => {
    const p = await api.pickFolder(path);
    if (p) {
      rememberPath(p);
      await detectObsidian(p);
    }
  };

  const confirm = async () => {
    if (!path.trim()) {
      message.warning("请选择或输入 vault 文件夹路径");
      return;
    }
    setBusy(true);
    try {
      const v = await api.addVault({
        name: name.trim() || "vault",
        root_path: path.trim(),
        is_obsidian_shared: !!obsidian,
      });
      setVault(v);
      message.success("已添加 vault，开始索引…");
      await index();
    } catch (e) {
      message.error(`添加失败：${e}`);
    } finally {
      setBusy(false);
    }
  };

  // 新建知识库：选空目录 → 脚手架生成骨架 → 添加 vault → 索引
  const createNew = async () => {
    const p = await api.pickFolder();
    if (!p) return;
    setBusy(true);
    let scaffolded = false;
    try {
      const stats = await api.scaffoldVault(p);
      scaffolded = true;
      message.success(
        `已生成骨架：${stats.dirs_created} 目录 + ${stats.templates_created} 模板，开始索引…`
      );
      const v = await api.addVault({
        name: name.trim() || "我的知识库",
        root_path: p,
        is_obsidian_shared: false,
      });
      setVault(v);
      await index();
    } catch (e) {
      // scaffold 成功但 addVault/index 失败：目录已铺文件，重试会被「已有 vault」拒绝。
      // 引导用户改用「添加并索引」打开该目录，避免卡死。
      message.error(
        scaffolded
          ? `骨架已生成但后续步骤失败（${e}）。请改用上方「添加并索引」打开该目录`
          : `创建失败：${e}`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 560, margin: "60px auto" }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <div style={{ textAlign: "center" }}>
          <Title level={2}><AppIcon name="anchor" size={28} /> 欢迎使用 Helmose</Title>
          <Text type="secondary">选择你的笔记文件夹（vault），把人生整理成清晰的舵盘</Text>
        </div>

        <Card>
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <div>
              <Text strong>vault 文件夹路径</Text>
              <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                <Input
                  style={{ width: "calc(100% - 110px)" }}
                  value={path}
                  onChange={(e) => rememberPath(e.target.value)}
                  placeholder="如 /Users/yuanruiqin/wiki"
                />
                <Button icon={<FolderOpenOutlined />} onClick={pick} style={{ width: 110 }}>
                  选择…
                </Button>
              </Space.Compact>
            </div>

            <div>
              <Text strong>名称</Text>
              <Input
                style={{ marginTop: 4 }}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="给这个 vault 起个名"
              />
            </div>

            {obsidian && (
              <Alert
                type="info"
                showIcon
                message="检测到 Obsidian vault"
                description="Helmose 将与 Obsidian 共享同一目录，绝不修改 .obsidian 配置。"
              />
            )}

            <Button type="primary" block size="large" loading={busy} onClick={confirm}>
              添加并索引
            </Button>

            <Button block size="large" loading={busy} onClick={createNew}>
              <AppIcon name="plus" size={14} /> 新建知识库（生成 00~09 骨架）
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              选一个空文件夹，Helmose 按规范生成目录骨架与模板；已有 vault 请用上方「添加并索引」。
            </Text>
          </Space>
        </Card>
      </Space>
    </div>
  );
}
