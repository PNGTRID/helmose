// ============================================================
// 聚合 LLM 调用辅助 —— 输入预算 + 超时控制
//
// - complete_with_budget：在调用前对 user 输入硬截断到 USER_INPUT_BUDGET，
//   再委派给具体 provider（dyn AiClient）。聚合摘要天然小，触发截断属异常。
// - 超时由 provider 内 reqwest 的 .timeout() 控制（30s，超时返回 AiError::Network）。
// ============================================================

use super::{AiClient, AiError, USER_INPUT_BUDGET};

/// 带 token 预算截断的调用包装。上层 ai_mainline/ai_coach/ai_tomorrow 统一经此。
///
/// 注：4k 字符 ≈ 1-2k token（中文偏密），多数聚合摘要远低于此。
/// 真正的 token 预算控制（按 tokenizer 精算）属未来优化项，本期用字符上限近似。
///
/// 审查 #9：AI 调用原本只在失败时 warn，成功路径无日志 = 黑盒。这里统一记
/// user 字符数 / 是否截断 / 耗时 / 响应字符数（成功）或错误（失败），便于排查"为什么这次建议差"。
pub async fn complete_with_budget(
    client: &dyn AiClient,
    system: &str,
    user: &str,
) -> Result<String, AiError> {
    let budgeted = truncate_user_input(user);
    let was_truncated = user.chars().count() > USER_INPUT_BUDGET;
    let user_chars = user.chars().count();
    let started = std::time::Instant::now();
    let result = client.complete(system, &budgeted).await;
    let elapsed_ms = started.elapsed().as_millis();
    match &result {
        Ok(text) => tracing::info!(
            user_chars,
            truncated = was_truncated,
            elapsed_ms,
            resp_chars = text.chars().count(),
            "AI 调用成功"
        ),
        Err(e) => tracing::warn!(
            user_chars,
            truncated = was_truncated,
            elapsed_ms,
            err = %e,
            "AI 调用失败"
        ),
    }
    result
}

/// 截断 user 输入到预算字符数（按字符边界，UTF-8 安全——Rust String 按字节，
/// 此处用 chars().take() 保证不切坏多字节字符）。
fn truncate_user_input(user: &str) -> String {
    if user.chars().count() <= USER_INPUT_BUDGET {
        return user.to_string();
    }
    let mut s: String = user.chars().take(USER_INPUT_BUDGET).collect();
    s.push_str("…(已截断)");
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;

    /// 假 client：原样返回 user，用于测截断逻辑
    struct EchoClient;
    #[async_trait]
    impl AiClient for EchoClient {
        async fn complete(&self, _system: &str, user: &str) -> Result<String, AiError> {
            Ok(user.to_string())
        }
    }

    #[tokio::test]
    async fn 小输入不截断() {
        let out = complete_with_budget(&EchoClient, "sys", "短").await.unwrap();
        assert_eq!(out, "短");
    }

    #[tokio::test]
    async fn 超预算截断并加尾标记() {
        // 构造 5000 字符的输入
        let big = "a".repeat(5000);
        let out = complete_with_budget(&EchoClient, "sys", &big).await.unwrap();
        assert!(out.ends_with("…(已截断)"), "应以截断标记结尾");
        // 字符数 = 预算 + 标记长度
        assert_eq!(
            out.chars().count(),
            USER_INPUT_BUDGET + "…(已截断)".chars().count()
        );
    }
}
