// 日历新建事件弹窗：复用 EventFields（字段同 QuickAddEventModal）+ 多一个 DatePicker（默认选中日）。
// 写回流：调用方注入 ensureNote(date) → 返回 note_id → appendBullet 到「关键事件」section。
// 设计：ensureDayNote（CalendarPage 内部，依赖 byRelPath 缓存）由父层注入，零重造。
import "./NewEventModal.css";
import { DatePicker, Modal, message } from "antd";
import { useEffect, useState } from "react";
import type { Dayjs } from "dayjs";
import * as api from "../api";
import { notifyError } from "../utils/notifyError";
import { buildEventBullet } from "../utils/quickAdd";
import EventFields, { type EventFieldValue, emptyEventFields } from "./EventFields";

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess?: () => void;
  /** 默认选中日期（日历点击某格触发时传入） */
  defaultDate?: Dayjs;
  /** 由日历页注入：确保某日日志存在（有则复用，无则建），返回 note_id */
  ensureNote?: (date: Dayjs) => Promise<string>;
}

export default function NewEventModal({
  open,
  onCancel,
  onSuccess,
  defaultDate,
  ensureNote,
}: Props) {
  const [date, setDate] = useState<Dayjs | null>(defaultDate ?? null);
  const [value, setValue] = useState<EventFieldValue>(emptyEventFields());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(defaultDate ?? null);
      setValue(emptyEventFields());
    }
  }, [open, defaultDate]);

  const onOk = async () => {
    if (!date) {
      message.warning("请选择日期");
      return;
    }
    const t = value.title.trim();
    if (!t) {
      message.warning("请输入事件标题");
      return;
    }
    if (!value.start) {
      message.warning("请选择开始时间");
      return;
    }
    if (!ensureNote) {
      message.error("缺少 ensureNote 注入（日历页未连接）");
      return;
    }
    setSaving(true);
    try {
      const id = await ensureNote(date);
      const bullet = buildEventBullet(
        t,
        value.start,
        value.hasEnd ? value.end : null,
        value.note || null
      );
      await api.appendBullet(id, "关键事件", bullet, false);
      message.success("已新建事件");
      onSuccess?.();
      onCancel();
    } catch (e) {
      notifyError("添加", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="新建事件"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="添加"
      cancelText="取消"
      confirmLoading={saving}
      destroyOnHidden
      width={480}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--ob-text-muted)" }}>日期</span>
          <DatePicker
            value={date}
            onChange={setDate}
            allowClear={false}
            style={{ width: 160 }}
          />
        </div>
        <EventFields
          value={value}
          onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
        />
      </div>
    </Modal>
  );
}
