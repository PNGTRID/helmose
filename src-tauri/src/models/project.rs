use serde::{Deserialize, Serialize};

/// 业务线项目（2-业务/* 主页）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub vault_id: String,
    pub note_id: String,
    pub name: String,
    /// active | pending | paused | done（来自 tags project-status:*）
    pub status: Option<String>,
    /// 主线副线仲裁结果
    pub priority: Option<f64>,
    pub is_mainline: bool,
    /// P0 | P1 | null（来自 Q2-OKR 跨表关联）
    pub okr_priority: Option<String>,
    pub home_rel_path: Option<String>,
    pub last_activity: Option<String>,
    /// M5：负责人（来自 frontmatter.owner）。无则 None。
    pub owner: Option<String>,
}

/// M5：项目进度聚合（运行时聚合，不入 frontmatter，不污染 vault）。
/// 一个项目对应一行，统计其下任务的完成情况。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectProgress {
    /// 项目 ID（projects.id）
    pub project_id: String,
    /// 项目名（前端展示用，避免再回查 projects 表）
    pub name: String,
    /// 关联任务总数（tasks.project_id = project_id）
    pub total: i64,
    /// 已完成数（status == 'done'）
    pub done: i64,
    /// 逾期未完成数（due_date < 今天 且 status != 'done'）
    pub due_overdue: i64,
}
