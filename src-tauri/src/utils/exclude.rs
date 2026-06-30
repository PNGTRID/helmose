// ============================================================
// 排除目录契约 —— 索引视图与浏览视图共用的「不索引」目录判定（架构铁律 5）
// 单一定义点，消除 index.rs / library.rs / incremental.rs 三处漂移。
// ============================================================

use std::path::Path;

/// 体积大的备份/外部资料目录，默认不索引（提速）。
/// 组件名匹配：无论落在哪一层，只要路径含该名目录即排除。
/// 新体系位置（规范.md）：6-原始资料 → 08_档案库/原始资料/6-原始资料/；专家团 → 04_关系与社群资产/专家团/。
pub const EXCLUDE_DIRS: &[&str] = &["6-原始资料", "专家团"];

/// 组件名是否被排除（隐藏目录 `.` 开头，或属于 EXCLUDE_DIRS）。
/// pub 供 smoke test 等复用，避免排除规则漂移。
pub fn is_excluded_component(name: &str) -> bool {
    name.starts_with('.') || EXCLUDE_DIRS.contains(&name)
}

/// 相对路径（`/` 分隔）是否落在排除目录下
pub fn is_excluded_rel(rel: &str) -> bool {
    rel.replace('\\', "/").split('/').any(is_excluded_component)
}

/// 绝对路径（相对 root）是否落在排除目录下
pub fn is_excluded(path: &Path, root: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components().any(|c| {
        c.as_os_str()
            .to_str()
            .map(is_excluded_component)
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 隐藏目录排除() {
        assert!(is_excluded_rel(".obsidian/x.md"));
        assert!(is_excluded_rel("01_企业与项目资产/.git/x.md"));
    }

    #[test]
    fn 备份大目录_组件名匹配不限层级() {
        // 新体系下 6-原始资料 在 08_档案库/原始资料/ 下，专家团在 04_关系与社群资产/ 下；
        // 组件名不变 → 组件名匹配仍正确排除
        assert!(is_excluded_rel("08_档案库/原始资料/6-原始资料/x.md"));
        assert!(is_excluded_rel("04_关系与社群资产/专家团/x.md"));
    }

    #[test]
    fn 正常目录不排除() {
        assert!(!is_excluded_rel("01_企业与项目资产/白墨工厂/x.md"));
        assert!(!is_excluded_rel("00_收件箱/碎片.md"));
    }

    #[test]
    fn 反斜杠归一() {
        assert!(is_excluded_rel("08_档案库\\原始资料\\6-原始资料\\x.md"));
    }

    #[test]
    fn 绝对路径版() {
        let root = Path::new("/vault");
        assert!(is_excluded(&Path::new("/vault/专家团/x.md"), root));
        assert!(!is_excluded(&Path::new("/vault/01_企业与项目资产/x.md"), root));
    }
}
