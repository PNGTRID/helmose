use serde::{Deserialize, Serialize};

/// OKR（对齐 okrs 表，snake_case）
/// 来源：strategy / project 文档的「目标 / 关键结果 / KR / OKR / Key Results」section。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Okr {
    pub id: String,
    pub vault_id: String,
    pub source_note_id: String,
    /// 形如 2026Q3
    pub quarter: Option<String>,
    /// 目标
    pub objective: String,
    /// P0 / P1 / P2 / P3
    pub priority: String,
    /// 关键结果 bullet 文本
    pub kr_text: Option<String>,
    /// 目标值（含可选单位「万千亿」字样）
    pub target_value: Option<String>,
    /// 当前进度值
    pub current_value: Option<String>,
    /// 原始行内容（与 kr_text 同源，便于前端展示完整 bullet）
    pub raw_row: Option<String>,
}
