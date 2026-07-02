// OKR 查询命令（M1.1）
//
// 数据来源：indexer/okrs.rs 在全量索引时填入 okrs 表（strategy/project 文档的 KR section）。
// 性能红线：只回 OKR 元数据（objective/kr_text/target/current 等），不含笔记正文。

use crate::models::Okr;
use crate::services::Database;
use tauri::State;

fn row_to_okr(row: &rusqlite::Row) -> rusqlite::Result<Okr> {
    Ok(Okr {
        id: row.get("id")?,
        vault_id: row.get("vault_id")?,
        source_note_id: row.get("source_note_id")?,
        quarter: row.get("quarter")?,
        objective: row.get("objective")?,
        priority: row.get("priority")?,
        kr_text: row.get("kr_text")?,
        target_value: row.get("target_value")?,
        current_value: row.get("current_value")?,
        raw_row: row.get("raw_row")?,
    })
}

/// 查询 OKR 核心逻辑（可被集成测试直接调用，绕过 Tauri State）。
/// 可按 quarter 过滤；排序：quarter DESC（NULL 末尾）→ priority P0 在前。
pub fn list_okrs_inner(
    vault_id: &str,
    quarter: Option<&str>,
    db: &Database,
) -> Result<Vec<Okr>, String> {
    let mut sql = String::from(
        "SELECT id,vault_id,source_note_id,quarter,objective,priority,kr_text,target_value,current_value,raw_row \
         FROM okrs WHERE vault_id = ?1",
    );
    let mut pv: Vec<&dyn rusqlite::ToSql> = vec![&vault_id];
    // quarter 转成 owned String，避免 Some(q) 的局部借用活不过 pv 的使用点
    let q_owned = quarter.map(|s| s.to_string());
    if let Some(ref q) = q_owned {
        sql.push_str(" AND quarter = ?2");
        pv.push(q);
    }
    // priority 是 P0/P1/P2/P3 字符串，字典序恰好 P0<P1<...，ASC 即「P0 在前」。
    // quarter 通常 "2026Q3"，DESC 让最新季度排前；NULL 在 SQLite DESC 下排末尾（符合预期）。
    sql.push_str(" ORDER BY quarter DESC, priority ASC");
    let rows = db
        .sqlite()
        .query_map(&sql, &pv, row_to_okr)
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 查询 OKR（命令壳）：State 解包 + 转调 list_okrs_inner，行为零变化。
#[tauri::command]
pub fn list_okrs(
    vault_id: String,
    quarter: Option<String>,
    db: State<'_, Database>,
) -> Result<Vec<Okr>, String> {
    list_okrs_inner(&vault_id, quarter.as_deref(), db.inner())
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

    /// 全量索引后 okrs 表写入：strategy 文档含 KR section → 2 行；list_okrs 正确返回。
    #[test]
    fn list_okrs_从索引读取() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(
            vault_dir.join("战略.md"),
            "---\ntitle: 2026 战略\ntype: strategy\npriority: 90\nquarter: 2026Q3\n---\n# 2026 战略\n\n## 关键结果\n- KR1 收入达成 1000 万，当前 600 万\n- KR2 用户目标 5000，当前 3500\n",
        ).unwrap();
        // 非 strategy/project 不入 okrs（验门禁）
        std::fs::write(
            vault_dir.join("经历.md"),
            "---\ntype: experience\n---\n# 经历\n## 关键结果\n- KR 目标 100 当前 50\n",
        ).unwrap();

        index_vault_inner(&vid, &db).unwrap();

        // list_okrs 默认返回全部（无 quarter 过滤）
        let okrs = list_okrs_inner(&vid, None, &db).expect("list_okrs 应成功");
        assert_eq!(okrs.len(), 2, "应只写入 strategy 文档的 2 个 KR");
        assert!(okrs.iter().all(|o| o.priority == "P0"), "priority=90 → P0");
        assert!(okrs.iter().all(|o| o.quarter.as_deref() == Some("2026Q3")));
        // 数值字段非空
        let kr1 = okrs
            .iter()
            .find(|o| o.kr_text.as_deref().unwrap_or("").contains("KR1"))
            .expect("应有 KR1");
        assert_eq!(kr1.target_value.as_deref(), Some("1000 万"));
        assert_eq!(kr1.current_value.as_deref(), Some("600 万"));

        // quarter 过滤命中
        let q3 = list_okrs_inner(&vid, Some("2026Q3"), &db).unwrap();
        assert_eq!(q3.len(), 2);
        // quarter 过滤未命中
        let q4 = list_okrs_inner(&vid, Some("2027Q1"), &db).unwrap();
        assert!(q4.is_empty(), "2027Q1 无 OKR");
        let _ = &_tmp;
    }
}
