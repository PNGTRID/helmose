// 「明日一句」提取：从日志的「明日一句 / 每日一句 / 今日一句」section 提取一句话。
// 存 tomorrow_sentences 表（date_iso + sentence），供 TodayPage 显示「昨日定下的今日寄语」。
// 单条 per note（取 section 第一行非空），区别于 events 的多 bullet。

use std::collections::HashMap;

/// section 名是否属于「明日一句」类
pub fn is_sentence_section(name: &str) -> bool {
    let n = name.trim();
    n.contains("明日一句") || n.contains("每日一句") || n.contains("今日一句")
}

/// 从 sections 提取「明日一句」（首个匹配 section 的第一行非空内容）。无则 None。
pub fn extract(sections: &HashMap<String, String>) -> Option<String> {
    for (name, body) in sections {
        if !is_sentence_section(name) {
            continue;
        }
        for line in body.lines() {
            let s = line.trim();
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 提取明日一句() {
        let mut sections = HashMap::new();
        sections.insert(
            "明日一句".to_string(),
            "聚焦会员系统落地\n（其他说明）\n".to_string(),
        );
        assert_eq!(
            extract(&sections).as_deref(),
            Some("聚焦会员系统落地"),
            "取首个非空行"
        );
    }

    #[test]
    fn 无明日一句section返回none() {
        let mut sections = HashMap::new();
        sections.insert("今日待办".to_string(), "- 做事\n".to_string());
        assert!(extract(&sections).is_none());
    }

    #[test]
    fn section名匹配() {
        assert!(is_sentence_section("明日一句"));
        assert!(is_sentence_section("每日一句"));
        assert!(!is_sentence_section("明日待办"));
    }
}
