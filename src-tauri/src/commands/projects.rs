// 项目查询命令
use crate::models::Project;
use crate::services::Database;
use tauri::State;

fn row_to_project(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    let is_main: i64 = row.get("is_mainline")?;
    Ok(Project {
        id: row.get("id")?,
        vault_id: row.get("vault_id")?,
        note_id: row.get("note_id")?,
        name: row.get("name")?,
        status: row.get("status")?,
        priority: row.get("priority")?,
        is_mainline: is_main != 0,
        okr_priority: row.get("okr_priority")?,
        home_rel_path: row.get("home_rel_path")?,
        last_activity: row.get("last_activity")?,
    })
}

/// 查询项目（可按 status 筛选，按名称排序）
#[tauri::command]
pub fn get_projects(
    vault_id: String,
    status: Option<String>,
    db: State<'_, Database>,
) -> Result<Vec<Project>, String> {
    let mut sql = String::from(
        "SELECT id,vault_id,note_id,name,status,priority,is_mainline,okr_priority,home_rel_path,last_activity \
         FROM projects WHERE vault_id = ?1",
    );
    let mut pv: Vec<&dyn rusqlite::ToSql> = vec![&vault_id];
    if let Some(ref s) = status {
        sql.push_str(" AND status = ?2");
        pv.push(s);
    }
    sql.push_str(" ORDER BY name COLLATE NOCASE");
    let rows = db
        .sqlite()
        .query_map(&sql, &pv, row_to_project)
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
