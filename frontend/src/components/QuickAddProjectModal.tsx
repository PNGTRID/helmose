// 快速创建项目弹窗：拼装 frontmatter + 模板正文 → createNote（零新命令）。
// 字段：项目名 + 模板 Select + 状态 Select（复用 STATUS_OPTIONS）+ 优先级 Segmented P0-P3
//      + 主线 Switch + OKR Input + 负责人 Input + 父目录 Select（默认 01_企业与项目资产）。
import "./QuickAddProjectModal.css";
import { Input, Modal, Segmented, Select, Switch, message } from "antd";
import { useEffect, useState } from "react";
import * as api from "../api";
import { notifyError } from "../utils/notifyError";
import { useVaultStore } from "../stores/vault";
import {
  buildProjectFrontmatter,
  slugify,
} from "../utils/quickAdd";
import {
  PROJECT_TEMPLATE_OPTIONS,
  projectTemplateBody,
  type ProjectTemplate,
} from "../utils/projectTemplates";
import { PROJECT_STATUS_OPTIONS } from "./projectViews/shared";

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess?: (noteId?: string) => void;
}

const PRIORITY_OPTIONS = [
  { label: "P0", value: "P0" },
  { label: "P1", value: "P1" },
  { label: "P2", value: "P2" },
  { label: "P3", value: "P3" },
];

const PARENT_DIRS = [
  { value: "01_企业与项目资产", label: "01_企业与项目资产" },
  { value: "00_收件箱", label: "00_收件箱" },
];

export default function QuickAddProjectModal({ open, onCancel, onSuccess }: Props) {
  const vault = useVaultStore((s) => s.vault);

  const [name, setName] = useState("");
  const [template, setTemplate] = useState<ProjectTemplate>("blank");
  const [status, setStatus] = useState<string>("active");
  const [priority, setPriority] = useState<"P0" | "P1" | "P2" | "P3">("P2");
  const [mainline, setMainline] = useState(false);
  const [okr, setOkr] = useState("");
  const [owner, setOwner] = useState("");
  const [parentDir, setParentDir] = useState("01_企业与项目资产");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setTemplate("blank");
      setStatus("active");
      setPriority("P2");
      setMainline(false);
      setOkr("");
      setOwner("");
      setParentDir("01_企业与项目资产");
    }
  }, [open]);

  const onOk = async () => {
    if (!vault) return;
    const n = name.trim();
    if (!n) {
      message.warning("请输入项目名");
      return;
    }
    const slug = slugify(n);
    if (!slug) {
      message.warning("项目名无效（不能全为特殊字符）");
      return;
    }
    setSaving(true);
    try {
      const body = projectTemplateBody(template, n);
      const content = buildProjectFrontmatter(
        n,
        status,
        priority,
        mainline,
        okr || null,
        owner || null,
        body
      );
      const relPath = `${parentDir}/${slug}.md`;
      const nc = await api.createNote(vault.id, relPath, content);
      message.success(`已创建：${relPath}`);
      // 触发增量索引刷新面板（createNote 内部已增量索引，但 watcherTick 由各组件自订阅）
      await useVaultStore.getState().index();
      onSuccess?.(nc.id);
      onCancel();
    } catch (e) {
      notifyError("创建", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="快速创建项目"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="创建"
      cancelText="取消"
      confirmLoading={saving}
      destroyOnHidden
      width={560}
    >
      <div className="qa-project-form">
        <div className="qa-project-row">
          <span className="qa-label">项目名</span>
          <Input
            placeholder="如：Helmose v0.2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            style={{ flex: 1 }}
          />
        </div>

        <div className="qa-project-row">
          <span className="qa-label">模板</span>
          <Select<ProjectTemplate>
            value={template}
            onChange={setTemplate}
            style={{ flex: 1 }}
            options={PROJECT_TEMPLATE_OPTIONS.map((o) => ({
              value: o.value,
              label: `${o.label} · ${o.desc}`,
            }))}
          />
        </div>

        <div className="qa-project-row">
          <span className="qa-label">状态</span>
          <Select
            value={status}
            onChange={setStatus}
            style={{ width: 140 }}
            options={PROJECT_STATUS_OPTIONS}
          />
          <span className="qa-label">优先级</span>
          <Segmented
            options={PRIORITY_OPTIONS}
            value={priority}
            onChange={(v) => setPriority(v as "P0" | "P1" | "P2" | "P3")}
          />
          <span className="qa-label">主线</span>
          <Switch checked={mainline} onChange={setMainline} />
        </div>

        <div className="qa-project-row">
          <span className="qa-label">OKR</span>
          <Input
            placeholder="如 Q2 目标"
            value={okr}
            onChange={(e) => setOkr(e.target.value)}
            style={{ flex: 1 }}
          />
          <span className="qa-label">负责人</span>
          <Input
            placeholder="姓名"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            style={{ width: 140 }}
          />
        </div>

        <div className="qa-project-row">
          <span className="qa-label">父目录</span>
          <Select
            value={parentDir}
            onChange={setParentDir}
            style={{ flex: 1 }}
            options={PARENT_DIRS}
          />
        </div>
      </div>
    </Modal>
  );
}
