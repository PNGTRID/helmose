// 快速添加事件弹窗：今日笔记 + 「关键事件」section 追加 bullet。
// 字段渲染复用 EventFields（与 NewEventModal 共用，消除重复）；写回走 createTodayNote + appendBullet。
import "./QuickAddEventModal.css";
import { Modal, message } from "antd";
import { useEffect, useState } from "react";
import * as api from "../api";
import { useVaultStore } from "../stores/vault";
import { buildEventBullet } from "../utils/quickAdd";
import EventFields, { type EventFieldValue, emptyEventFields } from "./EventFields";

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess?: () => void;
}

export default function QuickAddEventModal({ open, onCancel, onSuccess }: Props) {
  const vault = useVaultStore((s) => s.vault);
  const [value, setValue] = useState<EventFieldValue>(emptyEventFields());
  const [saving, setSaving] = useState(false);

  // 关闭时重置表单（避免上次输入残留）
  useEffect(() => {
    if (!open) setValue(emptyEventFields());
  }, [open]);

  const onOk = async () => {
    if (!vault) return;
    const t = value.title.trim();
    if (!t) {
      message.warning("请输入事件标题");
      return;
    }
    if (!value.start) {
      message.warning("请选择开始时间");
      return;
    }
    setSaving(true);
    try {
      const nc = await api.createTodayNote(vault.id);
      const bullet = buildEventBullet(
        t,
        value.start,
        value.hasEnd ? value.end : null,
        value.note || null
      );
      await api.appendBullet(nc.id, "关键事件", bullet, false);
      message.success("已添加到关键事件");
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
      title="快速添加事件"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="添加"
      cancelText="取消"
      confirmLoading={saving}
      destroyOnHidden
      width={480}
    >
      <EventFields
        value={value}
        onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
      />
    </Modal>
  );
}
