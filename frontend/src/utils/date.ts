// 日期域纯函数：date_iso 归一化 + 相对时间（从 CalendarPage 迁入并扩展）
import dayjs from "dayjs";
import dayjsRelativeTime from "dayjs/plugin/relativeTime";
// 注册中文 locale（side-effect import，不设为全局默认；按实例 .locale('zh-cn') 取用）
import "dayjs/locale/zh-cn";

dayjs.extend(dayjsRelativeTime);

/** 把任意 date_iso 归一化为 "YYYY-MM-DD"（无效/空返回 null，跳过该笔记） */
export function dateKey(s: string | null): string | null {
  if (!s) return null;
  const d = dayjs(s);
  return d.isValid() ? d.format("YYYY-MM-DD") : null;
}

/** 相对时间（中文「3 天前 / 2 小时前」）。空/无效返回空串。 */
export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const d = dayjs(iso);
  return d.isValid() ? d.locale("zh-cn").fromNow() : "";
}
