// providers 子模块：具体 LLM 后端实现（trait AiClient）
pub mod claude;
pub mod openai;

use reqwest::Client;
use std::time::Duration;

/// 构造 LLM HTTP client（统一 30s timeout）。
/// 审查 #5：原各 provider 用 `.unwrap_or_else(|_| Client::new())` 兜底——失败时回退的裸
/// `Client::new()` **无 timeout**，会打破「30s 防 LLM 慢拖死前端」红线且无日志。此处统一：
/// builder 失败 → log 后二次尝试（仍带 timeout）；二次仍失败说明系统 TLS 不可用，直接 panic
/// （AI 本就无法工作，启动期暴露好过运行时静默丢 timeout）。
pub fn build_http_client(tag: &str) -> Client {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|e| {
            tracing::error!("{} reqwest builder 失败，二次尝试: {}", tag, e);
            Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("reqwest client 必须可构造（系统 TLS 后端不可用时 AI 无法工作）")
        })
}
