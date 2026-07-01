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

/// 查询项目（可按 status / by_mainline 筛选；排序：主线置顶 → priority 降序 → 最近活跃优先）。
/// `by_priority` 预留位（排序已含 priority 降序，参数本身当前不影响 SQL，供前端语义对齐）。
#[tauri::command]
pub fn get_projects(
    vault_id: String,
    status: Option<String>,
    by_mainline: Option<bool>,
    by_priority: Option<bool>,
    db: State<'_, Database>,
) -> Result<Vec<Project>, String> {
    let mut sql = String::from(
        "SELECT id,vault_id,note_id,name,status,priority,is_mainline,okr_priority,home_rel_path,last_activity \
         FROM projects WHERE vault_id = ?1",
    );
    let mut pv: Vec<&dyn rusqlite::ToSql> = vec![&vault_id];
    let mut pi = 2; // 下一个参数位
    if let Some(ref s) = status {
        sql.push_str(&format!(" AND status = ?{}", pi));
        pv.push(s);
        pi += 1;
    }
    if let Some(true) = by_mainline {
        // is_mainline 是 0/1 整数，直接拼常量（无注入风险）
        sql.push_str(" AND is_mainline = 1");
    }
    // 排序：主线置顶 → priority 降序（SQLite DESC 时 NULL 末尾，符合预期）→ 最近活跃优先（NULL 末尾）
    sql.push_str(" ORDER BY is_mainline DESC, priority DESC, last_activity DESC");
    let _ = by_priority; // 预留：排序已覆盖 priority，参数不影响 SQL
    let _ = pi;
    let rows = db
        .sqlite()
        .query_map(&sql, &pv, row_to_project)
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
