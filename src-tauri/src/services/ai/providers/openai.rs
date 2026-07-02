// ============================================================
// OpenAI（Chat Completions API）provider 实现
//
// 文档：https://platform.openai.com/docs/api-reference/chat/create
//   - Endpoint: https://api.openai.com/v1/chat/completions
//   - Headers: Authorization: Bearer <key> / content-type: json
//   - Body: { model, messages: [{role,content}, ...] }
//   - Response: { choices: [{ message: { content: "..." } }] }
//
// 模型：gpt-4o-mini（性价比，未来按 settings.model 扩展）。
// 超时 30s。
// ============================================================

use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde_json::json;

use crate::services::ai::{AiClient, AiError};

pub struct OpenAiClient {
    api_key: String,
    http: reqwest::Client,
    endpoint_override: Option<String>,
}

impl OpenAiClient {
    pub fn new(api_key: String) -> Self {
        let http = super::build_http_client("openai");
        Self {
            api_key,
            http,
            endpoint_override: None,
        }
    }

    /// 测试用：注入 endpoint 覆写
    #[allow(dead_code)]
    pub fn with_endpoint(mut self, url: String) -> Self {
        self.endpoint_override = Some(url);
        self
    }
}

#[async_trait]
impl AiClient for OpenAiClient {
    async fn complete(&self, system: &str, user: &str) -> Result<String, AiError> {
        let url = self
            .endpoint_override
            .as_deref()
            .unwrap_or("https://api.openai.com/v1/chat/completions");

        let mut headers = HeaderMap::new();
        let bearer = format!("Bearer {}", self.api_key);
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&bearer).map_err(|e| AiError::Network(e.to_string()))?,
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let body = json!({
            "model": "gpt-4o-mini",
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
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

/// 解析 OpenAI Chat Completions 响应：取 choices[0].message.content。失败返回 Parse。
/// 抽成纯函数供单测直接构造 serde_json::Value 验证（审查 #14）。
fn parse_response(v: &serde_json::Value) -> Result<String, AiError> {
    v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| AiError::Parse(format!("响应缺 choices[0].message.content：{}", v)))
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 解析正常响应() {
        let v = json!({
            "choices": [{ "message": { "role": "assistant", "content": "今日聚焦项目A" } }]
        });
        assert_eq!(parse_response(&v).unwrap(), "今日聚焦项目A");
    }

    #[test]
    fn 缺choices返回parse错() {
        let v = json!({ "error": { "message": "bad" } });
        assert!(matches!(parse_response(&v), Err(AiError::Parse(_))));
    }

    #[test]
    fn choices空数组返回parse错() {
        let v = json!({ "choices": [] });
        assert!(matches!(parse_response(&v), Err(AiError::Parse(_))));
    }

    #[test]
    fn content为null返回parse错() {
        let v = json!({ "choices": [{ "message": { "content": null } }] });
        assert!(matches!(parse_response(&v), Err(AiError::Parse(_))));
    }
}
