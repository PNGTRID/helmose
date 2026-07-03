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

/// 迁移计划项（migrate_task_markers 输入，前端算好目标值传入）。
/// 每项 = 把指定 note 的 source_line 行任务，rewrite 为新 priority + urgency 标记。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigratePlan {
    /// 目标笔记 id
    pub note_id: String,
    /// 任务所在行（1-based，与 tasks.source_line 一致）
    pub source_line: i64,
    /// 目标 priority（0=清空；1/2，与四象限映射一致：important=≥2）
    pub priority: i32,
    /// 目标 urgency（"high"/"low"/""，空串=清空/未设）
    pub urgency: String,
}

/// 单条迁移预览（before/after 行文本，dry-run 展示用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrateItem {
    pub note_id: String,
    pub rel_path: String,
    pub source_line: i64,
    /// 改写前行文本
    pub before: String,
    /// 改写后行文本
    pub after: String,
}

/// 迁移预览/结果（dry-run 与实际写共用结构；applied 区分是否写盘）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigratePreview {
    /// 受影响 note 数
    pub note_count: usize,
    /// 受影响 bullet 数
    pub item_count: usize,
    /// 前 50 条 before/after 预览（避免大批量迁移时 IPC 过载）
    pub items: Vec<MigrateItem>,
    /// false = dry-run（未写盘）；true = 已写盘（含 .helmose/backup 备份）
    pub applied: bool,
}
