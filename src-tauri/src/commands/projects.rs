// 项目查询命令
use crate::models::{Project, ProjectProgress};
use crate::services::Database;
use rusqlite::params;
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
        owner: row.get("owner")?,
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
        "SELECT id,vault_id,note_id,name,status,priority,is_mainline,okr_priority,home_rel_path,last_activity,owner \
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

/// M5：项目进度聚合核心逻辑（可被集成测试直接调用，绕过 Tauri State）。
/// 运行时聚合（不入 frontmatter，不污染 vault）。
/// 按 tasks.project_id GROUP BY，统计每个项目的 total / done（status='done'）/ due_overdue（due_date < 今天 且 status!='done'）。
pub fn get_project_progress_inner(
    vault_id: &str,
    db: &Database,
) -> Result<Vec<ProjectProgress>, String> {
    let today = crate::utils::dates::today_iso();
    let sql = "\
        SELECT p.id, p.name, \
               COUNT(t.id) AS total, \
               SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS done_cnt, \
               SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date < ?2 AND t.status<>'done' THEN 1 ELSE 0 END) AS overdue \
        FROM projects p \
        LEFT JOIN tasks t ON t.project_id = p.id \
        WHERE p.vault_id = ?1 \
        GROUP BY p.id, p.name";
    let rows = db
        .sqlite()
        .query_map(sql, params![vault_id, today], |r| {
            Ok(ProjectProgress {
                project_id: r.get::<_, String>(0)?,
                name: r.get::<_, String>(1)?,
                total: r.get::<_, i64>(2)?,
                done: r.get::<_, i64>(3)?,
                due_overdue: r.get::<_, i64>(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// M5：项目进度聚合（命令壳）。前端 ProgressView 触发。
#[tauri::command]
pub fn get_project_progress(
    vault_id: String,
    db: State<'_, Database>,
) -> Result<Vec<ProjectProgress>, String> {
    get_project_progress_inner(&vault_id, db.inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::index::index_vault_inner;

    /// 临时 vault + DB + 注册 vault（TempDir RAII：drop 自动清理 vault_dir + db，零残留）。
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

    /// owner 提取：frontmatter.owner 写入 → projects.owner 列读出。
    #[test]
    fn owner_从frontmatter提取写库() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(
            vault_dir.join("项目A.md"),
            "---\ntitle: 项目A\ntype: project\nowner: 张三\ntags: [project-status:active]\n---\n# 项目A\n",
        )
        .unwrap();
        // 无 owner 的项目（验 None）
        std::fs::write(
            vault_dir.join("项目B.md"),
            "---\ntitle: 项目B\ntype: project\ntags: [project-status:active]\n---\n# 项目B\n",
        )
        .unwrap();

        index_vault_inner(&vid, &db).unwrap();

        // A: owner == Some("张三")
        let owner_a: Option<String> = db
            .sqlite()
            .query_row(
                "SELECT owner FROM projects WHERE name='项目A'",
                &[],
                |r| r.get::<_, Option<String>>(0),
            )
            .unwrap()
            .unwrap();
        assert_eq!(owner_a.as_deref(), Some("张三"), "项目A owner 应为 Some(\"张三\")");

        // B: owner == None
        let owner_b: Option<String> = db
            .sqlite()
            .query_row(
                "SELECT owner FROM projects WHERE name='项目B'",
                &[],
                |r| r.get::<_, Option<String>>(0),
            )
            .unwrap()
            .unwrap();
        assert!(owner_b.is_none(), "项目B owner 应为 None");
        let _ = &_tmp; // _tmp（TempDir）drop 自动清理 vault_dir + db
    }

    /// 进度聚合：2 项目 + 任务笔记 frontmatter.project 关联 → total/done/due_overdue 正确。
    /// indexer 按 frontmatter.project 真实回填 tasks.project_id（不再手工 SQL 伪装）。
    #[test]
    fn progress_聚合total_done_overdue() {
        let (_tmp, vid, vault_dir, db) = setup();
        // 项目 P1（type:project 触发 projects 行）
        std::fs::write(
            vault_dir.join("P1.md"),
            "---\ntitle: P1\ntype: project\ntags: [project-status:active]\n---\n# P1\n",
        )
        .unwrap();
        // 项目 P2
        std::fs::write(
            vault_dir.join("P2.md"),
            "---\ntitle: P2\ntype: project\ntags: [project-status:active]\n---\n# P2\n",
        )
        .unwrap();
        // 任务笔记：frontmatter.project 关联到项目（indexer 据此回填 tasks.project_id）
        //   P1 下：2 个 task（1 done、1 overdue 未完成）
        std::fs::write(
            vault_dir.join("tasks_p1.md"),
            "---\nproject: P1\n---\n# T\n\n- [x] 完成A\n- [ ] 逾期A 📅 2020-01-01\n",
        )
        .unwrap();
        //   P2 下：1 个 task（todo 未逾期）
        std::fs::write(
            vault_dir.join("tasks_p2.md"),
            "---\nproject: P2\n---\n# T\n\n- [ ] 待办B\n",
        )
        .unwrap();

        index_vault_inner(&vid, &db).unwrap();

        // indexer 已按 frontmatter.project 真实回填 tasks.project_id，直接调聚合验真实链路。
        let mut prog = get_project_progress_inner(&vid, &db).unwrap();
        prog.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(prog.len(), 2, "应有 2 个项目的进度");

        // P1：total=2 / done=1 / overdue=1（逾期A due_date=2020-01-01 < 今天 且 未完成）
        let p1 = prog.iter().find(|p| p.name == "P1").unwrap();
        assert_eq!(p1.total, 2, "P1 total（frontmatter.project 关联生效）");
        assert_eq!(p1.done, 1, "P1 done");
        assert_eq!(p1.due_overdue, 1, "P1 overdue（逾期A 未完成且 due<今天）");

        // P2：total=1 / done=0 / overdue=0
        let p2 = prog.iter().find(|p| p.name == "P2").unwrap();
        assert_eq!(p2.total, 1, "P2 total");
        assert_eq!(p2.done, 0, "P2 done");
        assert_eq!(p2.due_overdue, 0, "P2 overdue（待办B 无 due_date）");
        let _ = &_tmp; // _tmp（TempDir）drop 自动清理 vault_dir + db
    }

    /// events.project_id 关联：事件笔记 frontmatter.project → events.project_id 回填（与 tasks 同机制）。
    #[test]
    fn events_project_id_按frontmatter关联() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(
            vault_dir.join("P1.md"),
            "---\ntitle: P1\ntype: project\ntags: [project-status:active]\n---\n# P1\n",
        )
        .unwrap();
        // 事件笔记：frontmatter.project: P1 + 关键事件 section（2 条 bullet）
        std::fs::write(
            vault_dir.join("events_p1.md"),
            "---\nproject: P1\ncreated: 2026-04-01\n---\n# E\n\n## 关键事件\n- 09:00 早会\n- 写了设计文档\n",
        )
        .unwrap();

        index_vault_inner(&vid, &db).unwrap();

        let p1_id: String = db
            .sqlite()
            .query_row("SELECT id FROM projects WHERE name='P1'", &[], |r| r.get(0))
            .unwrap()
            .unwrap();
        let total: i64 = db
            .sqlite()
            .query_row("SELECT COUNT(*) FROM events", &[], |r| r.get(0))
            .unwrap()
            .unwrap_or(0);
        let linked: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM events WHERE project_id = ?1",
                params![&p1_id],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert_eq!(total, 2, "应提取 2 条事件");
        assert_eq!(
            linked, 2,
            "2 条事件都应关联到 P1（frontmatter.project → events.project_id）"
        );
        let _ = &_tmp;
    }
}
