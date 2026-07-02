// id 生成：crypto.randomUUID 优先，不可用时降级（非 secure context webview 边缘场景，H4）。
// 适用于 localStorage 分类 id / 乐观插入的临时任务 id 等，碰撞概率可忽略。
// 注：secure context（https / localhost / tauri 自定义协议）下 crypto.randomUUID 普遍可用，
//     降级仅为防御 tauri:// 协议边缘情况导致整页 quickAdd/分类新建崩溃。

export function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
