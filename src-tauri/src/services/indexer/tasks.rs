// 任务提取双通道：
//   A. 全文 checkbox  `- [ ]` / `- [x]`
//   B. TODO section 下的 bullet（主路径，日志里 checkbox 极少）
// due_date 解析：从 bullet 文本提取日期标记（📅 / due: / 截止: / deadline），
//   清理掉标记让 text 干净，due_date 独立存（解锁 TasksPage 分组 + TodayPage 今日待办）。

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ExtractedTask {
    pub text: String,
    pub done: bool,
    /// 'checkbox' | 'section:明日待办'
    pub source: String,
    pub source_line: Option<i32>,
    /// 截止日期 YYYY-MM-DD（来自 bullet 内日期标记，无则 None）
    pub due_date: Option<String>,
}

static RE_CHECKBOX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*[-*+]\s+\[( |x|X)\]\s+(.+)$").unwrap());

static RE_BULLET: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*[-*+]\s+(.+)").unwrap());

// 日期标记：📅 2026-07-01（Obsidian Tasks 插件常用 emoji 语法）
static RE_DUE_EMOJI: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\s*📅\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2})").unwrap());
// 日期标记：due: / 截止：/ deadline + 日期（中英文混用，全角半角冒号都收）
static RE_DUE_TEXT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\s*(?:due|截止|deadline)[：:=\s]+(\d{4}[-./]\d{1,2}[-./]\d{1,2})").unwrap()
});

/// 从 bullet 文本拆出 due_date 并清理日期标记。
/// 支持 `📅 2026-07-01` / `due: 2026-07-01` / `截止：2026.07.01` / `deadline 2026-07-01`。
/// 返回 (去掉标记后的干净 text, 归一化为 YYYY-MM-DD 的 due_date)。无有效日期 → (原文, None)。
fn split_due(text: &str) -> (String, Option<String>) {
    for re in [&*RE_DUE_EMOJI, &*RE_DUE_TEXT] {
        if let Some(caps) = re.captures(text) {
            if let Some(d) = crate::utils::dates::normalize_date(&caps[1]) {
                let cleaned = re.replace_all(text, "").trim().to_string();
                return (cleaned, Some(d.to_string()));
            }
        }
    }
    (text.to_string(), None)
}

const TODO_SECTION_KEYWORDS: &[&str] = &[
    "明日待办",
    "明日计划",
    "今日待办",
    "今日任务",
    "今日计划",
    "待办事项",
    "今日工作",
    "明日工作",
    "今日要做",
    "明日要做",
    "TODO",
];

/// 通道 A：全文 checkbox
pub fn extract_checkbox(content: &str) -> Vec<ExtractedTask> {
    content
        .lines()
        .enumerate()
        .filter_map(|(i, line)| {
            let caps = RE_CHECKBOX.captures(line)?;
            let (text, due) = split_due(caps[2].trim());
            Some(ExtractedTask {
                text,
                done: matches!(&caps[1], "x" | "X"),
                source: "checkbox".to_string(),
                source_line: Some(i as i32 + 1),
                due_date: due,
            })
        })
        .collect()
}

/// 通道 B：指定 section body 下的所有 bullet
pub fn extract_bullets(body: &str, source: &str) -> Vec<ExtractedTask> {
    body.lines()
        .filter_map(|line| {
            let caps = RE_BULLET.captures(line)?;
            let raw = caps[1].trim();
            if raw.is_empty() {
                return None;
            }
            // 跳过 checkbox 行（由 extract_checkbox 处理，避免重复提取）
            if RE_CHECKBOX.is_match(line) {
                return None;
            }
            let (text, due) = split_due(raw);
            Some(ExtractedTask {
                text,
                done: false,
                source: source.to_string(),
                source_line: None,
                due_date: due,
            })
        })
        .collect()
}

/// 判断 section 名是否属于"待办类"
pub fn is_todo_section(name: &str) -> bool {
    let n = name.trim();
    TODO_SECTION_KEYWORDS.iter().any(|k| n.contains(k))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkbox_done_undone() {
        let v = extract_checkbox("- [x] 完成\n- [ ] 未完成\n普通行");
        assert_eq!(v.len(), 2);
        assert!(v[0].done);
        assert!(!v[1].done);
    }

    #[test]
    fn bullets_from_body() {
        let v = extract_bullets("- 任务A\n- 任务B\n普通段落", "section:明日待办");
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].source, "section:明日待办");
    }

    #[test]
    fn todo_section_match() {
        assert!(is_todo_section("明日待办"));
        assert!(is_todo_section("今日任务"));
        assert!(!is_todo_section("关键事件"));
    }

    #[test]
    fn due_date_emoji_解析并清理() {
        // 📅 2026-07-01 → due_date 提取 + text 去掉标记
        let v = extract_checkbox("- [ ] 写设计文档 📅 2026-07-01");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].due_date.as_deref(), Some("2026-07-01"));
        assert_eq!(v[0].text, "写设计文档", "text 应去掉日期标记");
        assert!(!v[0].done);
    }

    #[test]
    fn due_date_文本标记_中英文() {
        // due: / 截止：/ deadline 三种文本标记都应解析
        assert_eq!(
            split_due("上线 due: 2026-07-01").1.as_deref(),
            Some("2026-07-01")
        );
        assert_eq!(
            split_due("提交截止：2026.07.01").1.as_deref(),
            Some("2026-07-01"),
            "点号日期应归一化为横杠"
        );
        assert_eq!(
            split_due("deadline 2026-07-01 发布").1.as_deref(),
            Some("2026-07-01")
        );
    }

    #[test]
    fn 无日期标记_due_none_text原样() {
        let (text, due) = split_due("普通任务无日期");
        assert_eq!(text, "普通任务无日期");
        assert!(due.is_none());
    }

    #[test]
    fn bullets_也带_due_date() {
        let v = extract_bullets("- 跟进客户 📅 2026-07-15\n", "section:今日待办");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].due_date.as_deref(), Some("2026-07-15"));
        assert_eq!(v[0].source, "section:今日待办");
    }
}
