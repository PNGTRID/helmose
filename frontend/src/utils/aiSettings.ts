// AI 配置 key 决策（B4 keychain 解耦）：
// SettingsPage.saveAiSettings 用此决定是否调 setApiKey——
//   「输入新 key → 换 key」「留空保存 → 保留旧 key（不清除）」。
// 抽成纯函数可单测，守「留空保存不清 key」契约防回退（用户已配 key 留空保存应保留，非清除）。

export interface KeySaveDecision {
  /** true = 应调 api.setApiKey(key) 写入新 key；false = 留空保存，保留旧 key */
  shouldSetKey: boolean;
  /** trim 后的 key（shouldSetKey=true 时有效） */
  key: string;
}

/**
 * 决定保存 AI 配置时是否写新 key。
 * - 非空输入（trim 后）→ shouldSetKey=true，写 keyring
 * - 空 / undefined / null / 纯空白 → shouldSetKey=false，保留旧 key（不清除）
 */
export function decideApiKeyAction(
  inputKey: string | undefined | null,
): KeySaveDecision {
  const key = (inputKey ?? "").trim();
  return { shouldSetKey: key.length > 0, key };
}
