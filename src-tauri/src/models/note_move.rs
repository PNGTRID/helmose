use serde::{Deserialize, Serialize};

/// 移动/重命名结果（M1 task 4）。索引层：vault 原文已 fs::rename，索引同步。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveResult {
    /// 移动后的 note id（content_hash 不变 → id 通常不变；碰撞态除外）
    pub note_id: String,
    /// 新的相对路径
    pub new_rel_path: String,
    /// 旧相对路径（供前端 toast 展示「从 X 移到 Y」）
    pub old_rel_path: String,
    /// 检测到的路径型引用（`[x](旧路径)` / `[[旧路径]]`），需用户授权后用 apply_ref_updates 改原文。
    /// 反链（[[wikilink]] 按文件名匹配）已通过 id 稳定自动更新，不在此列表。
    pub refs_to_update: Vec<RefLoc>,
}

/// 路径型引用位置（task 5 apply_ref_updates 入参的一元素）。
/// 标识「哪个笔记的第几行用了旧路径」，授权后由 apply_ref_updates 替换。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefLoc {
    /// 引用所在笔记的 id（待更新的文档）
    pub note_id: String,
    /// 引用所在行号（1-based，供前端定位高亮 / 行级替换）
    pub line: i32,
    /// 旧路径（出现在原文里）
    pub old_path: String,
    /// 新路径（替换目标）
    pub new_path: String,
}
