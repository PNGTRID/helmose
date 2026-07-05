// 笔记查询命令

use crate::models::{AppResult, Note};
use crate::services::Database;
use rusqlite::params;
use tauri::State;

fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    let tags_json: String = row.get("tags")?;
    let fm_json: String = row.get("frontmatter")?;
    Ok(Note {
        id: row.get("id")?,
        vault_id: row.get("vault_id")?,
        rel_path: row.get("rel_path")?,
        file_name: row.get("file_name")?,
        title: row.get("title")?,
        note_type: row.get("note_type")?,
        layer: row.get("layer")?,
        date_iso: row.get("date_iso")?,
        week_iso: row.get("week_iso")?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        frontmatter: serde_json::from_str(&fm_json).unwrap_or_default(),
        raw_content: String::new(), // get_notes 不回全文(性能红线:1.9万×全文必爆 IPC);单篇正文用 get_note_content
        mtime: row.get("mtime")?,
        content_hash: row.get("content_hash")?,
    })
}

/// 查询笔记（可按 note_type 筛选，按日期倒序）
#[tauri::command]
pub fn get_notes(
    vault_id: String,
    note_type: Option<String>,
    limit: Option<i64>,
    db: State<'_, Database>,
) -> AppResult<Vec<Note>> {
    // 全部用位置占位符「?」按 params_vec 顺序绑定（避免 format! 拼数字造成的注入破窗，
    // 也避免 ?N 显式编号在可选参数下错位）。
    let mut sql = String::from(
        "SELECT id,vault_id,rel_path,file_name,title,note_type,layer,date_iso,week_iso,tags,frontmatter,mtime,content_hash \
         FROM notes WHERE vault_id = ?",
    );
    let mut params_vec: Vec<&dyn rusqlite::ToSql> = vec![&vault_id];
    if let Some(ref t) = note_type {
        sql.push_str(" AND note_type = ?");
        params_vec.push(t);
    }
    sql.push_str(" ORDER BY date_iso DESC");
    if let Some(ref l) = limit {
        sql.push_str(" LIMIT ?");
        params_vec.push(l);
    }

    let rows = db
        .sqlite()
        .query_map(&sql, &params_vec, row_to_note)
        ?;
    Ok(rows)
}

/// 统计：各类型笔记数量
#[tauri::command]
pub fn get_notes_stats(vault_id: String, db: State<'_, Database>) -> AppResult<serde_json::Value> {
    let rows = db
        .sqlite()
        .query_map(
            "SELECT COALESCE(note_type,'(none)') AS t, COUNT(*) AS c FROM notes WHERE vault_id = ?1 GROUP BY note_type",
            params![vault_id],
            |row| {
                let t: String = row.get("t")?;
                let c: i64 = row.get("c")?;
                Ok((t, c))
            },
        )
        ?;
    let mut map = serde_json::Map::new();
    for (t, c) in rows {
        map.insert(t, serde_json::Value::from(c));
    }
    Ok(serde_json::Value::Object(map))
}

/// 统计所有 tags 出现次数（按次数倒序），供标签侧栏。
/// tags 在 notes 表存为 JSON 数组，SQL 难直接聚合，由 Rust 端聚合（只读 tags 列，轻量）。
#[tauri::command]
pub fn get_tags_stats(
    vault_id: String,
    db: State<'_, Database>,
) -> AppResult<Vec<(String, i64)>> {
    use std::collections::HashMap;

    let rows = db
        .sqlite()
        .query_map(
            "SELECT tags FROM notes WHERE vault_id = ?1",
            params![vault_id],
            |r| r.get::<_, String>(0),
        )
        ?;
    let mut counts: HashMap<String, i64> = HashMap::new();
    for tags_json in rows {
        if let Ok(tags) = serde_json::from_str::<Vec<String>>(&tags_json) {
            for t in tags {
                let t = t.trim();
                if !t.is_empty() {
                    *counts.entry(t.to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    let mut sorted: Vec<(String, i64)> = counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(sorted)
}
