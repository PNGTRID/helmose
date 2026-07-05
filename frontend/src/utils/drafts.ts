// 笔记草稿本地缓存（localStorage，按 noteId）：编辑中意外关闭/换 note 后重开可恢复。
// 守铁律 2：绝不写 vault 原文——这是 webview 本地缓存，非 vault「真相源」副本。
// 收口到 safeLocalStorage（B15）：统一容错（隐私模式 / 配额满 / 损坏），写失败 console.warn 降级不阻塞编辑；
// reset_app 时 clearAllDrafts 防残留。
import { safeGetItem, safeSetItem, safeRemoveItem } from "./safeLocalStorage";

const KEY_PREFIX = "helmose-draft-";

/** 读草稿；无草稿或 localStorage 不可用返回 null */
export function readDraft(noteId: string): string | null {
  return safeGetItem(KEY_PREFIX + noteId);
}

/** 写草稿（同步）；配额满/禁用 console.warn 降级，不阻塞编辑 */
export function writeDraft(noteId: string, body: string): void {
  if (!safeSetItem(KEY_PREFIX + noteId, body)) {
    console.warn("[drafts] 写入草稿失败（配额满或禁用）");
  }
}

/** 清单篇草稿（保存成功 / 用户丢弃时调用） */
export function clearDraft(noteId: string): void {
  safeRemoveItem(KEY_PREFIX + noteId);
}

/** 清所有草稿（reset_app 后调用，防 vault 正文副本残留在本地）。
 *  遍历用 localStorage.length/key（safeLocalStorage 无遍历封装）；外层 try 防御不可用环境。 */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(KEY_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => safeRemoveItem(k));
  } catch (e) {
    console.warn("[drafts] 清理所有草稿失败", e);
  }
}
