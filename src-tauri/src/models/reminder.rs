use serde::{Deserialize, Serialize};

/// 到期提醒（对齐 reminders 表，snake_case）
/// 来源：tasks 表 due_date 未来 N 天的任务，按设置「提前时长」生成。
/// 冗余 task_text/due_date：发通知时免 join。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub task_id: String,
    pub note_id: String,
    pub vault_id: String,
    /// 触发时间 ISO8601（提醒该在何时弹）
    pub remind_at: String,
    /// 是否已发（0/1 → bool）。派生：fired != 0
    pub fired: bool,
    /// 任务文本（冗余存，发通知用，免 join）
    pub task_text: String,
    /// 任务截止日期（冗余存，YYYY-MM-DD）
    pub due_date: Option<String>,
    pub created_at: String,
}
