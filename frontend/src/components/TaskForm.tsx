// 任务页行内参数表单（替换 TasksPage 顶部 InlineAdd）。
// 字段：任务文本 TextArea(autoFocus) + 截止 DatePicker + 优先级 Segmented + 紧急程度 Segmented + 项目 Select + 状态 Segmented。
// 提交：拼 buildTaskBullet 后追加到今日笔记「今日待办」section。
// 与 QuickAddTaskModal（Modal 形态）差异：本组件是行内展开表单（无 Modal 包裹），多 status/priority 选择。
import { useState } from "react";
import { DatePicker, Segmented, Select, Space, message, Input } from "antd";
import type { Dayjs } from "dayjs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useActiveProjects } from "../hooks/useActiveProjects";
import { buildTaskBullet } from "../utils/quickAdd";

const { TextArea } = Input;

interface Props {
  /** 提交成功后回调（父组件 refresh） */
  onSubmitted?: () => void;
}

const URGENCY_OPTIONS = [
  { label: "一般", value: "low" },
  { label: "重要", value: "mid" },
  { label: "紧急 🔥", value: "high" },
];

const PRIORITY_OPTIONS = [
  { label: "无", value: 0 },
  { label: "P3", value: 1 },
  { label: "P2", value: 2 },
  { label: "P1", value: 3 },
];

const STATUS_OPTIONS = [
  { label: "待办", value: "todo" },
  { label: "进行中", value: "doing" },
  { label: "已完成", value: "done" },
];

export default function TaskForm({ onSubmitted }: Props) {
  const vault = useVaultStore((s) => s.vault);
  const { projects, loading: projectsLoading } = useActiveProjects();

  const [text, setText] = useState("");
  const [due, setDue] = useState<Dayjs | null>(null);
  const [urgency, setUrgency] = useState<"high" | "mid" | "low">("low");
  const [priority, setPriority] = useState<number>(0);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [status, setStatus] = useState<"todo" | "doing" | "done">("todo");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!vault) return;
    const t = text.trim();
    if (!t) {
      message.warning("请输入任务内容");
      return;
    }
    setSaving(true);
    try {
      // 1. 确保今日笔记存在（已存在则复用，不覆盖）
      const nc = await api.createTodayNote(vault.id);
      // 2. 拼 bullet（buildTaskBullet 单一源，含 priority/status，与 indexer 约定同口径）
      const bullet = buildTaskBullet(t, due, urgency, projectName, priority, status);
      // 3. 追加到「今日待办」section
      await api.appendBullet(nc.id, "今日待办", bullet, true);
      message.success("已新建任务");
      // 重置表单
      setText("");
      setDue(null);
      setUrgency("low");
      setPriority(0);
      setProjectName(null);
      setStatus("todo");
      onSubmitted?.();
    } catch (e) {
      message.error(`新建失败：${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="task-form" style={{ marginBottom: 12 }}>
      <TextArea
        placeholder="新建任务（回车提交，Shift+回车换行）"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        autoSize={{ minRows: 1, maxRows: 4 }}
        disabled={saving}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        style={{ marginBottom: 8 }}
      />
      <Space size="small" wrap>
        <DatePicker
          value={due}
          onChange={setDue}
          allowClear
          placeholder="截止"
          size="small"
          style={{ width: 130 }}
        />
        <Segmented
          options={PRIORITY_OPTIONS}
          value={priority}
          onChange={(v) => setPriority(v as number)}
          size="small"
        />
        <Segmented
          options={URGENCY_OPTIONS}
          value={urgency}
          onChange={(v) => setUrgency(v as "high" | "mid" | "low")}
          size="small"
        />
        <Segmented
          options={STATUS_OPTIONS}
          value={status}
          onChange={(v) => setStatus(v as "todo" | "doing" | "done")}
          size="small"
        />
        <Select<string>
          value={projectName ?? undefined}
          onChange={(v) => setProjectName(v ?? null)}
          allowClear
          showSearch
          optionFilterProp="children"
          placeholder="项目"
          size="small"
          loading={projectsLoading}
          style={{ width: 160 }}
          options={projects.map((p) => ({
            value: p.name,
            label: p.name + (p.is_mainline ? " · 主线" : ""),
          }))}
        />
      </Space>
    </div>
  );
}
