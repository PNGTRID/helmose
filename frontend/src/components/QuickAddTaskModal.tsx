// 快速添加待办弹窗：今日笔记 + 「今日待办」section 追加 bullet。
// 复用 utils/quickAdd.ts buildTaskBullet 拼装（不自拼字符串）+ createTodayNote + appendBullet。
// 字段：任务内容 TextArea(autoFocus) + 截止 DatePicker + 紧急程度 Segmented + 所属项目 Select
//   + 重复下拉（不重复/每天/每周/每月/工作日）+ 作为子任务的父任务 Select。
import "./QuickAddTaskModal.css";
import { useEffect, useState } from "react";
import { DatePicker, Modal, Segmented, Select, message } from "antd";
import type { Dayjs } from "dayjs";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { useActiveProjects } from "../hooks/useActiveProjects";
import { buildTaskBullet } from "../utils/quickAdd";
import type { Task } from "../types";

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

/**
 * 重复下拉选项（label/value）。
 * value 严格对齐后端 normalize_repeat_rule 白名单（day/week/month/Mon-Fri）。
 * 「工作日」→ Mon（工作日重复选 Mon 作为代表，indexer 工作日推进按 weekday 计算）。
 * 注：后端 normalize 不接受 "weekday"，故 value 直接映射到白名单内。
 */
const REPEAT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "不重复", value: "" },
  { label: "每天", value: "day" },
  { label: "每周", value: "week" },
  { label: "每月", value: "month" },
  { label: "工作日（周一）", value: "Mon" },
];

export default function QuickAddTaskModal({ open, onCancel, onSuccess }: Props) {
  const vault = useVaultStore((s) => s.vault);
  const { projects, loading: projectsLoading } = useActiveProjects();

  const [text, setText] = useState("");
  const [due, setDue] = useState<Dayjs | null>(null);
  const [urgency, setUrgency] = useState<"high" | "mid" | "low">("low");
  const [projectName, setProjectName] = useState<string | null>(null);
  // 重复规则（""=不重复；其余值取自 REPEAT_OPTIONS.value，对齐后端白名单）
  const [repeatRule, setRepeatRule] = useState<string>("");
  // 作为子任务时选的父任务 id（null=顶层任务）
  const [parentTaskId, setParentTaskId] = useState<string | null>(null);
  // vault 顶层未完成任务列表（父任务下拉选项）
  const [topTasks, setTopTasks] = useState<Task[]>([]);
  const [topTasksLoading, setTopTasksLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 关闭时重置表单（避免上次输入残留）
  useEffect(() => {
    if (!open) {
      setText("");
      setDue(null);
      setUrgency("low");
      setProjectName(null);
      setRepeatRule("");
      setParentTaskId(null);
    }
  }, [open]);

  // 打开时拉取 vault 顶层未完成任务（parent_task_id=null），供「作为子任务」选父。
  // watcherTick 变化时（增量索引后任务 id 可能变）也重拉，保证下拉选项是最新的。
  const watcherTick = useVaultStore((s) => s.watcherTick);
  useEffect(() => {
    if (!open || !vault) return;
    let cancelled = false;
    setTopTasksLoading(true);
    api
      .getTasks(vault.id, false, 500)
      .then((data) => {
        if (cancelled) return;
        // 仅列顶层未完成任务（parent_task_id 为 null）
        setTopTasks(data.filter((t) => t.parent_task_id == null));
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[QuickAddTaskModal] 父任务列表加载失败", e);
        setTopTasks([]);
      })
      .finally(() => {
        if (!cancelled) setTopTasksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, vault?.id, watcherTick]);

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
      // 2. 拼装 bullet（buildTaskBullet；repeat 仅在白名单内时拼 🔁 every xxx）
      const rule = repeatRule || null;
      const bullet = buildTaskBullet(t, due, urgency, projectName, null, "todo", rule);
      // 3. 作为子任务 → 前置 2 空格缩进（indexer tasks.rs indent_width>0 → 子任务，
      //    归属「今日待办」section 内最近的顶层父任务）
      const finalBullet =
        parentTaskId != null ? `  ${bullet}` : bullet;
      // 4. 追加到「今日待办」section（asTask=true → 已含 `- [ ]` 前缀）
      await api.appendBullet(nc.id, "今日待办", finalBullet, true);
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
        <div className="qa-task-row">
          <span className="qa-label">重复</span>
          <Select<string>
            value={repeatRule}
            onChange={(v) => setRepeatRule(v ?? "")}
            placeholder="不重复"
            style={{ flex: 1 }}
            options={REPEAT_OPTIONS}
          />
        </div>
        <div className="qa-task-row">
          <span className="qa-label">子任务</span>
          <Select<string>
            value={parentTaskId ?? undefined}
            onChange={(v) => setParentTaskId(v ?? null)}
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="作为顶层任务（可选父）"
            loading={topTasksLoading}
            style={{ flex: 1 }}
            options={topTasks.map((t) => ({
              value: t.id,
              label: t.text.length > 50 ? t.text.slice(0, 50) + "…" : t.text,
            }))}
            notFoundContent={topTasksLoading ? "加载中…" : "暂无顶层任务"}
          />
        </div>
      </div>
    </Modal>
  );
}
