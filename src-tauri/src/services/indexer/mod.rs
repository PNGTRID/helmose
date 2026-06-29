// ============================================================
// 解析引擎 —— 分层调度，把 md 文件解析成结构化 ParsedNote
// 关键洞察：wiki 数据按结构化程度分三档（L1/L2/L3），不能用一套解析器硬套
// ============================================================

pub mod frontmatter;
pub mod incremental;
pub mod layers;
pub mod projects;
pub mod sections;
pub mod tasks;
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
}

/// 解析单个 md 文件（rel_path 相对 vault 根，content 文件全文，mtime 修改时间）
pub fn parse_file(rel_path: &str, content: &str, mtime: i64) -> ParsedNote {
    let fm = frontmatter::parse(content);
    let layer = layers::layer_of(rel_path);
    let note_type = layers::type_of(rel_path, layer);
    let sections = sections::split_sections(&fm.content);
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
        content_hash: None,
        tasks: task_list,
        wikilinks: wikilink_list,
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
    fn parses_l1_experience() {
        let p = parse_file("5-经历/2026-04/2026-04-01.md", L1_SAMPLE, 0);
        assert_eq!(p.layer, 1);
        assert_eq!(p.note_type.as_deref(), Some("experience"));
        assert_eq!(p.title.as_deref(), Some("2026-04-01 经历"));
        assert_eq!(p.date_iso.as_deref(), Some("2026-04-01"));
        // 明日待办 section 下 2 个 bullet（无 checkbox）
        assert_eq!(p.tasks.len(), 2);
        assert_eq!(p.wikilinks.len(), 0);
    }

    #[test]
    fn parses_l3_log() {
        let p = parse_file("0-日志/2026-06/2026-06-21.md", L3_SAMPLE, 0);
        assert_eq!(p.layer, 3);
        assert_eq!(p.note_type.as_deref(), Some("log"));
        assert_eq!(p.date_iso.as_deref(), Some("2026-06-21"));
        // checkbox 全文 2（已完成/未完成）+ 今日待办 section bullet 1（写代码，跳过 checkbox 行）= 3
        assert_eq!(p.tasks.len(), 3);
    }

    /// 对真实 wiki 跑解析（smoke test）：验证引擎对真实数据的鲁棒性 + 统计合理。
    /// 不写库，只解析。可通过 HELMOSE_TEST_VAULT 环境变量指定路径。
    #[test]
    fn index_real_wiki_smoke() {
        use walkdir::WalkDir;

        let root =
            std::env::var("HELMOSE_TEST_VAULT").unwrap_or_else(|_| "/Users/yuanruiqin/wiki".into());
        if !Path::new(&root).exists() {
            eprintln!("[smoke] skip: {} 不存在", root);
            return;
        }

        let exclude = |name: &str| name.starts_with('.') || name == "6-原始资料" || name == "专家团";

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
                        .map(|n| !exclude(n))
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
