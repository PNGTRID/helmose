// ============================================================
// Claude（Anthropic Messages API）provider 实现
//
// 文档：https://docs.anthropic.com/en/api/messages
//   - Endpoint: https://api.anthropic.com/v1/messages
//   - Headers: x-api-key / anthropic-version: 2023-06-01 / content-type: json
//   - Body: { model, max_tokens, system, messages: [{role:"user", content:"..."}] }
//   - Response: { content: [{ type: "text", text: "..." }] }
//
// 模型选择：claude-3-5-sonnet-latest（写死，未来按 settings.model 扩展）。
// 超时 30s（防 LLM 慢拖死前端）。
// ============================================================

use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde_json::json;

use crate::services::ai::{AiClient, AiError};

pub struct ClaudeClient {
    api_key: String,
    http: reqwest::Client,
    /// 覆写 endpoint（默认官方），主要供测试替换
    endpoint_override: Option<String>,
}

impl ClaudeClient {
    pub fn new(api_key: String) -> Self {
        let http = super::build_http_client("claude");
        Self {
            api_key,
            http,
            endpoint_override: None,
        }
    }

    /// 测试用：注入 endpoint 覆写（指向本地 mock server）
    #[allow(dead_code)]
    pub fn with_endpoint(mut self, url: String) -> Self {
        self.endpoint_override = Some(url);
        self
    }
}

#[async_trait]
impl AiClient for ClaudeClient {
    async fn complete(&self, system: &str, user: &str) -> Result<String, AiError> {
        let url = self
            .endpoint_override
            .as_deref()
            .unwrap_or("https://api.anthropic.com/v1/messages");

        // 构造 headers（x-api-key 必填，anthropic-version 必填）
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-api-key",
            HeaderValue::from_str(&self.api_key).map_err(|e| AiError::Network(e.to_string()))?,
        );
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let body = json!({
            "model": "claude-3-5-sonnet-latest",
            "max_tokens": 1024,
            "system": system,
            "messages": [{ "role": "user", "content": user }],
        });

        let resp = self.http.post(url).headers(headers).json(&body).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AiError::HttpStatus {
                status: status.as_u16(),
                body,
            });
        }
        let v: serde_json::Value = resp.json().await?;
        parse_response(&v)
    }
}

/// 解析 Claude Messages API 响应：取 content[0].text。失败返回 Parse。
/// 抽成纯函数供单测直接构造 serde_json::Value 验证（审查 #14，无需 wire-level mock server）。
fn parse_response(v: &serde_json::Value) -> Result<String, AiError> {
    v["content"][0]["text"]
        .as_str()
        .ok_or_else(|| AiError::Parse(format!("响应缺 content[0].text：{}", v)))
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 解析正常响应() {
        let v = json!({
            "content": [{ "type": "text", "text": "项目A|优先级最高" }]
        });
        assert_eq!(parse_response(&v).unwrap(), "项目A|优先级最高");
    }

    #[test]
    fn 缺content返回parse错() {
        let v = json!({ "error": "bad" });
        assert!(matches!(parse_response(&v), Err(AiError::Parse(_))));
    }

    #[test]
    fn content空数组返回parse错() {
        let v = json!({ "content": [] });
        assert!(matches!(parse_response(&v), Err(AiError::Parse(_))));
    }

    #[test]
    fn content元素无text返回parse错() {
        let v = json!({ "content": [{ "type": "tool_use" }] });
        assert!(matches!(parse_response(&v), Err(AiError::Parse(_))));
    }
}
