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
    /// M3：任务状态（"todo" | "doing" | "done"）。done 字段保留为派生（status == 'done'）。
    pub status: String,
    /// M3：优先级 0-3，0=未设（来自 vault ⭐ 数 1-3）。
    pub priority: i32,
    /// M3：紧急度（"low" | "mid" | "high"，来自 vault 🔥 标记）。
    /// 注：派生（按 due_date 推导）只在前端做，indexer 只解析手动 🔥。
    pub urgency: String,
}
