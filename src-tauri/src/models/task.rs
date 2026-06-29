use serde::{Deserialize, Serialize};

/// 任务：双通道提取（checkbox + section 启发式）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub note_id: String,
    pub vault_id: String,
    pub text: String,
    pub done: bool,
    pub due_date: Option<String>,
    /// 'checkbox' | 'section:明日待办' | 'nl-capture'
    pub source: String,
    pub source_line: Option<i32>,
    pub project_id: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}
