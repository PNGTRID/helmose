// ============================================================
// 文档库命令 —— Obsidian 式浏览：目录树 + 列表 + 单篇预览
// 设计要点：
//   1. 列表/树只返回元数据（NoteMeta），不带正文 → 1.9 万文件不爆 IPC
//   2. 单篇预览才取全文，并由 Rust 端 pulldown-cmark 渲染成 HTML
//   3. 排除目录与 index.rs 保持一致，树视图 = 索引视图
// ============================================================

use crate::models::{NoteContent, NoteMeta};
use crate::services::Database;
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::params;
use std::path::{Path, PathBuf};
use tauri::State;
use walkdir::WalkDir;

/// 与 index.rs 一致的排除目录（隐藏目录 + 体积大的备份目录）
const EXCLUDE_DIRS: &[&str] = &["6-原始资料", "专家团"];

/// 路径是否落在排除目录下（隐藏目录 + 备份大目录）
fn is_excluded(path: &Path, root: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    for comp in rel.components() {
        if let Some(name) = comp.as_os_str().to_str() {
            if name.starts_with('.') {
                return true;
            }
            if EXCLUDE_DIRS.contains(&name) {
                return true;
            }
        }
    }
    false
}

fn vault_root(vault_id: &str, db: &Database) -> Result<PathBuf, String> {
    let path = db
        .sqlite()
        .query_row(
            "SELECT root_path FROM vaults WHERE id = ?1",
            params![vault_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("vault {} not found", vault_id))?;
    Ok(PathBuf::from(path))
}

/// 列出 vault 的所有目录（相对路径，扁平），供前端构建 Obsidian 式文件树。
/// 根目录用空串 "" 表示。排除隐藏目录 + 大目录（与索引一致）。
#[tauri::command]
pub fn list_dirs(vault_id: String, db: State<'_, Database>) -> Result<Vec<String>, String> {
    let root = vault_root(&vault_id, db.inner())?;
    let mut dirs: Vec<String> = vec![String::new()]; // 根

    for entry in WalkDir::new(&root)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| !is_excluded(e.path(), &root))
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_dir() {
            continue;
        }
        let rel = entry.path().strip_prefix(&root).unwrap_or(entry.path());
        dirs.push(rel.to_string_lossy().replace('\\', "/"));
    }
    Ok(dirs)
}

/// 列出某目录「直接子」的笔记元数据（不含正文），用于文档库中间列表。
/// - `dir_prefix`：相对目录路径，"" 表示 vault 根。
/// - `limit`：截断条数（默认 5000，防止意外超大目录）。
///
/// 直接子 = 去掉 dir_prefix 后路径里不再含 '/'；更深层的文件在其子目录节点下展示。
#[tauri::command]
pub fn list_notes_meta(
    vault_id: String,
    dir_prefix: Option<String>,
    limit: Option<i64>,
    db: State<'_, Database>,
) -> Result<Vec<NoteMeta>, String> {
    let prefix = dir_prefix.unwrap_or_default();
    let prefix_slash = if prefix.is_empty() {
        String::new()
    } else {
        format!("{}/", prefix)
    };

    // 根目录直接用 SQL 过滤顶层；子目录匹配前缀后在 Rust 里过滤直接子
    let mut sql = String::from(
        "SELECT id,rel_path,file_name,title,note_type,date_iso,tags,mtime \
         FROM notes WHERE vault_id = ?1",
    );
    let like = format!("{}%", prefix_slash);
    let mut pv: Vec<&dyn rusqlite::ToSql> = vec![&vault_id];
    if prefix.is_empty() {
        sql.push_str(" AND rel_path NOT LIKE '%/%'");
    } else {
        sql.push_str(" AND rel_path LIKE ?2");
        pv.push(&like);
    }
    sql.push_str(" ORDER BY file_name COLLATE NOCASE");

    let rows = db
        .sqlite()
        .query_map(
            &sql,
            &pv,
            |row| {
                let tags_json: String = row.get("tags")?;
                Ok((
                    row.get::<_, String>("id")?,
                    row.get::<_, String>("rel_path")?,
                    row.get::<_, String>("file_name")?,
                    row.get::<_, Option<String>>("title")?,
                    row.get::<_, Option<String>>("note_type")?,
                    row.get::<_, Option<String>>("date_iso")?,
                    serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default(),
                    row.get::<_, i64>("mtime")?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let max = limit.unwrap_or(5000) as usize;
    let mut out: Vec<NoteMeta> = Vec::new();
    for (id, rel_path, file_name, title, note_type, date_iso, tags, mtime) in rows {
        // 直接子判定：去掉 prefix 后不再含 '/'
        let rest = rel_path
            .strip_prefix(&prefix_slash)
            .unwrap_or(&rel_path);
        if rest.contains('/') {
            continue;
        }
        out.push(NoteMeta {
            id,
            rel_path,
            file_name,
            title,
            note_type,
            date_iso,
            tags,
            mtime,
        });
        if out.len() >= max {
            break;
        }
    }
    Ok(out)
}

/// 列出 vault 所有笔记的轻量元数据（无正文——性能红线只禁 raw_content 全文，
/// 元数据允许）。供前端一次性构建完整目录+文件树（Obsidian 式混合树）。
/// 约 1.9 万条 ~3MB，启动/刷新时一次 IPC，桌面单用户可接受。
#[tauri::command]
pub fn list_all_notes_meta(
    vault_id: String,
    db: State<'_, Database>,
) -> Result<Vec<NoteMeta>, String> {
    let rows = db
        .sqlite()
        .query_map(
            "SELECT id,rel_path,file_name,title,note_type,date_iso,tags,mtime \
             FROM notes WHERE vault_id = ?1 ORDER BY file_name COLLATE NOCASE",
            params![vault_id],
            |row| {
                let tags_json: String = row.get("tags")?;
                Ok(NoteMeta {
                    id: row.get("id")?,
                    rel_path: row.get("rel_path")?,
                    file_name: row.get("file_name")?,
                    title: row.get("title")?,
                    note_type: row.get("note_type")?,
                    date_iso: row.get("date_iso")?,
                    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                    mtime: row.get("mtime")?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 取单篇笔记正文 + pulldown-cmark 渲染的 HTML（预览面板用）。
#[tauri::command]
pub fn get_note_content(
    note_id: String,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    let row = db
        .sqlite()
        .query_row(
            "SELECT id,rel_path,title,raw_content FROM notes WHERE id = ?1",
            params![note_id],
            |row| {
                Ok((
                    row.get::<_, String>("id")?,
                    row.get::<_, String>("rel_path")?,
                    row.get::<_, Option<String>>("title")?,
                    row.get::<_, Option<String>>("raw_content")?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("note {} not found", note_id))?;

    let raw_content = row.3.unwrap_or_default();
    let html = render_markdown(&raw_content);

    Ok(NoteContent {
        id: row.0,
        rel_path: row.1,
        title: row.2,
        raw_content,
        html,
    })
}

/// 保存笔记内容（写回 vault md 原文 + 自动备份 + 增量重索引）。
/// 写前把原文件备份到 <vault>/.helmose/backup/（隐藏目录，不索引），保护原文。
/// 注：本命令写 vault 原文——用户明确点「保存」触发，带备份保护。
#[tauri::command]
pub fn save_note_content(
    note_id: String,
    content: String,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    use crate::services::indexer::incremental;

    // 1. 查 note 所属 vault + 相对路径
    let row = db
        .sqlite()
        .query_row(
            "SELECT n.rel_path, v.root_path, v.id \
             FROM notes n JOIN vaults v ON v.id = n.vault_id WHERE n.id = ?1",
            params![note_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("note {} not found", note_id))?;
    let (rel_path, root_path, vault_id) = row;
    let root = PathBuf::from(&root_path);
    let abs = root.join(&rel_path);

    // 2. 备份原文件（若存在）
    if abs.exists() {
        let backup_dir = root.join(".helmose").join("backup");
        let _ = std::fs::create_dir_all(&backup_dir);
        let safe_name = rel_path.replace('/', "_");
        let ts = crate::utils::dates::now_iso8601().replace(':', "-");
        let backup_path = backup_dir.join(format!("{}.{}.md", safe_name, ts));
        let _ = std::fs::copy(&abs, &backup_path);
    }

    // 3. 确保父目录存在，写新内容到 vault 原文
    if let Some(parent) = abs.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&abs, &content).map_err(|e| e.to_string())?;

    // 4. 增量重索引（notes + FTS + tasks + links 同步更新）
    incremental::upsert_rel(db.inner(), &vault_id, &rel_path, &content, Some(&abs))
        .map_err(|e| e.to_string())?;

    // 5. 返回最新 NoteContent（重新渲染 HTML）
    let html = render_markdown(&content);
    Ok(NoteContent {
        id: note_id,
        rel_path,
        title: None, // 编辑后标题可能变，前端用 selected 显示
        raw_content: content,
        html,
    })
}

/// 反向链接：哪些笔记的 [[wikilink]] 指向了本笔记（links.target_note_id = note_id）。
#[tauri::command]
pub fn get_backlinks(
    note_id: String,
    db: State<'_, Database>,
) -> Result<Vec<crate::models::Backlink>, String> {
    use crate::models::Backlink;
    let rows = db
        .sqlite()
        .query_map(
            "SELECT n.id, n.rel_path, n.file_name, n.title, n.note_type, n.date_iso, n.tags, \
                    l.target_text, l.alias \
             FROM links l JOIN notes n ON n.id = l.source_note_id \
             WHERE l.target_note_id = ?1 \
             ORDER BY n.date_iso DESC",
            params![note_id],
            |row| {
                let tags_json: String = row.get("tags")?;
                Ok(Backlink {
                    source: NoteMeta {
                        id: row.get("id")?,
                        rel_path: row.get("rel_path")?,
                        file_name: row.get("file_name")?,
                        title: row.get("title")?,
                        note_type: row.get("note_type")?,
                        date_iso: row.get("date_iso")?,
                        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                        mtime: 0,
                    },
                    target_text: row.get("target_text")?,
                    alias: row.get("alias")?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 图谱数据：双链关系（nodes + edges），按连接度数取 top N 防超大库卡前端。
#[tauri::command]
pub fn get_graph_data(
    vault_id: String,
    limit: Option<i64>,
    db: State<'_, Database>,
) -> Result<crate::models::GraphData, String> {
    use crate::models::{GraphData, GraphEdge, GraphNode};
    use std::collections::{HashMap, HashSet};

    let max = limit.unwrap_or(1000) as usize;

    // 所有已解析的正向链接
    let raw_edges: Vec<(String, String)> = db
        .sqlite()
        .query_map(
            "SELECT source_note_id, target_note_id FROM links \
             WHERE vault_id = ?1 AND target_note_id IS NOT NULL",
            params![vault_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?;

    // 按度数取 top N 节点
    let mut degree: HashMap<String, usize> = HashMap::new();
    for (s, t) in &raw_edges {
        *degree.entry(s.clone()).or_insert(0) += 1;
        *degree.entry(t.clone()).or_insert(0) += 1;
    }
    let mut ranked: Vec<(String, usize)> = degree.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1));
    let keep: HashSet<String> = ranked.into_iter().take(max).map(|(id, _)| id).collect();

    let edges: Vec<GraphEdge> = raw_edges
        .iter()
        .filter(|(s, t)| keep.contains(s) && keep.contains(t))
        .map(|(s, t)| GraphEdge {
            source: s.clone(),
            target: t.clone(),
        })
        .collect();

    // 节点元数据（动态 IN 查询）
    let nodes: Vec<GraphNode> = if keep.is_empty() {
        Vec::new()
    } else {
        let ids: Vec<String> = keep.into_iter().collect();
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let mut pv: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len());
        for id in &ids {
            pv.push(id as &dyn rusqlite::ToSql);
        }
        let sql = format!(
            "SELECT id, COALESCE(title, file_name), note_type FROM notes WHERE id IN ({})",
            placeholders
        );
        db.sqlite()
            .query_map(&sql, &pv, |row| {
                Ok(GraphNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    note_type: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
    };

    Ok(GraphData { nodes, edges })
}

/// pulldown-cmark 渲染 md → HTML（启用 GFM 表格 / 任务列表 / 删除线）。
/// 渲染前先预处理 wikilink `[[x]]` 为可点 <a>（见 render_wikilinks）。
fn render_markdown(md: &str) -> String {
    use pulldown_cmark::{html, Options, Parser};

    let md = render_wikilinks(md);
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_STRIKETHROUGH);

    let parser = Parser::new_ext(&md, opts);
    let mut out = String::with_capacity(md.len().saturating_mul(2));
    html::push_html(&mut out, parser);
    out
}

// wikilink 渲染正则：[[target]] / [[target|alias]]（与 indexer/wikilinks.rs 同口径）
static RE_WIKILINK_RENDER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap());

/// HTML 属性值转义（防注入 / 防破坏 data-target 引号）
fn esc_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

/// HTML 文本转义
fn esc_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// 把正文里的 wikilink `[[x]]` / `[[x|y]]` 预处理为可点 `<a>`（带 data-target）。
/// 跳过 ``` / ~~~ fenced code block（代码里的字面 [[x]] 不应变链接）。
/// pulldown-cmark 默认透传 inline HTML，故替换后再走 markdown 渲染即可。
fn render_wikilinks(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    let mut in_fence = false;
    for line in md.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            out.push_str(line);
            out.push('\n');
            continue;
        }
        if in_fence {
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let replaced = RE_WIKILINK_RENDER.replace_all(line, |caps: &regex::Captures| {
            let target = caps[1].split('#').next().unwrap_or("").trim();
            if target.is_empty() {
                return caps[0].to_string(); // 原样保留（如 [[#anchor]]）
            }
            let alias = caps.get(2).map(|m| m.as_str().trim()).unwrap_or(target);
            format!(
                "<a class=\"helmose-wikilink\" data-target=\"{}\">{}</a>",
                esc_attr(target),
                esc_html(alias)
            )
        });
        out.push_str(&replaced);
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wikilink_basic_replaced() {
        let s = render_wikilinks("见 [[袁锐钦]] 和 [[Picboil|出海工具]]");
        assert!(s.contains("data-target=\"袁锐钦\""));
        assert!(s.contains("data-target=\"Picboil\""));
        assert!(s.contains(">出海工具<")); // alias 作为显示文本
    }

    #[test]
    fn wikilink_skipped_in_code_fence() {
        let s = render_wikilinks("正文 [[x]]\n```\n代码 [[y]]\n```\n尾 [[z]]");
        assert!(s.contains("data-target=\"x\""));
        assert!(!s.contains("data-target=\"y\"")); // 代码块内不替换
        assert!(s.contains("data-target=\"z\""));
    }

    #[test]
    fn markdown_renders_wikilink_as_link() {
        let html = render_markdown("见 [[袁锐钦]]");
        assert!(html.contains("helmose-wikilink"));
        assert!(html.contains("data-target=\"袁锐钦\""));
    }
}
