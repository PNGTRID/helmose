use serde::Serialize;

/// 脚手架生成统计（snake_case，对齐前端 TS）
#[derive(Debug, Clone, Serialize)]
pub struct ScaffoldStats {
    pub root_path: String,
    pub dirs_created: usize,
    pub templates_created: usize,
    pub root_files_created: usize,
}
