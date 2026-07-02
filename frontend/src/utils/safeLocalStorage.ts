// localStorage 安全访问：统一容错（隐私模式 / 跨域 iframe / 禁用 cookies / 容量超限 / 损坏 JSON / 脏值）。
// 所有 store 的 localStorage 读写都应走此模块，替代散落的 try/catch + typeof 检查，避免静默失败与首屏白屏（S3）。

/** 安全读 string。不可用 / 不存在 → null（绝不抛）。 */
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 安全写 string。失败（隐私模式 / 容量超限）→ false，调用方可按需上报告警。 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** 安全删（幂等，失败静默）。 */
export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 安全读 + JSON.parse。损坏 / 不可用 / 非数组非对象 → fallback。 */
export function safeReadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 白名单校验读取：值在 allowed 内 → 返回；否则清掉脏值返回 fallback。
 * 用于枚举型配置（如 marking style），防 DevTools 篡改或旧版本残留导致脏值长期残留。
 */
export function safeReadWhitelist<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  try {
    const s = localStorage.getItem(key);
    if (s && (allowed as readonly string[]).includes(s)) return s as T;
    // 脏值清理（旧版本残留或手动篡改），不留困惑
    if (s) localStorage.removeItem(key);
  } catch {
    /* 隐私模式 / iframe → 静默回落 fallback */
  }
  return fallback;
}
