// 日期域纯函数：date_iso 归一化（从 CalendarPage 迁入，签名/返回值不变）
import dayjs from "dayjs";

/** 把任意 date_iso 归一化为 "YYYY-MM-DD"（无效/空返回 null，跳过该笔记） */
export function dateKey(s: string | null): string | null {
  if (!s) return null;
  const d = dayjs(s);
  return d.isValid() ? d.format("YYYY-MM-DD") : null;
}
