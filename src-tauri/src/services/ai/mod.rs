// ============================================================
// AI 抽象层（M4）—— 可替换 LLM provider，业务命令只依赖 trait
//
// 设计要点（设计文档 M4.1 + 错误处理 2/3）：
//   1. AiClient trait：provider 切换零业务改动（Claude/OpenAI/未来 Ollama 本地）
//   2. build_client：未配 key → None → 上层走本地启发式降级链
//   3. AI 调用失败（超时/网络/key 无效）→ 返回 AiError，绝不 panic
//   4. 数据最小化：trait 只接收聚合摘要字符串（system+user），不接 vault 原文；
//      user 输入硬上限 4k 字符（超则截断），聚合状态天然小不会超。
//   5. 超时 30s（防 LLM 慢拖死前端）
// ============================================================

pub mod client;
pub mod providers;

use crate::models::AiSettings;

pub use client::complete_with_budget;

/// 统一异步 LLM 调用接口（Dyn-safe）。
/// - system：系统指令（角色 + 任务定义）
/// - user：用户输入（聚合摘要字符串；调用方负责只传摘要不发 vault 原文）
#[async_trait::async_trait]
pub trait AiClient: Send + Sync {
    async fn complete(&self, system: &str, user: &str) -> Result<String, AiError>;
}

/// AI 调用错误（业务层捕获后走降级链，不 panic）。
#[derive(Debug, Clone, thiserror::Error)]
pub enum AiError {
    /// 网络 / 超时（30s）
    #[error("网络或超时: {0}")]
    Network(String),
    /// HTTP 非 2xx（含 key 无效 401 / 限流 429）
    #[error("HTTP {status}: {body}")]
    HttpStatus { status: u16, body: String },
    /// 响应解析失败（JSON 结构异常 / 字段缺失）
    #[error("解析失败: {0}")]
    Parse(String),
}

impl From<reqwest::Error> for AiError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            AiError::Network(format!("超时: {}", e))
        } else if e.is_connect() {
            AiError::Network(format!("连接失败: {}", e))
        } else {
            AiError::Network(e.to_string())
        }
    }
}

/// 按 provider + key 构造客户端。key 空 / 未知 provider → None（上层走降级链）。
///
/// 决策：用 `Box<dyn AiClient>` 而非泛型——命令层在 async fn 内动态构造，
/// 泛型会污染整条调用链签名（每层都得带 <C: AiClient>），dyn 更易切换。
pub fn build_client(settings: &AiSettings) -> Option<Box<dyn AiClient>> {
    if !settings.enabled || settings.api_key.trim().is_empty() {
        return None;
    }
    match settings.provider.as_str() {
        "claude" => Some(Box::new(providers::claude::ClaudeClient::new(
            settings.api_key.clone(),
        ))),
        "openai" => Some(Box::new(providers::openai::OpenAiClient::new(
            settings.api_key.clone(),
        ))),
        _ => None, // 未知 provider（含未来本地 Ollama 占位）
    }
}

/// 截断 user 输入到 4k 字符（硬上限，防超大输入超 token 预算）。
/// 聚合状态摘要天然小，触发此截断属于异常输入（debug 用）。
pub const USER_INPUT_BUDGET: usize = 4000;

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(provider: &str, key: &str, enabled: bool) -> AiSettings {
        AiSettings {
            provider: provider.to_string(),
            api_key: key.to_string(),
            enabled,
        }
    }

    #[test]
    fn build_client_key空返回_none() {
        assert!(build_client(&cfg("claude", "", true)).is_none());
        assert!(build_client(&cfg("claude", "   ", true)).is_none()); // 全空白也按空
    }

    #[test]
    fn build_client_disabled返回_none() {
        assert!(build_client(&cfg("claude", "sk-x", false)).is_none());
    }

    #[test]
    fn build_client未知provider返回_none() {
        assert!(build_client(&cfg("ollama", "xx", true)).is_none());
    }

    #[test]
    fn build_client合法claude返回_some() {
        assert!(build_client(&cfg("claude", "sk-x", true)).is_some());
    }

    #[test]
    fn build_client合法openai返回_some() {
        assert!(build_client(&cfg("openai", "sk-x", true)).is_some());
    }
}
