// ============================================================
// 全库搜索命令（FTS5 trigram 分词，原生支持中文短语）
// 设计要点：
//   1. 复用 schema 已建好的 notes_fts（contentless，content='notes'）
//   2. 结果只回元数据 + snippet（高亮命中），不带 raw_content 全文（性能红线）
//   3. bm25 排序，JOIN notes 取 vault 过滤与元数据
// ============================================================

use crate::models::{AppResult, SearchResult};
use crate::services::Database;
use rusqlite::params;
use tauri::State;

/// 清洗用户输入为安全的 FTS5 phrase 匹配串。
/// - 移除双引号避免破坏 phrase `"…"` 语法
/// - trigram tokenizer 下，phrase "会员系统" 命中含该连续子串的文档
///
/// 返回值用于 MATCH；空串表示无有效查询（调用方返回空结果）。
fn sanitize_query(q: &str) -> String {
    q.replace('"', "").trim().to_string()
}

/// 全库搜索笔记。
/// - `query`：自然语言短语（中文直接可用）
/// - `limit`：截断条数（默认 50）
/// 返回命中元数据 + snippet（<b> 高亮）+ bm25 rank（越小越相关）。
#[tauri::command]
pub fn search_notes(
    vault_id: String,
    query: String,
    limit: Option<i64>,
    db: State<'_, Database>,
) -> AppResult<Vec<SearchResult>> {
    let q = sanitize_query(&query);
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let match_str = format!("\"{}\"", q);
    let max = limit.unwrap_or(50);

    // snippet 列索引：notes_fts 建表顺序 title(0)/raw_content(1)/tags(2) → 取正文片段
    let rows = db
        .sqlite()
        .query_map(
            "SELECT n.id, n.rel_path, n.file_name, n.title, n.note_type, n.date_iso, n.tags, \
                    snippet(notes_fts, 1, '<b>', '</b>', '…', 16) AS snippet, \
                    bm25(notes_fts) AS rank \
             FROM notes_fts \
             JOIN notes n ON n.rowid = notes_fts.rowid \
             WHERE notes_fts MATCH ?1 AND n.vault_id = ?2 \
             ORDER BY rank \
             LIMIT ?3",
            params![match_str, vault_id, max],
            |row| {
                let tags_json: String = row.get("tags")?;
                Ok(SearchResult {
                    id: row.get("id")?,
                    rel_path: row.get("rel_path")?,
                    file_name: row.get("file_name")?,
                    title: row.get("title")?,
                    note_type: row.get("note_type")?,
                    date_iso: row.get("date_iso")?,
                    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                    snippet: row.get("snippet")?,
                    rank: row.get("rank")?,
                })
            },
        )
        ?;
    Ok(rows)
}
