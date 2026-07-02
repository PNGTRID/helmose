// ============================================================
// 解析引擎 —— 分层调度，把 md 文件解析成结构化 ParsedNote
// 关键洞察：wiki 数据按结构化程度分三档（L1/L2/L3），不能用一套解析器硬套
// ============================================================

pub mod events;
pub mod frontmatter;
pub mod incremental;
pub mod okrs;
pub mod projects;
pub mod sections;
pub mod tasks;
pub mod tomorrow;
pub mod wikilinks;

use crate::utils::dates;
use serde::Serialize;
use std::path::Path;

/// 单篇笔记的解析结果（中间结构，待 commands 层写入 SQLite）
#[derive(Debug, Clone, Serialize)]
pub struct ParsedNote {
    pub rel_path: String,
    pub file_name: String,
    pub title: Option<String>,
    pub note_type: Option<String>,
    pub layer: i32,
    pub date_iso: Option<String>,
    pub week_iso: Option<String>,
    pub tags: Vec<String>,
    pub frontmatter: serde_json::Value,
    pub raw_content: String,
    pub mtime: i64,
    pub content_hash: Option<String>,
    pub tasks: Vec<tasks::ExtractedTask>,
    pub wikilinks: Vec<wikilinks::ExtractedLink>,
    pub events: Vec<events::ExtractedEvent>,
    pub tomorrow_sentence: Option<String>,
}

/// 解析单个 md 文件（rel_path 相对 vault 根，content 文件全文，mtime 修改时间）
pub fn parse_file(rel_path: &str, content: &str, mtime: i64) -> ParsedNote {
    let fm = frontmatter::parse(content);
    // note_type / layer 改由规范.md 契约（services::contract）驱动，取代 layers.rs 旧编号硬编码
    let fm_type = fm.data.get("type").and_then(|v| v.as_str());
    let note_type = crate::services::contract::infer_note_type(rel_path, fm_type);
    let layer = crate::services::contract::infer_layer(note_type.as_deref());
    // 带行号切分（events 行级定位用）；tasks/tomorrow 仍用 HashMap（不改其签名）
    let sections_vec = sections::split_sections_with_lines(&fm.content);
    let sections: std::collections::HashMap<String, String> = sections_vec
        .iter()
        .map(|s| (s.name.clone(), s.body.clone()))
        .collect();
    let file_name = file_name_of(rel_path);

    // title: frontmatter.title > H1 > 文件名(去扩展名)
    let title = fm
        .data
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| extract_h1(&fm.content))
        .or_else(|| Some(file_stem_of(&file_name)));

    let tags = extract_tags(&fm.data);

    // date: frontmatter.created > 文件名日期
    let date_iso = fm
        .data
        .get("created")
        .and_then(|v| v.as_str())
        .and_then(|s| dates::normalize_date(s).map(|d| d.to_string()))
        .or_else(|| date_from_filename(rel_path));

    let week_iso = if note_type.as_deref() == Some("weekly") {
        detect_week(rel_path)
    } else {
        None
    };

    // 任务双通道：A 全文 checkbox + B TODO section 下的 bullet
    let mut task_list = tasks::extract_checkbox(&fm.content);
    for (name, body) in &sections {
        if tasks::is_todo_section(name) {
            task_list.extend(tasks::extract_bullets(body, &format!("section:{}", name)));
        }
    }

    let wikilink_list = wikilinks::extract(&fm.content);
    // 事件：从「关键事件 / 事件 / 时间线 / 里程碑」section 提取，event_date 复用 date_iso
    let event_list = events::extract(date_iso.as_deref(), &sections_vec);
    // 明日一句：从「明日一句 / 每日一句」section 提取一句话
    let tomorrow_sentence = tomorrow::extract(&sections);
    // content_hash 在 fm.content move 进 raw_content 之前算好（sha256 规范化正文）
    let content_hash = crate::utils::hash::content_hash(&fm.content);

    ParsedNote {
        rel_path: rel_path.to_string(),
        file_name,
        title,
        note_type,
        layer,
        date_iso,
        week_iso,
        tags,
        frontmatter: fm.data,
        raw_content: fm.content,
        mtime,
        content_hash: Some(content_hash),
        tasks: task_list,
        wikilinks: wikilink_list,
        events: event_list,
        tomorrow_sentence,
    }
}

fn file_name_of(rel_path: &str) -> String {
    Path::new(rel_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn file_stem_of(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.to_string())
}

/// 提取第一个 H1 标题
fn extract_h1(content: &str) -> Option<String> {
    for line in content.lines() {
        let t = line.trim_start();
        if t.starts_with("# ") {
            return Some(t[2..].trim().to_string());
        }
    }
    None
}

/// frontmatter.tags 支持数组或逗号字符串
fn extract_tags(data: &serde_json::Value) -> Vec<String> {
    data.get("tags")
        .and_then(|v| match v {
            serde_json::Value::Array(arr) => Some(
                arr.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect(),
            ),
            serde_json::Value::String(s) => {
                Some(s.split(',').map(|x| x.trim().to_string()).collect())
            }
            _ => None,
        })
        .unwrap_or_default()
}

/// 从文件名提取日期（2026-06-21.md / 2026-06-21-xxx.md → 2026-06-21）
fn date_from_filename(rel_path: &str) -> Option<String> {
    let name = file_name_of(rel_path);
    let re = regex::Regex::new(r"(\d{4}-\d{2}-\d{2})").ok()?;
    let caps = re.captures(&name)?;
    dates::normalize_date(&caps[1]).map(|d| d.to_string())
}

/// 从文件名提取 ISO 周编号（2026-W17.md）
fn detect_week(rel_path: &str) -> Option<String> {
    let name = file_name_of(rel_path);
    let re = regex::Regex::new(r"(\d{4}-W\d{2})").ok()?;
    re.captures(&name).map(|c| c[1].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const L1_SAMPLE: &str = r#"---
title: 2026-04-01 经历
created: 2026-04-01
type: experience
tags: []
---
# 概述
今天做了 X

## 关键事件
- **早会**: 9:00 和团队对齐

## 明日待办
- 跟阿策过 Picboil 落地页
- 设快递账号

## 明日一句
聚焦会员系统
"#;

    const L3_SAMPLE: &str = r#"# 2026-06-21 周日

## 今日待办
- 写代码
- [x] 已完成的事
- [ ] 未完成的事
"#;

    #[test]
    fn parses_with_frontmatter_type() {
        // frontmatter.type=experience → note_type=experience，layer=L3（契约驱动，取代旧 5-经历→L1）
        let p = parse_file(
            "05_个人成长与认知资产/经历/2026-04/2026-04-01.md",
            L1_SAMPLE,
            0,
        );
        assert_eq!(p.layer, 3);
        assert_eq!(p.note_type.as_deref(), Some("experience"));
        assert_eq!(p.title.as_deref(), Some("2026-04-01 经历"));
        assert_eq!(p.date_iso.as_deref(), Some("2026-04-01"));
        // 明日待办 section 下 2 个 bullet（无 checkbox）
        assert_eq!(p.tasks.len(), 2);
        assert_eq!(p.wikilinks.len(), 0);
    }

    #[test]
    fn parses_no_frontmatter_降级默认() {
        // 无 frontmatter.type + 路径不在契约 type→dir 映射 → note_type=None，layer=L2（降级，不报错）
        // 用 07 根下非「日志」子目录（07_.../日志/ 现命中 log type，见 contract 测试）
        let p = parse_file(
            "07_决策与复盘/其他/2026-06-21.md",
            L3_SAMPLE,
            0,
        );
        assert_eq!(p.layer, 2);
        assert_eq!(p.note_type, None);
        assert_eq!(p.date_iso.as_deref(), Some("2026-06-21"));
        // checkbox 全文 2（已完成/未完成）+ 今日待办 section bullet 1（写代码，跳过 checkbox 行）= 3
        assert_eq!(p.tasks.len(), 3);
    }

    /// 对真实 wiki 跑解析（smoke test）：验证引擎对真实数据的鲁棒性 + 统计合理。
    /// 不写库，只解析。可通过 HELMOSE_TEST_VAULT 环境变量指定路径。
    /// #[ignore]：依赖本机 ~/wiki（CI 无此路径）。默认 cargo test 跳过；
    /// 本地 `cargo test -- --ignored` 显式运行；cargo-llvm-cov 默认也不计入。
    #[test]
    #[ignore]
    fn index_real_wiki_smoke() {
        use walkdir::WalkDir;
        use crate::utils::exclude::is_excluded_component; // 复用契约，避免排除规则漂移

        let root =
            std::env::var("HELMOSE_TEST_VAULT").unwrap_or_else(|_| "/Users/yuanruiqin/wiki".into());
        if !Path::new(&root).exists() {
            eprintln!("[smoke] skip: {} 不存在", root);
            return;
        }

        let mut notes = 0usize;
        let mut tasks = 0usize;
        let mut wikilinks = 0usize;
        let mut errors = 0usize;

        for entry in WalkDir::new(&root)
            .into_iter()
            .filter_entry(|e| {
                let rel = e.path().strip_prefix(&root).unwrap_or(e.path());
                rel.components().all(|c| {
                    c.as_os_str()
                        .to_str()
                        .map(|n| !is_excluded_component(n))
                        .unwrap_or(true)
                })
            })
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            if entry.path().extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let rel = match entry.path().strip_prefix(&root) {
                Ok(r) => r.to_string_lossy().to_string(),
                Err(_) => continue,
            };
            let content = match std::fs::read_to_string(entry.path()) {
                Ok(c) => c,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };
            let p = super::parse_file(&rel, &content, 0);
            notes += 1;
            tasks += p.tasks.len();
            wikilinks += p.wikilinks.len();
        }

        println!(
            "[smoke] 真实 wiki 解析：notes={}, tasks={}, wikilinks={}, read_errors={}",
            notes, tasks, wikilinks, errors
        );
        assert!(notes > 100, "预期 >100 篇笔记，实际 {}", notes);
    }
}
