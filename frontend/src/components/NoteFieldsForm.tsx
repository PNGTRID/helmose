// 笔记字段表单：按 note_type 渲染对应字段，改动即调 API 写回（setTag / patchFrontmatter）。
// project：状态/主线/优先级/OKR；log/experience：日期 + 心情 + 精力 + 天气 + 复盘类型 + 关联项目；其他 type：不渲染。
// 字段写入成功后 onChanged（父层 bumpTick 刷新看板）。
// 即时反馈：每个字段 useState 维护，onChange 先 setState 再异步写回；key={noteId} 时重置。
import { useState } from "react";
import { AutoComplete, DatePicker, Input, InputNumber, Rate, Select, Slider, Space, Switch } from "antd";
import { SmileOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import * as api from "../api";
import { notifyError } from "../utils/notifyError";
import { useActiveProjects } from "../hooks/useActiveProjects";
import { PROJECT_STATUS_OPTIONS } from "./projectViews/shared";

interface Props {
  noteId: string;
  noteType: string | null;
  tags: string[];
  frontmatter: Record<string, unknown>;
  /** 字段写入成功回调（父层 bumpTick + onSaved） */
  onChanged?: () => void;
}

const labelStyle: React.CSSProperties = { fontSize: 12, color: "var(--ob-text-muted)" };

/** 字段表单容器样式（项目/日志分支共用，提到模块级供子组件复用） */
const wrapStyle: React.CSSProperties = {
  marginBottom: 12,
  padding: 12,
  background: "var(--ob-bg-mod)",
  borderRadius: 6,
  borderBottom: "1px solid var(--ob-border)",
};

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
      notifyError(label, e);
    }
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
              options={PROJECT_STATUS_OPTIONS}
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
    return <LogFieldsForm
      noteId={noteId}
      tags={tags}
      frontmatter={frontmatter}
      createdRaw={createdRaw}
      onChanged={onChanged}
    />;
  }

  // 其他类型 / 无 type：不渲染字段表单
  return null;
}

/** 天气 AutoComplete 选项 */
const WEATHER_OPTIONS = ["晴", "阴", "雨", "雪", "多云"];

/** 复盘类型 Select 选项（与日志模板 reviewTemplate 入参对齐） */
const REVIEW_TYPE_OPTIONS = [
  { value: "项目", label: "项目" },
  { value: "事件", label: "事件" },
  { value: "季度", label: "季度" },
  { value: "学习", label: "学习" },
];

/** 心情图标（Rate character，原 emoji 已替换为 antd 图标） */
const MOOD_ICON = <SmileOutlined />;

/** 日志/经历笔记字段表单：日期 + 心情 + 精力 + 天气 + 复盘类型 + 关联项目。
 *  写回经 patchFrontmatter（mood/energy/weather/review_type）+ setTag（project）。
 *  拆成子组件以使用 useActiveProjects 拉项目列表，避免 NoteFieldsForm 顶层无条件触发 IPC。 */
function LogFieldsForm({
  noteId,
  tags,
  frontmatter,
  createdRaw,
  onChanged,
}: {
  noteId: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  createdRaw: string;
  onChanged?: () => void;
}) {
  const { projects, loading: projectsLoading } = useActiveProjects();
  // 心情（fm.mood，1-5；模板初始空 → undefined）
  const [mood, setMood] = useState<number | undefined>(
    typeof frontmatter.mood === "number" ? (frontmatter.mood as number) : undefined
  );
  // 精力（fm.energy，1-10）
  const [energy, setEnergy] = useState<number | undefined>(
    typeof frontmatter.energy === "number" ? (frontmatter.energy as number) : undefined
  );
  // 天气（fm.weather，字符串）
  const [weather, setWeather] = useState<string>(
    typeof frontmatter.weather === "string" ? (frontmatter.weather as string) : ""
  );
  // 复盘类型（fm.review_type，字符串）
  const [reviewType, setReviewType] = useState<string>(
    typeof frontmatter.review_type === "string" ? (frontmatter.review_type as string) : ""
  );
  // 关联项目（tags 内 project:<name> 前缀，与项目页约定一致）
  const [projectName, setProjectName] = useState<string | undefined>(
    tags.find((t) => t.startsWith("project:"))?.slice("project:".length)
  );

  const write = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      onChanged?.();
    } catch (e) {
      notifyError(label, e);
    }
  };

  return (
    <div style={wrapStyle}>
      <Space wrap size="middle">
        <Space size={4}>
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
        <Space size={4}>
          <span style={labelStyle}>心情</span>
          {/* 再次点击当前星可清零（v=0 → 清空 mood）；antd 6 Rate 默认支持点击同值归零 */}
          <Rate
            count={5}
            character={MOOD_ICON}
            value={mood ?? 0}
            onChange={(v) => {
              const n = v === 0 ? null : v;
              setMood(v === 0 ? undefined : v);
              // 写入数值；0 视为清空（写空字符串让 fm key 残留为空，与模板对齐）
              void write(
                () => api.patchFrontmatter(noteId, "mood", n ?? ""),
                "心情"
              );
            }}
            style={{ fontSize: 14 }}
          />
        </Space>
        <Space size={4}>
          <span style={labelStyle}>精力</span>
          <Slider
            min={1}
            max={10}
            value={energy ?? 0}
            onChange={(v) => setEnergy(v === 0 ? undefined : v)}
            onAfterChange={(v) => {
              const n = v === 0 ? null : v;
              void write(
                () => api.patchFrontmatter(noteId, "energy", n ?? ""),
                "精力"
              );
            }}
            style={{ width: 100, margin: 0 }}
          />
        </Space>
        <Space size={4}>
          <span style={labelStyle}>天气</span>
          <AutoComplete
            size="small"
            value={weather}
            onChange={setWeather}
            options={WEATHER_OPTIONS.map((w) => ({ value: w, label: w }))}
            placeholder="如 晴"
            style={{ width: 100 }}
            filterOption={(input, option) =>
              (option?.value ?? "").includes(input)
            }
            onBlur={() => {
              const v = weather.trim();
              void write(() => api.patchFrontmatter(noteId, "weather", v), "天气");
            }}
          />
        </Space>
        <Space size={4}>
          <span style={labelStyle}>复盘类型</span>
          <Select
            size="small"
            allowClear
            value={reviewType || undefined}
            onChange={(v) => {
              const nv = v ?? "";
              setReviewType(nv);
              void write(() => api.patchFrontmatter(noteId, "review_type", nv), "复盘类型");
            }}
            placeholder="如 项目"
            style={{ width: 110 }}
            options={REVIEW_TYPE_OPTIONS}
          />
        </Space>
        <Space size={4}>
          <span style={labelStyle}>关联项目</span>
          <Select
            size="small"
            allowClear
            showSearch
            optionFilterProp="children"
            loading={projectsLoading}
            value={projectName}
            placeholder="选择项目"
            style={{ width: 140 }}
            options={projects.map((p) => ({ value: p.name, label: p.name }))}
            onChange={(v) => {
              setProjectName(v ?? undefined);
              // setTag 前缀 'project'，value=null 清除，value=name 写入
              void write(
                () => api.setTag(noteId, "project", v ?? null),
                "关联项目"
              );
            }}
          />
        </Space>
      </Space>
    </div>
  );
}
