use serde::Serialize;

/// Agent 状态导出结果（写出路径 + 关键摘要）。
/// 完整内容在 app_data_dir/agent/LIFE-STATE.md（人读）+ state.json（机器读）。
#[derive(Debug, Clone, Serialize)]
pub struct AgentExport {
    pub md_path: String,
    pub json_path: String,
    pub date_iso: String,
    pub pending_tasks: i64,
    pub total_notes: i64,
}
