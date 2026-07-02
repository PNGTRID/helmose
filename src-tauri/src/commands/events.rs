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
        source_line: row.get("source_line")?,
    })
}

/// 查询事件核心逻辑（可被集成测试直接调用，绕过 Tauri State）。
/// 可按 event_date 区间 [from, to] 过滤（YYYY-MM-DD），按 project_id 过滤；
/// 排序 event_date / event_time 升序。无对应参数返回全部。
/// 性能红线：只回事件元数据，不含笔记正文。
pub fn list_events_inner(
    vault_id: &str,
    from: Option<&str>,
    to: Option<&str>,
    project_id: Option<&str>,
    db: &Database,
) -> Result<Vec<Event>, String> {
    let mut sql = String::from(
        "SELECT id,note_id,vault_id,title,event_time,event_date,content,output,project_id,raw_bullet,source_line \
         FROM events WHERE vault_id = ?1",
    );
    let mut pv: Vec<&dyn rusqlite::ToSql> = vec![&vault_id];
    // 转成 owned String 避免生命周期问题（&str 不能直接转 &dyn ToSql）
    let from_owned = from.map(|s| s.to_string());
    let to_owned = to.map(|s| s.to_string());
    let pid_owned = project_id.map(|s| s.to_string());
    let mut pi = 2;
    if let Some(ref f) = from_owned {
        sql.push_str(&format!(" AND event_date >= ?{}", pi));
        pv.push(f);
        pi += 1;
    }
    if let Some(ref t) = to_owned {
        sql.push_str(&format!(" AND event_date <= ?{}", pi));
        pv.push(t);
        pi += 1;
    }
    if let Some(ref p) = pid_owned {
        sql.push_str(&format!(" AND project_id = ?{}", pi));
        pv.push(p);
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

/// 查询事件（命令壳）：可按 event_date 区间 [from, to] 过滤、按 project_id 过滤。
#[tauri::command]
pub fn list_events(
    vault_id: String,
    from: Option<String>,
    to: Option<String>,
    project_id: Option<String>,
    db: State<'_, Database>,
) -> Result<Vec<Event>, String> {
    list_events_inner(
        &vault_id,
        from.as_deref(),
        to.as_deref(),
        project_id.as_deref(),
        db.inner(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::index::index_vault_inner;
    use rusqlite::params;

    /// 临时 vault + DB + 注册 vault。
    fn setup() -> (tempfile::TempDir, String, std::path::PathBuf, Database) {
        let tmp = tempfile::TempDir::new().unwrap();
        let vid = uuid::Uuid::new_v4().to_string();
        let vault_dir = tmp.path().join(format!("vault_{}", vid));
        std::fs::create_dir_all(&vault_dir).unwrap();
        let db_path = tmp.path().join("test.db");
        let db = Database::new(db_path).unwrap();
        db.init_schema().unwrap();
        db.sqlite()
            .execute(
                "INSERT INTO vaults (id,name,root_path,created_at,indexing_state,is_obsidian_shared,exclude_patterns) \
                 VALUES (?1,'t',?2,'2026-01-01T00:00:00Z','idle',0,'[]')",
                params![vid, vault_dir.to_string_lossy()],
            )
            .unwrap();
        (tmp, vid, vault_dir, db)
    }

    /// M1：bullet 内 #project:名 → events.project_id 行级回填；
    /// list_events 按 project_id 过滤。
    #[test]
    fn events_项目id_行级回填_并可按项目过滤() {
        let (_tmp, vid, vault_dir, db) = setup();
        // 项目 P1 + P2
        std::fs::write(
            vault_dir.join("P1.md"),
            "---\ntitle: P1\ntype: project\ntags: [project-status:active]\n---\n# P1\n",
        )
        .unwrap();
        std::fs::write(
            vault_dir.join("P2.md"),
            "---\ntitle: P2\ntype: project\ntags: [project-status:active]\n---\n# P2\n",
        )
        .unwrap();
        // 事件笔记：bullet 内 #project:P1 行级标记 + #project:P2 行级标记 + 无标签行
        std::fs::write(
            vault_dir.join("events.md"),
            "---\ncreated: 2026-04-01\n---\n# E\n\n## 关键事件\n- 早会 #project:P1\n- 设计评审 #project:P2\n- 普通事件\n",
        )
        .unwrap();

        index_vault_inner(&vid, &db).unwrap();

        let p1_id: String = db
            .sqlite()
            .query_row("SELECT id FROM projects WHERE name='P1'", &[], |r| r.get(0))
            .unwrap()
            .unwrap();
        let p2_id: String = db
            .sqlite()
            .query_row("SELECT id FROM projects WHERE name='P2'", &[], |r| r.get(0))
            .unwrap()
            .unwrap();

        // list_events 按 P1 过滤
        let p1_events = list_events_inner(&vid, None, None, Some(&p1_id), &db).unwrap();
        assert_eq!(p1_events.len(), 1, "P1 应只有 1 条事件");
        assert!(p1_events[0].raw_bullet.as_deref().unwrap_or("").contains("早会"));
        // list_events 按 P2 过滤
        let p2_events = list_events_inner(&vid, None, None, Some(&p2_id), &db).unwrap();
        assert_eq!(p2_events.len(), 1, "P2 应只有 1 条事件");
        // list_events 全部（含无 project 的普通事件）
        let all = list_events_inner(&vid, None, None, None, &db).unwrap();
        assert_eq!(all.len(), 3, "共 3 条事件");
        let _ = &_tmp;
    }
}
