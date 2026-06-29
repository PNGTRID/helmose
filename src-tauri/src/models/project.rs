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
}
