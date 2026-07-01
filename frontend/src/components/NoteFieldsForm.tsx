// 笔记字段表单：按 note_type 渲染对应字段，改动即调 API 写回（setTag / patchFrontmatter）。
// project：状态/主线/优先级/OKR；log/experience：日期；其他 type：不渲染。
// 字段写入成功后 onChanged（父层 bumpTick 刷新看板）。
// 即时反馈：每个字段 useState 维护，onChange 先 setState 再异步写回；key={noteId} 时重置。
import { useState } from "react";
import { DatePicker, Input, InputNumber, Select, Space, Switch, message } from "antd";
import dayjs from "dayjs";
import * as api from "../api";

interface Props {
  noteId: string;
  noteType: string | null;
  tags: string[];
  frontmatter: Record<string, unknown>;
  /** 字段写入成功回调（父层 bumpTick + onSaved） */
  onChanged?: () => void;
}

const STATUS_OPTIONS = [
  { value: "active", label: "进行中" },
  { value: "pending", label: "筹备中" },
  { value: "paused", label: "暂停" },
  { value: "completed", label: "已完成" },
  { value: "abandoned", label: "已放弃" },
];

const labelStyle: React.CSSProperties = { fontSize: 12, color: "var(--ob-text-muted)" };

export default function NoteFieldsForm({ noteId, noteType, tags, frontmatter, onChanged }: Props) {
  // —— 项目字段（init from tags / frontmatter）——
  const [status, setStatus] = useState<string | undefined>(
    tags.find((t) => t.startsWith("project-status:"))?.split(":")[1]
  );
  const [mainline, setMainline] = useState<boolean>(
    frontmatter.mainline === true || tags.some((t) => t.toLowerCase() === "mainline")
  );
  const [priority, setPriority] = useState<number | null>(
    typeof frontmatter.priority === "number" ? (frontmatter.priority as number) : null
  );
  const [okr, setOkr] = useState<string>(
    typeof frontmatter.okr === "string" ? (frontmatter.okr as string) : ""
  );
  const createdRaw =
    typeof frontmatter.created === "string" ? (frontmatter.created as string) : "";

  // 统一写回：API → onChanged 刷新；失败 message
  const write = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      onChanged?.();
    } catch (e) {
      message.error(`${label}失败：${e}`);
    }
  };

  const wrapStyle: React.CSSProperties = {
    marginBottom: 12,
    padding: 12,
    background: "var(--ob-bg-mod)",
    borderRadius: 6,
    borderBottom: "1px solid var(--ob-border)",
  };

  if (noteType === "project") {
    return (
      <div style={wrapStyle}>
        <Space wrap size="middle">
          <Space size={4}>
            <span style={labelStyle}>状态</span>
            <Select
              size="small"
              value={status}
              placeholder="选择"
              style={{ width: 100 }}
              options={STATUS_OPTIONS}
              onChange={(v) => {
                setStatus(v);
                void write(() => api.setTag(noteId, "project-status", v), "状态");
              }}
            />
          </Space>
          <Space size={4}>
            <span style={labelStyle}>主线</span>
            <Switch
              size="small"
              checked={mainline}
              onChange={(on) => {
                setMainline(on);
                void write(
                  () => api.setTag(noteId, "mainline", on ? "mainline" : null),
                  "主线"
                );
              }}
            />
          </Space>
          <Space size={4}>
            <span style={labelStyle}>优先级</span>
            <InputNumber
              size="small"
              value={priority ?? undefined}
              placeholder="—"
              style={{ width: 64 }}
              onChange={(v) => {
                const n = v ?? null;
                setPriority(n);
                if (n != null) void write(() => api.patchFrontmatter(noteId, "priority", n), "优先级");
              }}
            />
          </Space>
          <Space size={4}>
            <span style={labelStyle}>OKR</span>
            <Input
              size="small"
              placeholder="如 Q2 / goal"
              style={{ width: 120 }}
              value={okr}
              onChange={(e) => setOkr(e.target.value)}
              onPressEnter={() => void write(() => api.patchFrontmatter(noteId, "okr", okr), "OKR")}
              onBlur={() => okr && void write(() => api.patchFrontmatter(noteId, "okr", okr), "OKR")}
            />
          </Space>
        </Space>
      </div>
    );
  }

  if (noteType === "log" || noteType === "experience") {
    return (
      <div style={wrapStyle}>
        <Space size="middle">
          <span style={labelStyle}>日期</span>
          <DatePicker
            size="small"
            allowClear={false}
            value={createdRaw ? dayjs(createdRaw) : undefined}
            onChange={(d) => {
              if (d) void write(() => api.patchFrontmatter(noteId, "created", d.format("YYYY-MM-DD")), "日期");
            }}
          />
        </Space>
      </div>
    );
  }

  // 其他类型 / 无 type：不渲染字段表单
  return null;
}
