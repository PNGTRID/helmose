// 日历页：antd <Calendar>，每个日期单元格标注当天笔记数，点击日期 → 右侧列出当天笔记
// 复用 useAllNotesMeta（共享全量元数据 hook）+ openNoteFromMeta（开笔记 tab）
import { useMemo, useState } from "react";
import { Alert, Badge, Calendar, Empty, List, Spin, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { useVaultStore } from "../stores/vault";
import { useAllNotesMeta } from "../hooks/useAllNotesMeta";
import { dateKey } from "../utils/date";
import { openNoteFromMeta } from "../utils/note";
import type { NoteMeta } from "../types";

const { Text } = Typography;

export default function CalendarPage() {
  const vault = useVaultStore((s) => s.vault);
  const { notes, loading, error } = useAllNotesMeta();
  const [selected, setSelected] = useState<Dayjs | null>(null);

  // 按 date_iso 聚合：YYYY-MM-DD → 当天笔记列表（无有效日期的笔记不进日历）
  const byDate = useMemo(() => {
    const m = new Map<string, NoteMeta[]>();
    for (const n of notes) {
      const k = dateKey(n.date_iso);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    }
    return m;
  }, [notes]);

  const selectedKey = selected ? selected.format("YYYY-MM-DD") : null;
  const selectedNotes = selectedKey ? byDate.get(selectedKey) ?? [] : [];

  // 所有 hook 已调用，可早返回（与 ProjectsPage 一致）
  if (!vault) return null;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: "var(--ob-bg-mod)",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <Text strong style={{ fontSize: 16 }}>
            日历
          </Text>
          <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
            {byDate.size} 个日期有笔记 · 点击日期查看当天笔记
          </Text>
        </div>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin />
          </div>
        ) : error ? (
          <Alert type="error" showIcon message="笔记加载失败" description={error} />
        ) : (
          <Calendar
            cellRender={(date, info) => {
              // 仅月视图日期单元格标注当天笔记数；年视图月份单元格保留默认渲染
              if (info.type !== "date") return info.originNode;
              const list = byDate.get(date.format("YYYY-MM-DD"));
              if (!list || list.length === 0) return null;
              return (
                <div style={{ textAlign: "center" }}>
                  <Badge count={list.length} style={{ backgroundColor: "#7C3AED" }} />
                </div>
              );
            }}
            onSelect={(date, info) => {
              // 仅点击日期单元格才选中（切换月份/年份不改变选中态）
              if (info.source === "date") setSelected(date);
            }}
          />
        )}
      </div>
      <div
        style={{
          width: 300,
          flexShrink: 0,
          background: "var(--ob-bg-mod)",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <Text strong style={{ display: "block", marginBottom: 8 }}>
          {selected
            ? `${selected.format("YYYY-MM-DD")} · ${selectedNotes.length} 篇`
            : "选中日期的笔记"}
        </Text>
        {selectedNotes.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={selected ? "当天无笔记" : "点击日历上的日期"}
          />
        ) : (
          <List
            size="small"
            dataSource={selectedNotes}
            renderItem={(n) => (
              <List.Item
                style={{ cursor: "pointer", padding: "6px 2px" }}
                onClick={() => openNoteFromMeta(n)}
              >
                <List.Item.Meta
                  title={
                    <Text ellipsis style={{ maxWidth: 240 }}>
                      {n.title ?? n.file_name}
                    </Text>
                  }
                  description={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {n.rel_path}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  );
}
