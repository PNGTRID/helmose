// OKR 提取：从 strategy / project 文档的「目标 / 关键结果 / KR / OKR / Key Results」section 提 KR
//
// 设计要点（契约零侵入）：
//   - 不加新 type（OKR 文档在 wiki 里多为 strategy 或 project，加 type 会触发 contract 6 测试连锁）。
//   - 双条件识别：frontmatter.type ∈ {strategy, project} AND 含 KR 类 section 关键词。
//   - 纯函数不写库（解析失败留 NULL 不报错）；写库在 commands/index.rs。
//
// 字段映射：
//   objective    = section 标题去掉「关键结果/KR/OKR/目标」字样后的残留，或首行 bullet 文本。
//   kr_text      = bullet 文本（去 `-`/`*`/`[]`）。
//   target_value / current_value = 正则 `(\d+\.?\d*)\s*[万千亿]?` 配「目标/当前/达成」字样。
//   priority     = fm.priority（数字→P0/P1/P2/P3 映射，>80 P0、>50 P1、>0 P2）或 fm.priority 字符串或默认 P2。
//   quarter      = fm.quarter 或 section 标题/首行里的 YYYYQN。
//   source_line  = bullet 在全文的行号（1-based）。

use super::sections::split_sections_with_lines;
use crate::services::indexer::ParsedNote;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

/// 单条提取的 OKR（对齐 okrs 表列，写库时 raw_row 取 kr_text 兜底）
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ExtractedOkr {
    /// 目标（section 标题或首行文本）
    pub objective: String,
    /// 关键结果 bullet 文本
    pub kr_text: Option<String>,
    /// 目标值（数字 + 单位字样）
    pub target_value: Option<String>,
    /// 当前进度值
    pub current_value: Option<String>,
    /// P0/P1/P2/P3
    pub priority: String,
    /// 形如 2026Q3
    pub quarter: Option<String>,
    /// bullet 在全文的行号（1-based）
    pub source_line: Option<i32>,
}

/// section 名是否属于「KR 类」（不区分大小写）。
/// 关键词：目标 / 关键结果 / KR / OKR / Key Results。
/// 审查 #17：`contains("目标")` 过宽——会误匹配「目标管理」「年度目标复盘」「目标与计划」
/// 等非 KR section。收紧为：标题整体（trim 后）等于「目标」才命中；其余关键词保留 contains
/// （"关键结果"/"KR"/"OKR"/"Key Results" 专属度高，子串匹配足够精确）。
pub fn is_okr_section(name: &str) -> bool {
    let n = name.trim().to_lowercase();
    n == "目标" // 仅整体为「目标」二字才命中（如 `## 目标`）
        || n.contains("关键结果")
        || n.contains("kr")
        || n.contains("okr")
        || n.contains("key result")
}

/// 从 frontmatter / 正文 section 提取 OKR。
/// 非 strategy/project 类型 → 空 Vec；含 KR section 才提，否则空。
pub fn extract(parsed: &ParsedNote) -> Vec<ExtractedOkr> {
    let ftype = parsed.frontmatter.get("type").and_then(|v| v.as_str());
    let ftype = match ftype {
        Some(t) if t == "strategy" || t == "project" => t,
        _ => return Vec::new(),
    };
    let _ = ftype; // 仅作门禁，下文不再使用

    let sections = split_sections_with_lines(&parsed.raw_content);
    let priority = derive_priority(&parsed.frontmatter);
    let fm_quarter = parsed
        .frontmatter
        .get("quarter")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let mut out = Vec::new();
    for sec in &sections {
        if !is_okr_section(&sec.name) {
            continue;
        }
        // objective：section 标题去掉关键词残留，空则用首个非空 bullet
        let objective = derive_objective(&sec.name, &sec.body);
        // quarter：fm.quarter 优先，否则从 section 标题/首行抓 YYYYQN
        let quarter = fm_quarter
            .clone()
            .or_else(|| parse_quarter(&sec.name))
            .or_else(|| {
                sec.body
                    .lines()
                    .find_map(parse_quarter)
            });

        for (i, line) in sec.body.lines().enumerate() {
            let raw_owned = match RE_BULLET.captures(line) {
                Some(c) => c[1].trim().to_string(),
                None => continue,
            };
            let raw = raw_owned.as_str();
            if raw.is_empty() {
                continue;
            }
            let (target_value, current_value) = split_target_current(raw);
            out.push(ExtractedOkr {
                objective: objective.clone(),
                kr_text: Some(raw.to_string()),
                target_value,
                current_value,
                priority: priority.clone(),
                quarter: quarter.clone(),
                source_line: Some((sec.heading_line + 1 + i) as i32),
            });
        }
    }
    out
}

/// 从 section 标题与首行兜底算 objective（去 KR 关键词残留）。
fn derive_objective(name: &str, body: &str) -> String {
    // 标题去关键词 + 数字标号残留
    let cleaned = clean_keywords(name);
    if !cleaned.is_empty() {
        return cleaned;
    }
    // 兜底：首行 bullet 文本
    for line in body.lines() {
        if let Some(c) = RE_BULLET.captures(line) {
            let t = c[1].trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    name.trim().to_string()
}

/// 去掉「关键结果 / 目标 / KR / OKR / Key Results / 数字标号」等关键词残留。
fn clean_keywords(s: &str) -> String {
    let mut t = s.trim().to_string();
    for k in ["关键结果", "目标", "KR", "kr", "OKR", "okr", "Key Results", "key results"] {
        t = t.replace(k, "");
    }
    // 去首尾的数字/标点残留（如 "1." "##" "-"）
    t = t
        .trim_matches(|c: char| c.is_ascii_digit() || ".#-:： ".contains(c))
        .trim()
        .to_string();
    t
}

/// 从 frontmatter priority 推 P0/P1/P2/P3。
/// - 数字（0-100）：>80 P0、>50 P1、>0 P2、0 → P3
/// - 字符串（含 P0/P1/P2/P3）：原样保留
/// - 缺省：P2
fn derive_priority(fm: &serde_json::Value) -> String {
    if let Some(v) = fm.get("priority") {
        if let Some(n) = v.as_f64() {
            return match n as i64 {
                n if n > 80 => "P0".into(),
                n if n > 50 => "P1".into(),
                n if n > 0 => "P2".into(),
                _ => "P3".into(),
            };
        }
        if let Some(s) = v.as_str() {
            let up = s.trim().to_uppercase();
            if matches!(up.as_str(), "P0" | "P1" | "P2" | "P3") {
                return up;
            }
        }
    }
    "P2".into()
}

/// 解析 `YYYYQN`（如 2026Q3），含全角 Q 容错。
fn parse_quarter(s: &str) -> Option<String> {
    let caps = RE_QUARTER.captures(s)?;
    Some(format!("{}Q{}", &caps[1], &caps[2]))
}

/// 从 KR 文本拆出 target / current 数值。
/// 规则：匹配 `(目标|当前|达成|进度)[^0-9]*(\d+(\.\d+)?)`；
/// target = 「目标/达成」后的数值；current = 「当前/进度」后的数值。
/// 数值带「万千亿」单位字样时一并保留。
fn split_target_current(text: &str) -> (Option<String>, Option<String>) {
    let mut target = None;
    let mut current = None;
    // 拆出 (label, number, unit) 三元组：label = 目标/当前/达成/进度
    for caps in RE_TARGET.captures_iter(text) {
        let label = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let num = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let unit = caps.get(3).map(|m| m.as_str()).unwrap_or("");
        if num.is_empty() {
            continue;
        }
        // unit 非空时拼接（"1000 万"），否则裸数值（"5000"）
        let val = if unit.is_empty() {
            num.to_string()
        } else {
            format!("{} {}", num, unit)
        };
        match label {
            l if l.contains("目标") || l.contains("达成") => target = Some(val),
            l if l.contains("当前") || l.contains("进度") => current = Some(val),
            _ => {}
        }
    }
    (target, current)
}

static RE_BULLET: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*[-*+]\s+(.+)").unwrap());
/// `YYYYQN` —— 季度（数字可全角，统一转半角输出）
static RE_QUARTER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(\d{4})\s*[QＱ]\s*([1-4])").unwrap());
/// (label)(number+unit)：label 为「目标/当前/达成/进度」类中文标签后跟数值。
/// 单独把 number 与 unit 拆成两组，避免无单位时尾随空格被卷入数值字符串。
/// number 与 unit 间允许一个可选空格（如 "1000 万"）。
static RE_TARGET: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(目标|当前值?|当前进度|当前|达成|进度)[^\d]{0,8}(\d+(?:\.\d+)?)\s*([万千亿]?)")
        .unwrap()
});

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::indexer::parse_file;

    /// 构造 strategy 笔记（含 KR section + 数值标记）
    const STRATEGY_OKR: &str = r#"---
title: 2026 战略
type: strategy
priority: 90
quarter: 2026Q3
---
# 2026 战略

## 关键结果
- KR1 收入达成 1000 万，当前 600 万
- KR2 用户目标 5000，当前 3500

普通段落（非 bullet，应忽略）
"#;

    /// project 类型 + 含 KR section（无 fm.priority/quarter，验兜底）
    const PROJECT_OKR: &str = r#"---
title: 项目X
type: project
---
# 项目X

## OKR 2026Q4
- 完成主线 v2，目标 80 当前 30
"#;

    /// strategy 但无 KR section（验空）
    const STRATEGY_NO_KR: &str = r#"---
title: 战略B
type: strategy
---
# 战略B
## 概述
本季度重点在产品
"#;

    /// experience 类型（不应触发 OKR 提取）
    const NON_STRATEGY: &str = r#"---
title: 经历
type: experience
---
# 经历
## 关键结果
- KR1 目标 100，当前 50
"#;

    #[test]
    fn strategy_含_kr_section_正确提取() {
        let p = parse_file("战略.md", STRATEGY_OKR, 0);
        let okrs = extract(&p);
        assert_eq!(okrs.len(), 2, "应提 2 个 KR bullet");
        // 都从 strategy section 提，objective 来自标题（去「关键结果」残留）
        assert!(!okrs[0].objective.is_empty());
        assert_ne!(okrs[0].objective, "关键结果", "objective 应去掉关键词残留");
        // priority=90 → P0；quarter=fm.quarter=2026Q3
        assert_eq!(okrs[0].priority, "P0");
        assert_eq!(okrs[0].quarter.as_deref(), Some("2026Q3"));
        // KR1 数值
        assert_eq!(okrs[0].target_value.as_deref(), Some("1000 万"));
        assert_eq!(okrs[0].current_value.as_deref(), Some("600 万"));
        assert!(okrs[0].kr_text.as_deref().unwrap_or("").contains("KR1"));
        // 第二条
        assert_eq!(okrs[1].target_value.as_deref(), Some("5000"));
        assert_eq!(okrs[1].current_value.as_deref(), Some("3500"));
        // source_line 1-based 且非空（heading_line + 1 + body offset）
        assert!(okrs[0].source_line.unwrap_or(0) > 0);
    }

    #[test]
    fn project_无_fm_priority_兜底_p2_从标题抓季度() {
        let p = parse_file("项目X.md", PROJECT_OKR, 0);
        let okrs = extract(&p);
        assert_eq!(okrs.len(), 1);
        assert_eq!(okrs[0].priority, "P2", "无 fm.priority 兜底 P2");
        assert_eq!(
            okrs[0].quarter.as_deref(),
            Some("2026Q4"),
            "quarter 从 section 标题抓"
        );
        assert_eq!(okrs[0].target_value.as_deref(), Some("80"));
        assert_eq!(okrs[0].current_value.as_deref(), Some("30"));
    }

    #[test]
    fn strategy_无_kr_section_返回空() {
        let p = parse_file("战略B.md", STRATEGY_NO_KR, 0);
        let okrs = extract(&p);
        assert!(okrs.is_empty(), "无 KR section 应返回空");
    }

    #[test]
    fn 非_strategy_project_类型_返回空() {
        let p = parse_file("经历.md", NON_STRATEGY, 0);
        let okrs = extract(&p);
        assert!(okrs.is_empty(), "type=experience 不应触发 OKR 提取");
    }

    #[test]
    fn 数值正则_带单位() {
        let (t, c) = split_target_current("收入目标 1000 万，当前 600 万");
        assert_eq!(t.as_deref(), Some("1000 万"));
        assert_eq!(c.as_deref(), Some("600 万"));
    }

    #[test]
    fn 数值正则_无标签_返回_none() {
        let (t, c) = split_target_current("纯文本无数值");
        assert!(t.is_none());
        assert!(c.is_none());
    }

    #[test]
    fn 数值正则_仅目标() {
        let (t, c) = split_target_current("目标值达成 99");
        assert_eq!(t.as_deref(), Some("99"));
        assert!(c.is_none());
    }

    #[test]
    fn priority_数字映射() {
        let mk = |p: serde_json::Value| derive_priority(&serde_json::json!({ "priority": p }));
        assert_eq!(mk(serde_json::json!(90)), "P0");
        assert_eq!(mk(serde_json::json!(60)), "P1");
        assert_eq!(mk(serde_json::json!(10)), "P2");
        assert_eq!(mk(serde_json::json!(0)), "P3");
        assert_eq!(mk(serde_json::json!("P1")), "P1");
    }

    #[test]
    fn quarter_解析() {
        assert_eq!(parse_quarter("2026Q3").as_deref(), Some("2026Q3"));
        assert_eq!(parse_quarter("OKR 2026Q4").as_deref(), Some("2026Q4"));
        assert!(parse_quarter("无季度").is_none());
    }

    /// 审查 #17：is_okr_section 收紧「目标」误匹配。
    /// 「目标管理」「年度目标复盘」不应命中；「目标」整体、「关键结果」「OKR ...」命中。
    #[test]
    fn is_okr_section_收紧目标误匹配() {
        // 命中
        assert!(is_okr_section("关键结果"));
        assert!(is_okr_section("OKR 2026Q4"));
        assert!(is_okr_section("okr"));
        assert!(is_okr_section("Key Results"));
        assert!(is_okr_section("目标")); // 整体二字
        assert!(is_okr_section("  目标  ")); // trim 后整体
        // 不应命中（含「目标」但非 KR section）
        assert!(!is_okr_section("目标管理"), "「目标管理」不应命中");
        assert!(!is_okr_section("年度目标复盘"), "「年度目标复盘」不应命中");
        assert!(!is_okr_section("目标与计划"), "「目标与计划」不应命中");
        // 无关标题
        assert!(!is_okr_section("概述"));
        assert!(!is_okr_section("本季度重点"));
    }
}
