// 快速添加待办弹窗：今日笔记 + 「今日待办」section 追加 bullet。
// 复用 utils/quickAdd.ts buildTaskBullet 拼装（不自拼字符串）+ createTodayNote + appendBullet。
// 字段：任务内容 TextArea(autoFocus) + 截止 DatePicker + 紧急程度 Segmented + 所属项目 Select。
import "./QuickAddTaskModal.css";
import { useEffect, useState } from "react";
import { DatePicker, Modal, Segmented, Select, message } from "antd";
import type { Dayjs } from "dayjs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useActiveProjects } from "../hooks/useActiveProjects";
import { buildTaskBullet } from "../utils/quickAdd";

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess?: () => void;
}

const URGENCY_OPTIONS = [
  { label: "紧急 🔥", value: "high" },
  { label: "重要", value: "mid" },
  { label: "一般", value: "low" },
];

export default function QuickAddTaskModal({ open, onCancel, onSuccess }: Props) {
  const vault = useVaultStore((s) => s.vault);
  const { projects, loading: projectsLoading } = useActiveProjects();

  const [text, setText] = useState("");
  const [due, setDue] = useState<Dayjs | null>(null);
  const [urgency, setUrgency] = useState<"high" | "mid" | "low">("low");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 关闭时重置表单（避免上次输入残留）
  useEffect(() => {
    if (!open) {
      setText("");
      setDue(null);
      setUrgency("low");
      setProjectName(null);
    }
  }, [open]);

  const onOk = async () => {
    if (!vault) return;
    const t = text.trim();
    if (!t) {
      message.warning("请输入任务内容");
      return;
    }
    setSaving(true);
    try {
      // 1. 确保「今日笔记」存在（已存在则返回，不覆盖）
      const nc = await api.createTodayNote(vault.id);
      // 2. 追加 bullet 到「今日待办」section（asTask=true → `- [ ]`）
      const bullet = buildTaskBullet(t, due, urgency, projectName);
      await api.appendBullet(nc.id, "今日待办", bullet, true);
      message.success("已添加到今日待办");
      onSuccess?.();
      onCancel();
    } catch (e) {
      message.error(`添加失败：${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="快速添加待办"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="添加"
      cancelText="取消"
      confirmLoading={saving}
      destroyOnHidden
      width={480}
    >
      <div className="qa-task-form">
        <textarea
          className="qa-task-text"
          placeholder="今天要做什么？（回车添加，Shift+回车换行）"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onOk();
            }
          }}
        />
        <div className="qa-task-row">
          <span className="qa-label">截止</span>
          <DatePicker
            value={due}
            onChange={setDue}
            allowClear
            placeholder="无"
            style={{ width: 160 }}
          />
          <span className="qa-label">紧急</span>
          <Segmented
            options={URGENCY_OPTIONS}
            value={urgency}
            onChange={(v) => setUrgency(v as "high" | "mid" | "low")}
          />
        </div>
        <div className="qa-task-row">
          <span className="qa-label">项目</span>
          <Select<string>
            value={projectName ?? undefined}
            onChange={(v) => setProjectName(v ?? null)}
            allowClear
            showSearch
            optionFilterProp="children"
            placeholder="关联项目（可选）"
            loading={projectsLoading}
            style={{ flex: 1 }}
            options={projects.map((p) => ({
              value: p.name,
              label: p.name + (p.is_mainline ? " · 主线" : ""),
            }))}
          />
        </div>
      </div>
    </Modal>
  );
}
