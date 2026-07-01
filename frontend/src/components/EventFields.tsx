// 事件字段表单（受控）：标题 + 开始/结束时间 + 关联项目 + 备注。
// QuickAddEventModal（今日事件）与 NewEventModal（指定日事件）共用，消除字段渲染重复。
// 布局用内联 style（组件自包含，不依赖外部 CSS 类，避免两边 className 漂移）。
import { Checkbox, Input, Select, TimePicker } from "antd";
import type { Dayjs } from "dayjs";
import { useActiveProjects } from "../hooks/useActiveProjects";

export interface EventFieldValue {
  title: string;
  start: Dayjs | null;
  hasEnd: boolean;
  end: Dayjs | null;
  projectName: string | null;
  note: string;
}

/** 空值工厂（关闭重置用，避免字面量漂移） */
export const emptyEventFields = (): EventFieldValue => ({
  title: "",
  start: null,
  hasEnd: false,
  end: null,
  projectName: null,
  note: "",
});

interface Props {
  value: EventFieldValue;
  /** 局部更新（与父组件 setState 浅合并） */
  onChange: (patch: Partial<EventFieldValue>) => void;
}

/** 事件字段受控表单：标题 / 时间段 / 关联项目 / 备注 */
export default function EventFields({ value, onChange }: Props) {
  const { projects, loading } = useActiveProjects();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Input
        placeholder="事件标题（如：产品评审会）"
        value={value.title}
        onChange={(e) => onChange({ title: e.target.value })}
        autoFocus
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <TimePicker
          value={value.start}
          onChange={(v) => onChange({ start: v })}
          format="HH:mm"
          minuteStep={5}
          placeholder="开始"
          allowClear={false}
        />
        <Checkbox
          checked={value.hasEnd}
          onChange={(e) => onChange({ hasEnd: e.target.checked })}
        >
          时间段
        </Checkbox>
        {value.hasEnd && (
          <TimePicker
            value={value.end}
            onChange={(v) => onChange({ end: v })}
            format="HH:mm"
            minuteStep={5}
            placeholder="结束"
          />
        )}
      </div>
      <Select<string>
        value={value.projectName ?? undefined}
        onChange={(v) => onChange({ projectName: v ?? null })}
        allowClear
        showSearch
        optionFilterProp="children"
        placeholder="关联项目（可选）"
        loading={loading}
        options={projects.map((p) => ({ value: p.name, label: p.name }))}
      />
      <Input.TextArea
        placeholder="备注（可选）"
        value={value.note}
        onChange={(e) => onChange({ note: e.target.value })}
        rows={2}
      />
    </div>
  );
}
