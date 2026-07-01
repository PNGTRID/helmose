// 事件查询命令

use crate::models::Event;
use crate::services::Database;
use tauri::State;

fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: row.get("id")?,
        note_id: row.get("note_id")?,
        vault_id: row.get("vault_id")?,
        title: row.get("title")?,
        event_time: row.get("event_time")?,
        event_date: row.get("event_date")?,
        content: row.get("content")?,
        output: row.get("output")?,
        project_id: row.get("project_id")?,
        raw_bullet: row.get("raw_bullet")?,
    })
}

/// 查询事件（可按 event_date 区间 [from, to] 过滤，YYYY-MM-DD；按 event_date / event_time 升序）。
/// 无 from/to 返回全部（前端可二次筛选）。性能红线：只回事件元数据，不含笔记正文。
#[tauri::command]
pub fn list_events(
    vault_id: String,
    from: Option<String>,
    to: Option<String>,
    db: State<'_, Database>,
) -> Result<Vec<Event>, String> {
    let mut sql = String::from(
        "SELECT id,note_id,vault_id,title,event_time,event_date,content,output,project_id,raw_bullet \
         FROM events WHERE vault_id = ?1",
    );
    let mut pv: Vec<&dyn rusqlite::ToSql> = vec![&vault_id];
    let mut pi = 2;
    if let Some(ref f) = from {
        sql.push_str(&format!(" AND event_date >= ?{}", pi));
        pv.push(f);
        pi += 1;
    }
    if let Some(ref t) = to {
        sql.push_str(&format!(" AND event_date <= ?{}", pi));
        pv.push(t);
        pi += 1;
    }
    sql.push_str(" ORDER BY event_date ASC, event_time ASC");
    let _ = pi;
    let rows = db
        .sqlite()
        .query_map(&sql, &pv, row_to_event)
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
