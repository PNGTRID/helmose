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
        status: row.get("status")?,
        priority: row.get("priority")?,
        urgency: row.get("urgency")?,
        repeat_rule: row.get("repeat_rule")?,
        parent_task_id: row.get("parent_task_id")?,
    })
}

/// 查询任务（可按 done / status / project_id / priority_min 筛选）。
/// done 保留向后兼容（内部转 status：done=true → status='done'，done=false → status<>'done'）。
#[tauri::command]
pub fn get_tasks(
    vault_id: String,
    done: Option<bool>,
    status: Option<String>,
    project_id: Option<String>,
    priority_min: Option<i32>,
    limit: Option<i64>,
    db: State<'_, Database>,
) -> Result<Vec<Task>, String> {
    let mut sql = String::from(
        "SELECT id,note_id,vault_id,text,done,due_date,source,source_line,project_id,created_at,completed_at,status,priority,urgency,repeat_rule,parent_task_id \
         FROM tasks WHERE vault_id = ?1",
    );
    let mut pv: Vec<&dyn rusqlite::ToSql> = vec![&vault_id];
    let mut pi = 2; // 下一个参数位
    if let Some(d) = done {
        // done=true → status='done'；done=false → status<>'done'（含 todo/doing）
        if d {
            sql.push_str(" AND status = 'done'");
        } else {
            sql.push_str(" AND status <> 'done'");
        }
    }
    if let Some(ref s) = status {
        sql.push_str(&format!(" AND status = ?{}", pi));
        pv.push(s);
        pi += 1;
    }
    if let Some(ref pid) = project_id {
        sql.push_str(&format!(" AND project_id = ?{}", pi));
        pv.push(pid);
        pi += 1;
    }
    // priority_min / limit 提到外层 let，使借用生命周期覆盖 query_map 调用
    // （rusqlite::ToSql 对 i32/i64 实现，直接 &pmin 即可）
    if let Some(ref pmin) = priority_min {
        sql.push_str(&format!(" AND priority >= ?{}", pi));
        pv.push(pmin);
        pi += 1;
    }
    let _ = pi;
    sql.push_str(" ORDER BY done ASC, due_date ASC, created_at DESC");
    if let Some(ref l) = limit {
        // LIMIT 用占位符（与项目 SQL 一致；rusqlite 接受 i64 绑定）
        sql.push_str(" LIMIT ?");
        pv.push(l);
    }

    let rows = db
        .sqlite()
        .query_map(&sql, &pv, row_to_task)
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
