// wikilink [[target]] / [[target|alias]] / [[target#anchor]] 提取
// 注意：悬挂（target 文件不存在）不是错误，是"意图"，由 commands 层标 is_dangling

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ExtractedLink {
    pub target: String,
    pub alias: Option<String>,
}

static RE_WIKILINK: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap());

pub fn extract(content: &str) -> Vec<ExtractedLink> {
    RE_WIKILINK
        .captures_iter(content)
        .filter_map(|caps| {
            let raw = caps[1].trim();
            // 去掉 # 锚点
            let target = raw.split('#').next().unwrap_or("").trim();
            if target.is_empty() {
                return None;
            }
            Some(ExtractedLink {
                target: target.to_string(),
                alias: caps.get(2).map(|m| m.as_str().trim().to_string()),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_link() {
        let v = extract("见 [[袁锐钦]] 和 [[白墨打印工厂]]");
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].target, "袁锐钦");
    }

    #[test]
    fn link_with_alias_and_anchor() {
        let v = extract("[[Picboil|出海工具]] [[2026-04-01#概述]]");
        assert_eq!(v[0].target, "Picboil");
        assert_eq!(v[0].alias.as_deref(), Some("出海工具"));
        assert_eq!(v[1].target, "2026-04-01"); // 锚点已去
    }
}
