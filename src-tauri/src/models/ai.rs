// ============================================================
// AI 模型 DTO（M4）—— AiSettings / AiMainline / AiGeneration
//
// - AiSettings：存 app_data_dir/config.json（key 不入 vault 不入 git）
// - AiMainline：主线判定结果（含 source=ai|heuristic 标降级标注）
// - AiGeneration：ai_generations 表行（缓存 AI 结果，按 vault+date+feature UNIQUE upsert）
// ============================================================

use serde::{Deserialize, Serialize};

/// AI 配置（敏感：key 不入 vault 不入 git，存 app_data_dir/config.json）。
/// 注：手写 Debug 屏蔽 api_key（审查 #7）——避免任何 tracing::debug!("{:?}", settings)
/// 或错误上下文把明文 key 泄漏到日志。Serialize 保留（前端设置页需回显 key）。
#[derive(Clone, Serialize, Deserialize)]
pub struct AiSettings {
    /// provider："claude" | "openai"（未知 provider → build_client 返回 None）
    pub provider: String,
    /// API key（空 → build_client 返回 None，走本地启发式降级）
    pub api_key: String,
    /// 是否启用 AI（false → build_client 直接 None）
    pub enabled: bool,
}

impl std::fmt::Debug for AiSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let masked = if self.api_key.is_empty() {
            "(empty)".to_string()
        } else {
            format!("{}…", &self.api_key[..self.api_key.chars().count().min(4)])
        };
        f.debug_struct("AiSettings")
            .field("provider", &self.provider)
            .field("api_key", &masked)
            .field("enabled", &self.enabled)
            .finish()
    }
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: "claude".to_string(),
            api_key: String::new(),
            enabled: false,
        }
    }
}

/// AI 主线判定结果。
/// - source="ai"：LLM 调用成功
/// - source="heuristic"：LLM 失败/key 空，退本地启发式（projects top-3）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMainline {
    pub project_name: String,
    pub reason: String,
    pub source: String,
}

/// AI 教练建议（每日建议 1-3 句）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiCoachResult {
    /// 建议文本（1-3 句）
    pub text: String,
    /// "ai" | "heuristic" | "cached"（降级标注）
    pub source: String,
}

/// AI 明日一句结果（写回 vault「明日寄语」section + tomorrow_sentences 表）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTomorrowResult {
    /// 生成的句子
    pub sentence: String,
    /// "ai" | "heuristic"
    pub source: String,
    /// 写入的 note_id（当日笔记）
    pub note_id: String,
}
