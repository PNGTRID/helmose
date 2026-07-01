use serde::{Deserialize, Serialize};

/// 事件：关键事件 / 时间线 bullet（5-经历 ## 关键事件 等）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub note_id: String,
    pub vault_id: String,
    pub title: Option<String>,
    /// HH:MM 或区间
    pub event_time: Option<String>,
    pub event_date: Option<String>,
    pub content: Option<String>,
    pub output: Option<String>,
    pub project_id: Option<String>,
    pub raw_bullet: Option<String>,
    /// bullet 在全文的行号（1-based），供行级 update/delete 定位（inline-crud）
    pub source_line: Option<i32>,
}
