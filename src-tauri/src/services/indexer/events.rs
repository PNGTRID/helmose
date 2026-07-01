// 事件提取：从笔记的「关键事件 / 事件 / 时间线 / 里程碑」section 提取 bullet → ExtractedEvent
// event_date 复用笔记 date_iso（parse_file 已算）；event_time 从 bullet 行首 HH:MM 解析。
// 无事件 section 或无 date_iso → 空 Vec（该笔记仍以 dated note 形式进日历，不重复）。

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct ExtractedEvent {
    pub title: Option<String>,
    /// HH:MM 或 HH:MM-HH:MM
    pub event_time: Option<String>,
    /// YYYY-MM-DD（来自笔记 date_iso）
    pub event_date: Option<String>,
    pub content: Option<String>,
    pub output: Option<String>,
    pub raw_bullet: Option<String>,
}

static RE_BULLET: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*[-*+]\s+(.+)").unwrap());
/// 行内时间 HH:MM 或 HH:MM-HH:MM（懒匹配，取第一个）
static RE_TIME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?").unwrap());

const EVENT_SECTION_KEYWORDS: &[&str] = &[
    "关键事件",
    "事件",
    "时间线",
    "里程碑",
    "今日事件",
    "日程",
];

/// section 名是否属于「事件类」
pub fn is_event_section(name: &str) -> bool {
    let n = name.trim();
    EVENT_SECTION_KEYWORDS.iter().any(|k| n.contains(k))
}

/// 从已切分的 sections 提取事件。
/// `date_iso` = 笔记日期（无则事件 event_date 为 None，但仍可提取标题——日历按 date 过滤会跳过）。
pub fn extract(date_iso: Option<&str>, sections: &HashMap<String, String>) -> Vec<ExtractedEvent> {
    let mut out = Vec::new();
    for (name, body) in sections {
        if !is_event_section(name) {
            continue;
        }
        for line in body.lines() {
            let caps = match RE_BULLET.captures(line) {
                Some(c) => c,
                None => continue,
            };
            let raw = caps[1].trim();
            if raw.is_empty() {
                continue;
            }
            let (time, title) = split_time_and_title(raw);
            out.push(ExtractedEvent {
                title: Some(title),
                event_time: time,
                event_date: date_iso.map(|s| s.to_string()),
                content: None,
                output: None,
                raw_bullet: Some(raw.to_string()),
            });
        }
    }
    out
}

/// 从 bullet 文本拆出时间与标题：
///   "**早会**: 9:00 和团队" → (Some("9:00"), "早会 和团队")
///   "9:00-10:00 开周会"     → (Some("9:00-10:00"), "开周会")
///   "写了文档"              → (None, "写了文档")
fn split_time_and_title(raw: &str) -> (Option<String>, String) {
    // 去 **bold** 星号但保留文字
    let no_bold = raw.replace("**", "");
    if let Some(m) = RE_TIME.find(&no_bold) {
        let time = m.as_str().trim().to_string();
        // 去掉时间片段，残留的 : / ： 当分隔符折成空格，再折叠多余空白
        let removed = format!("{}{}", &no_bold[..m.start()], &no_bold[m.end()..]);
        let title: String = removed
            .replace(['：', ':'], " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if title.is_empty() {
            // bullet 仅剩时间（如 "- 9:00"）→ 用原始文本兜底当标题
            (Some(time), raw.trim().to_string())
        } else {
            (Some(time), title)
        }
    } else {
        let title = no_bold
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        (None, title)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 提取关键事件_section_的_bullet() {
        let mut sections = HashMap::new();
        sections.insert(
            "关键事件".to_string(),
            "- **早会**: 9:00 和团队对齐\n- 写了设计文档\n普通段落不算\n".to_string(),
        );
        let ev = extract(Some("2026-04-01"), &sections);
        assert_eq!(ev.len(), 2, "应提取 2 条事件（2 个 bullet）");
        assert_eq!(ev[0].event_date.as_deref(), Some("2026-04-01"));
        assert_eq!(ev[0].event_time.as_deref(), Some("9:00"));
        assert!(ev[0].title.as_deref().unwrap_or("").contains("早会"));
        assert!(ev[1].event_time.is_none(), "第二条无时间");
    }

    #[test]
    fn 时间区间_解析() {
        let mut sections = HashMap::new();
        sections.insert(
            "事件".to_string(),
            "- 9:00-10:00 开周会\n".to_string(),
        );
        let ev = extract(Some("2026-05-01"), &sections);
        assert_eq!(ev[0].event_time.as_deref(), Some("9:00-10:00"));
        assert_eq!(ev[0].title.as_deref(), Some("开周会"));
    }

    #[test]
    fn 非事件section_不提取() {
        let mut sections = HashMap::new();
        sections.insert("明日待办".to_string(), "- 9:00 做事\n".to_string());
        let ev = extract(Some("2026-04-01"), &sections);
        assert!(ev.is_empty(), "明日待办不是事件 section");
    }

    #[test]
    fn section_名匹配() {
        assert!(is_event_section("关键事件"));
        assert!(is_event_section("今日事件"));
        assert!(!is_event_section("明日待办"));
        assert!(!is_event_section("今日待办"));
    }

    #[test]
    fn 无日期_仍提取_但event_date_none() {
        let mut sections = HashMap::new();
        sections.insert("时间线".to_string(), "- 上线 v1\n".to_string());
        let ev = extract(None, &sections);
        assert_eq!(ev.len(), 1);
        assert!(ev[0].event_date.is_none(), "无 date_iso → event_date None");
    }
}
