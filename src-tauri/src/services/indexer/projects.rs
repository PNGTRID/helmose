// 项目提取：从 frontmatter type=project 的笔记提取项目信息
// 状态来自 tags 里的 project-status:<status>（规范.md 定义 active/completed/paused/abandoned，实际还有 pending）

use crate::services::indexer::ParsedNote;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct ProjectInfo {
    pub name: String,
    /// active | pending | paused | completed | abandoned
    pub status: Option<String>,
    pub home_rel_path: String,
}

/// 判定并提取项目信息。非 project 类型返回 None。
pub fn extract(p: &ParsedNote) -> Option<ProjectInfo> {
    let ftype = p.frontmatter.get("type").and_then(|v| v.as_str())?;
    if ftype != "project" {
        return None;
    }
    let name = p.title.clone().unwrap_or_else(|| {
        Path::new(&p.file_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&p.file_name)
            .to_string()
    });
    // tags 里找 project-status:<x>
    let status = p
        .tags
        .iter()
        .find_map(|t| t.strip_prefix("project-status:").map(str::to_string));
    Some(ProjectInfo {
        name,
        status,
        home_rel_path: p.rel_path.clone(),
    })
}
