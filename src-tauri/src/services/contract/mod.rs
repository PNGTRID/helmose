// ============================================================
// 结构契约 —— 内置 ~/wiki/规范.md 的目录 / type / 映射，作为 indexer / scaffold 的单一真相源
// 取代 layers.rs 硬编码旧编号（0-日志/1-我/...）。纯静态数据 + 纯函数，不写库。
// 当契约与规范.md 有差异时，以规范.md 为准；此处为编译期内置默认。
// ============================================================

/// 00~09 顶层目录骨架（规范.md「目录结构」契约）
pub const TOP_LEVEL_DIRS: &[&str] = &[
    "00_收件箱",
    "01_企业与项目资产",
    "02_金融与不动产资产",
    "03_IP与内容资产",
    "04_关系与社群资产",
    "05_个人成长与认知资产",
    "06_学习与资源资产",
    "07_决策与复盘",
    "08_档案库",
    "09_核心知识库",
];

/// 11 种 frontmatter type（规范.md「页面类型说明」契约）
pub const NOTE_TYPES: &[&str] = &[
    "profile",
    "person",
    "project",
    "strategy",
    "book",
    "course",
    "tool",
    "method",
    "experience",
    "comparison",
    "query",
];

/// type → 存放目录映射（取自规范.md「页面类型说明」表；目录以 `/` 结尾便于前缀匹配）
const TYPE_DIR_PAIRS: &[(&str, &str)] = &[
    ("profile", "05_个人成长与认知资产/"),
    ("person", "04_关系与社群资产/核心人脉网络/"),
    ("project", "01_企业与项目资产/"),
    ("strategy", "01_企业与项目资产/运营策略/"),
    ("book", "06_学习与资源资产/系统学习记录/书籍/"),
    ("course", "06_学习与资源资产/系统学习记录/课程/"),
    ("tool", "06_学习与资源资产/工具与模板库/"),
    ("method", "09_核心知识库/方法论/"),
    ("experience", "05_个人成长与认知资产/经历/"),
    ("comparison", "06_学习与资源资产/市场情报/"),
    ("query", "09_核心知识库/"),
];

/// type → 存放目录（脚手架放模板 / indexer 反查用）
pub fn type_to_dir(t: &str) -> Option<&'static str> {
    TYPE_DIR_PAIRS
        .iter()
        .find(|(k, _)| *k == t)
        .map(|(_, v)| *v)
}

/// 路径分隔符归一为 `/`（兼容 Windows 反斜杠）
fn norm(p: &str) -> String {
    p.replace('\\', "/")
}

/// 判定 note_type（取代 layers.rs::type_of）
/// 优先级：① frontmatter.type（须属于 11 种）→ 用；
///        ② 否则按 rel_path 最长前缀匹配 type→dir 反查；
///        ③ 否则 None（容错降级）。
pub fn infer_note_type(rel_path: &str, fm_type: Option<&str>) -> Option<String> {
    // ① frontmatter.type 优先（须在契约 11 种内）
    if let Some(t) = fm_type {
        if NOTE_TYPES.contains(&t) {
            return Some(t.to_string());
        }
    }
    // ② 最长前缀反查 type→dir（更具体的目录优先，如「运营策略」优先于「01_根」）
    let p = norm(rel_path);
    let mut best: Option<(&str, usize)> = None; // (type, dir 长度)
    for (t, dir) in TYPE_DIR_PAIRS {
        if p.starts_with(dir) {
            let len = dir.len();
            if best.map(|(_, bl)| len > bl).unwrap_or(true) {
                best = Some((t, len));
            }
        }
    }
    best.map(|(t, _)| t.to_string())
}

/// 判定 layer（取代 layers.rs::layer_of）：1=高结构 / 2=半结构 / 3=零结构
/// 规范.md 无 L1/L2/L3 概念，此为 Helmose 按 type 的结构化程度划分；无 type 默认半结构（2）。
pub fn infer_layer(note_type: Option<&str>) -> i32 {
    match note_type {
        Some("project") | Some("strategy") | Some("profile") | Some("person") => 1,
        Some("experience") | Some("query") => 3,
        // book / course / tool / method / comparison / None / 非契约 type → 半结构
        _ => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fm_type_优先且须在契约内() {
        // frontmatter.type 在 11 种内 → 直接用（忽略路径所在目录）
        assert_eq!(
            infer_note_type("07_决策与复盘/随便/x.md", Some("project")),
            Some("project".into())
        );
        assert_eq!(
            infer_note_type("09_核心知识库/x.md", Some("experience")),
            Some("experience".into())
        );
    }

    #[test]
    fn fm_type_非契约值则忽略走目录反查() {
        // frontmatter.type 是非约定值（如旧 "log"）→ 忽略，按目录反查
        assert_eq!(
            infer_note_type("01_企业与项目资产/白墨工厂/x.md", Some("log")),
            Some("project".into())
        );
    }

    #[test]
    fn 目录反查_最长前缀优先() {
        // 无 frontmatter type，按路径反查；更具体的目录优先
        assert_eq!(
            infer_note_type("01_企业与项目资产/白墨工厂/x.md", None),
            Some("project".into())
        );
        // 运营策略 比 01 根 更具体 → strategy
        assert_eq!(
            infer_note_type("01_企业与项目资产/运营策略/定价.md", None),
            Some("strategy".into())
        );
        // 06 下按子目录区分 book / course / tool / comparison
        assert_eq!(
            infer_note_type("06_学习与资源资产/系统学习记录/书籍/atomic.md", None),
            Some("book".into())
        );
        assert_eq!(
            infer_note_type("06_学习与资源资产/系统学习记录/课程/ai.md", None),
            Some("course".into())
        );
        assert_eq!(
            infer_note_type("06_学习与资源资产/工具与模板库/claude.md", None),
            Some("tool".into())
        );
        assert_eq!(
            infer_note_type("06_学习与资源资产/市场情报/拆解.md", None),
            Some("comparison".into())
        );
        // 09 方法论 → method（比 09 根 query 更具体）；09 根 → query
        assert_eq!(
            infer_note_type("09_核心知识库/方法论/复盘.md", None),
            Some("method".into())
        );
        assert_eq!(
            infer_note_type("09_核心知识库/速查.md", None),
            Some("query".into())
        );
        // 05 经历 → experience；05 根下档案 → profile
        assert_eq!(
            infer_note_type("05_个人成长与认知资产/经历/2026-06/x.md", None),
            Some("experience".into())
        );
        assert_eq!(
            infer_note_type("05_个人成长与认知资产/袁锐钦.md", None),
            Some("profile".into())
        );
        assert_eq!(
            infer_note_type("04_关系与社群资产/核心人脉网络/张三.md", None),
            Some("person".into())
        );
    }

    #[test]
    fn 反查无匹配降级_none() {
        // 00 / 02 / 03 / 07 / 08 顶层目录无 type 映射 → None（容错降级）
        assert_eq!(infer_note_type("00_收件箱/碎片.md", None), None);
        assert_eq!(infer_note_type("07_决策与复盘/日志/2026-06/x.md", None), None);
        assert_eq!(infer_note_type("02_金融与不动产资产/财务/x.md", None), None);
    }

    #[test]
    fn 路径分隔符归一() {
        // 反斜杠归一为 / 后反查
        assert_eq!(
            infer_note_type("01_企业与项目资产\\运营策略\\x.md", None),
            Some("strategy".into())
        );
    }

    #[test]
    fn layer_按_type_映射() {
        // L1 高结构
        assert_eq!(infer_layer(Some("project")), 1);
        assert_eq!(infer_layer(Some("strategy")), 1);
        assert_eq!(infer_layer(Some("profile")), 1);
        assert_eq!(infer_layer(Some("person")), 1);
        // L2 半结构
        assert_eq!(infer_layer(Some("book")), 2);
        assert_eq!(infer_layer(Some("course")), 2);
        assert_eq!(infer_layer(Some("tool")), 2);
        assert_eq!(infer_layer(Some("method")), 2);
        assert_eq!(infer_layer(Some("comparison")), 2);
        // L3 零结构
        assert_eq!(infer_layer(Some("experience")), 3);
        assert_eq!(infer_layer(Some("query")), 3);
        // 无 type / 非契约 type → 默认 L2
        assert_eq!(infer_layer(None), 2);
        assert_eq!(infer_layer(Some("log")), 2);
    }

    #[test]
    fn type_to_dir_查表() {
        assert_eq!(type_to_dir("project"), Some("01_企业与项目资产/"));
        assert_eq!(type_to_dir("query"), Some("09_核心知识库/"));
        assert_eq!(type_to_dir("method"), Some("09_核心知识库/方法论/"));
        assert_eq!(type_to_dir("strategy"), Some("01_企业与项目资产/运营策略/"));
        assert_eq!(type_to_dir("unknown"), None);
    }

    #[test]
    fn 顶层目录与_type_清单_完整() {
        assert_eq!(TOP_LEVEL_DIRS.len(), 10);
        assert_eq!(NOTE_TYPES.len(), 11);
        // 每种 type 都有目录映射
        for t in NOTE_TYPES {
            assert!(type_to_dir(t).is_some(), "type {} 缺目录映射", t);
        }
    }
}
