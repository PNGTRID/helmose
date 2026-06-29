// 任务提取双通道：
//   A. 全文 checkbox  `- [ ]` / `- [x]`
//   B. TODO section 下的 bullet（主路径，日志里 checkbox 极少）

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
}

static RE_CHECKBOX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*[-*+]\s+\[( |x|X)\]\s+(.+)$").unwrap());

static RE_BULLET: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*[-*+]\s+(.+)").unwrap());

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
            Some(ExtractedTask {
                text: caps[2].trim().to_string(),
                done: matches!(&caps[1], "x" | "X"),
                source: "checkbox".to_string(),
                source_line: Some(i as i32 + 1),
            })
        })
        .collect()
}

/// 通道 B：指定 section body 下的所有 bullet
pub fn extract_bullets(body: &str, source: &str) -> Vec<ExtractedTask> {
    body.lines()
        .filter_map(|line| {
            let caps = RE_BULLET.captures(line)?;
            let text = caps[1].trim();
            if text.is_empty() {
                return None;
            }
            // 跳过 checkbox 行（由 extract_checkbox 处理，避免重复提取）
            if RE_CHECKBOX.is_match(line) {
                return None;
            }
            Some(ExtractedTask {
                text: text.to_string(),
                done: false,
                source: source.to_string(),
                source_line: None,
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
}
