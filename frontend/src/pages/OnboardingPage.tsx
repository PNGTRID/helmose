import { useState } from "react";
import { Alert, Button, Card, Input, Space, Typography, message } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import { exists } from "@tauri-apps/plugin-fs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";

const { Title, Text } = Typography;

/** Onboarding：选择已有文件夹或新建 vault（Obsidian 式） */
export default function OnboardingPage() {
  const setVault = useVaultStore((s) => s.setVault);
  const index = useVaultStore((s) => s.index);
  const [path, setPath] = useState("/Users/yuanruiqin/wiki");
  const [name, setName] = useState("袁锐钦的人生Wiki");
  const [obsidian, setObsidian] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

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
      setPath(p);
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

  return (
    <div style={{ maxWidth: 560, margin: "60px auto" }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <div style={{ textAlign: "center" }}>
          <Title level={2}>⚓ 欢迎使用 Helmose</Title>
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
                  onChange={(e) => setPath(e.target.value)}
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
          </Space>
        </Card>
      </Space>
    </div>
  );
}
