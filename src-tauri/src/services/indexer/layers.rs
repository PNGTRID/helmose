// 分层判定：先按路径前缀判层级与类型（核心：按实际文件结构，不按规范.md）

/// 判层级：1=高结构 / 2=半结构 / 3=零结构
pub fn layer_of(rel_path: &str) -> i32 {
    let p = rel_path.replace('\\', "/");
    if p.starts_with("5-经历") {
        return 1;
    }
    if p.starts_with("2-业务") {
        return 1;
    }
    if p.starts_with("4-工具与效率") {
        return 1;
    }
    if p.starts_with("0-日志") {
        return 3;
    }
    if p.starts_with("1-我/日记与记录") || p.starts_with("1-我/日志") {
        return 3;
    }
    if p.starts_with("1-我/财务记录") {
        return 3;
    }
    if p.starts_with("3-学习") {
        return 2;
    }
    if p.starts_with("2-创作") {
        return 2;
    }
    2 // 默认半结构
}

/// 推断 note_type（log/experience/project/profile/weekly/...）
pub fn type_of(rel_path: &str, _layer: i32) -> Option<String> {
    let p = rel_path.replace('\\', "/");
    if p.starts_with("0-日志") {
        return Some("log".into());
    }
    if p.starts_with("5-经历") {
        if p.contains("weekly") || p.contains("周复盘") {
            return Some("weekly".into());
        }
        return Some("experience".into());
    }
    if p.starts_with("2-业务") {
        return Some("project".into());
    }
    if p.contains("1-我/袁锐钦") {
        return Some("profile".into());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layer_classification() {
        assert_eq!(layer_of("5-经历/2026-04/2026-04-01.md"), 1);
        assert_eq!(layer_of("2-业务/AI编程出海.md"), 1);
        assert_eq!(layer_of("0-日志/2026-06/2026-06-21.md"), 3);
        assert_eq!(layer_of("3-学习/某笔记.md"), 2);
    }

    #[test]
    fn type_classification() {
        assert_eq!(type_of("0-日志/2026-06/x.md", 3).as_deref(), Some("log"));
        assert_eq!(
            type_of("5-经历/weekly/2026-W17.md", 1).as_deref(),
            Some("weekly")
        );
        assert_eq!(
            type_of("2-业务/抖店电商.md", 1).as_deref(),
            Some("project")
        );
    }
}
