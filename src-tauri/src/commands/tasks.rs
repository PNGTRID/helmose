// 任务查询命令

use crate::models::Task;
use crate::services::Database;
use tauri::State;

fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
    let done: i64 = row.get("done")?;
    Ok(Task {
        id: row.get("id")?,
        note_id: row.get("note_id")?,
        vault_id: row.get("vault_id")?,
        text: row.get("text")?,
        done: done != 0,
        due_date: row.get("due_date")?,
        source: row.get("source")?,
        source_line: row.get("source_line")?,
        project_id: row.get("project_id")?,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
    })
}

/// 查询任务（可按 done 筛选）
#[tauri::command]
pub fn get_tasks(
    vault_id: String,
    done: Option<bool>,
    limit: Option<i64>,
    db: State<'_, Database>,
) -> Result<Vec<Task>, String> {
    let mut sql = String::from(
        "SELECT id,note_id,vault_id,text,done,due_date,source,source_line,project_id,created_at,completed_at \
         FROM tasks WHERE vault_id = ?1",
    );
    let params_vec: Vec<&dyn rusqlite::ToSql> = vec![&vault_id];
    if let Some(d) = done {
        // done 是 bool→0/1，直接拼数字（无注入风险，避免借用生命周期问题）
        sql.push_str(&format!(" AND done = {}", if d { 1 } else { 0 }));
    }
    sql.push_str(" ORDER BY done ASC, due_date ASC, created_at DESC");
    if let Some(l) = limit {
        sql.push_str(&format!(" LIMIT {}", l));
    }

    let rows = db
        .sqlite()
        .query_map(&sql, &params_vec, row_to_task)
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
