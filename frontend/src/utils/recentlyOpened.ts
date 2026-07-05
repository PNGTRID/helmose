// 最近打开笔记列表（localStorage，纯前端，跨会话保留）。
// FilePanel 顶部「最近打开」区消费，让用户快速回到刚才看过的笔记。
// 容量 10，去重（同 id 只保留最新），无副作用——note id 漂移由消费方按 id 再 resolve。
// 收口到 safeLocalStorage（B15）：损坏 JSON / 隐私模式自动回落空数组，无需手写 try/catch。
import { safeReadJSON, safeSetItem } from "./safeLocalStorage";

const KEY = "helmose-recently-opened";
const MAX = 10;

export interface RecentNote {
  id: string;
  title: string;
  rel_path: string;
  file_name: string;
}

export function getRecent(): RecentNote[] {
  return safeReadJSON<RecentNote[]>(KEY, []);
}

export function pushRecent(n: RecentNote): void {
  const cur = getRecent().filter((r) => r.id !== n.id);
  cur.unshift(n);
  safeSetItem(KEY, JSON.stringify(cur.slice(0, MAX)));
}
