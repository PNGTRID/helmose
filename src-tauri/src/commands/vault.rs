// Vault 命令：onboarding 选择/新建 vault，列出已注册 vault

use crate::models::{AppResult, IndexingState, Vault, VaultInput};
use crate::services::Database;
use crate::utils::dates;
use rusqlite::params;
use std::fs;
use tauri::{AppHandle, Manager, State};

fn default_excludes() -> Vec<String> {
    vec![
        ".obsidian".into(),
        ".trash".into(),
        ".helmose".into(),
        ".git".into(),
        ".DS_Store".into(),
        "node_modules".into(),
    ]
}

fn parse_state(s: &str) -> IndexingState {
    match s {
        "scanning" => IndexingState::Scanning,
        "parsing" => IndexingState::Parsing,
        "error" => IndexingState::Error,
        _ => IndexingState::Idle,
    }
}

fn row_to_vault(row: &rusqlite::Row) -> rusqlite::Result<Vault> {
    let state_str: String = row.get("indexing_state")?;
    let is_obs: i64 = row.get("is_obsidian_shared")?;
    let exclude_json: String = row.get("exclude_patterns")?;
    Ok(Vault {
        id: row.get("id")?,
        name: row.get("name")?,
        root_path: row.get("root_path")?,
        created_at: row.get("created_at")?,
        last_indexed: row.get("last_indexed")?,
        indexing_state: parse_state(&state_str),
        is_obsidian_shared: is_obs != 0,
        exclude_patterns: serde_json::from_str(&exclude_json).unwrap_or_default(),
    })
}

/// 注册 vault 核心逻辑（可被集成测试直接调用，绕过 Tauri State）。
pub fn add_vault_inner(input: VaultInput, db: &Database) -> AppResult<Vault> {
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = dates::now_iso8601();
    // 检测 Obsidian 共存
    let obsidian_marker = format!("{}/.obsidian", &input.root_path);
    let is_obs = fs::metadata(&obsidian_marker).is_ok();
    let exclude = default_excludes();
    let exclude_json = serde_json::to_string(&exclude)?;

    db.sqlite()
        .execute(
            "INSERT INTO vaults (id,name,root_path,created_at,indexing_state,is_obsidian_shared,exclude_patterns) \
             VALUES (?1,?2,?3,?4,'idle',?5,?6)",
            params![
                id,
                input.name,
                input.root_path,
                created_at,
                if is_obs { 1 } else { 0 },
                exclude_json
            ],
        )
        ?;

    Ok(Vault {
        id,
        name: input.name,
        root_path: input.root_path,
        created_at,
        last_indexed: None,
        indexing_state: IndexingState::Idle,
        is_obsidian_shared: is_obs,
        exclude_patterns: exclude,
    })
}

/// 注册一个 vault（onboarding 调用）。命令壳：State 解包 + 转调 add_vault_inner，行为零变化。
#[tauri::command]
pub fn add_vault(input: VaultInput, db: State<'_, Database>) -> AppResult<Vault> {
    add_vault_inner(input, db.inner())
}

/// 列出所有已注册 vault 核心逻辑（可被集成测试直接调用）。
pub fn list_vaults_inner(db: &Database) -> AppResult<Vec<Vault>> {
    let rows = db
        .sqlite()
        .query_map(
            "SELECT id,name,root_path,created_at,last_indexed,indexing_state,is_obsidian_shared,exclude_patterns \
             FROM vaults ORDER BY created_at DESC",
            &[],
            row_to_vault,
        )
        ?;
    Ok(rows)
}

/// 列出所有已注册 vault。命令壳：State 解包 + 转调 list_vaults_inner。
#[tauri::command]
pub fn list_vaults(db: State<'_, Database>) -> AppResult<Vec<Vault>> {
    list_vaults_inner(db.inner())
}

/// 获取第一个（默认）vault 核心逻辑（可被集成测试直接调用）。
pub fn get_default_vault_inner(db: &Database) -> AppResult<Option<Vault>> {
    let rows = db
        .sqlite()
        .query_map(
            "SELECT id,name,root_path,created_at,last_indexed,indexing_state,is_obsidian_shared,exclude_patterns \
             FROM vaults ORDER BY created_at DESC LIMIT 1",
            &[],
            row_to_vault,
        )
        ?;
    Ok(rows.into_iter().next())
}

/// 获取第一个（默认）vault。命令壳：State 解包 + 转调 get_default_vault_inner。
#[tauri::command]
pub fn get_default_vault(db: State<'_, Database>) -> AppResult<Option<Vault>> {
    get_default_vault_inner(db.inner())
}

/// 删除 vault 核心逻辑（级联清理索引数据，wiki 原文不动；可被集成测试直接调用）。
pub fn delete_vault_inner(vault_id: &str, db: &Database) -> AppResult<()> {
    db.sqlite()
        .transaction(|tx| {
            tx.execute("DELETE FROM tasks WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM links WHERE vault_id = ?1", params![vault_id])?;
            // B7：notes_fts 是 contentless 外部内容表（content='notes'），不随 notes 自动同步。
            // 必须在 DELETE FROM notes 之前清掉对应 FTS 行——否则 notes 行删了、FTS 索引残留成「孤儿」
            //（rowid 在 notes 已不存在，多 vault 反复增删会累积空间泄漏）。contentless 表的标准 DELETE
            // 按 rowid 删索引条目，无需原列值；放在 notes 删除前才能用 notes.rowid 定位。
            tx.execute(
                "DELETE FROM notes_fts WHERE rowid IN (SELECT rowid FROM notes WHERE vault_id = ?1)",
                params![vault_id],
            )?;
            tx.execute("DELETE FROM notes WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM vaults WHERE id = ?1", params![vault_id])?;
            Ok(())
        })?;
    Ok(())
}

/// 删除 vault（级联清理索引数据，wiki 原文不动）。命令壳：State 解包 + 转调 delete_vault_inner。
/// 删的若是当前 watcher 监听的 vault → 停 watcher（防 delete 后旧 watcher 往已清空的库写回）。
#[tauri::command]
pub fn delete_vault(
    vault_id: String,
    db: State<'_, Database>,
    wm: State<'_, crate::services::watcher::WatcherManager>,
) -> AppResult<()> {
    wm.inner().stop_if_watching(&vault_id)?;
    delete_vault_inner(&vault_id, db.inner())
}

/// 重置 Helmose 派生数据核心逻辑（可被集成测试直接调用，绕过 app handle）。
/// DROP 所有派生表（含 vaults 移除注册）→ 重建空 schema。绝不碰 vault 原文。
pub fn reset_db_inner(db: &Database) -> AppResult<()> {
    // 顺序：先 FTS（外部内容表），再业务表；DROP 不受 FK DDL 约束影响，顺序仅稳妥起见。
    for stmt in [
        "DROP TABLE IF EXISTS notes_fts",
        "DROP TABLE IF EXISTS life_state_snapshots",
        "DROP TABLE IF EXISTS tomorrow_sentences",
        "DROP TABLE IF EXISTS links",
        "DROP TABLE IF EXISTS entities",
        "DROP TABLE IF EXISTS okrs",
        "DROP TABLE IF EXISTS events",
        "DROP TABLE IF EXISTS projects",
        "DROP TABLE IF EXISTS tasks",
        "DROP TABLE IF EXISTS notes",
        "DROP TABLE IF EXISTS vaults",
    ] {
        db.sqlite().execute(stmt, &[])?;
    }
    // 重建空 schema（CREATE TABLE IF NOT EXISTS，幂等）
    db.init_schema()?;
    Ok(())
}

/// 重置 Helmose：清 SQLite（DROP 全表 + 重建空 schema，移除 vault 注册）+ 清 app_data_dir/agent 派生导出。
/// 绝不碰 vault 原文（铁律 1）。重置后前端 reload → getDefaultVault 返回 None → 回 Onboarding。
/// 必须先停 watcher：否则 reset 后旧 watcher 仍监听旧 vault，把删除事件当增量往已清空的 DB 写回（数据回潮）。
#[tauri::command]
pub fn reset_app(
    app: AppHandle,
    db: State<'_, Database>,
    wm: State<'_, crate::services::watcher::WatcherManager>,
) -> AppResult<()> {
    wm.inner().stop()?;
    reset_db_inner(db.inner())?;
    // 清 Agent 导出缓存（app_data_dir/agent），目录可能不存在 → 失败不致命
    if let Ok(app_data) = app.path().app_data_dir() {
        let agent_dir = app_data.join("agent");
        let _ = fs::remove_dir_all(&agent_dir);
    }
    Ok(())
}

// ============================================================
// 集成测试：add_vault → list_vaults → delete_vault 往返 + 级联清理
// 真 SQLite + 真临时 FS；pid+uuid 隔离，不依赖 ~/wiki
// ============================================================
#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::index::index_vault_inner;
    use crate::models::VaultInput;

    /// 临时 DB（pid+uuid 唯一隔离）
    fn setup_db() -> Database {
        let db_path = std::env::temp_dir().join(format!(
            "helmose_vault_db_{}_{}.db",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let db = Database::new(db_path).unwrap();
        db.init_schema().unwrap();
        db
    }

    #[test]
    fn add_list_delete_vault_cascades() {
        let db = setup_db();
        let vault_dir = std::env::temp_dir().join(format!(
            "helmose_vault_dir_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&vault_dir).unwrap();
        // 写两篇 md：note 含 task + [[目标]] wikilink，目标.md 让 link 非悬挂
        std::fs::write(
            vault_dir.join("note.md"),
            "# Note\n\n- [ ] 待办事项\n\n见 [[目标]]。\n",
        )
        .unwrap();
        std::fs::write(vault_dir.join("目标.md"), "# 目标\n").unwrap();

        // add_vault → 注册
        let v = add_vault_inner(
            VaultInput {
                name: "t".into(),
                root_path: vault_dir.to_string_lossy().to_string(),
                is_obsidian_shared: false,
            },
            &db,
        )
        .unwrap();
        let vid = v.id.clone();

        // 索引（产生 notes/tasks/links）
        index_vault_inner(&vid, &db).unwrap();

        let count = |table: &str| -> i64 {
            // 白名单校验表名：防 format! 拼表名模式被误复制到生产代码成注入点
            let sql = match table {
                t @ ("notes" | "tasks" | "links" | "events" | "okrs" | "reminders") => {
                    format!("SELECT COUNT(*) FROM {} WHERE vault_id = ?1", t)
                }
                other => panic!("测试用了未知表名：{}", other),
            };
            db.sqlite()
                .query_row(&sql, params![&vid], |r| r.get::<_, i64>(0))
                .unwrap()
                .unwrap_or(0)
        };
        assert!(count("notes") > 0, "应有 notes");
        assert!(count("tasks") > 0, "应有 tasks");
        assert!(count("links") > 0, "应有 links");

        // B7：FTS 是 contentless 表（无 vault_id 列），单独按 MATCH 命中数查。
        // 选 ≥3 字符词「待办事项」（note.md 正文含之）——FTS5 trigram 要求 phrase ≥3 字符，
        // 2 字符词（如「目标」）trigram 不索引，无法用于回归断言。
        let fts_hit = |term: &str| -> i64 {
            db.sqlite()
                .query_row(
                    "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH ?1",
                    params![term],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap()
                .unwrap_or(0)
        };
        assert!(fts_hit("\"待办事项\"") > 0, "索引后 FTS 应命中「待办事项」");

        // list_vaults 查到该 vault
        let list = list_vaults_inner(&db).unwrap();
        assert!(list.iter().any(|x| x.id == vid), "list_vaults 应含该 vault");

        // delete_vault → 级联清理 notes/tasks/links + vault 本身
        delete_vault_inner(&vid, &db).unwrap();
        assert_eq!(count("notes"), 0, "notes 应级联清空");
        assert_eq!(count("tasks"), 0, "tasks 应级联清空");
        assert_eq!(count("links"), 0, "links 应级联清空");

        // B7：contentless FTS 不随 notes 自动同步——delete_vault 必须显式清，否则 FTS 残留孤儿
        //（rowid 在 notes 已不存在，反复增删 vault 会累积空间泄漏）。此断言是 B7 的回归保护。
        assert_eq!(fts_hit("\"待办事项\""), 0, "delete_vault 后 FTS 应无孤儿残留");

        let list2 = list_vaults_inner(&db).unwrap();
        assert!(!list2.iter().any(|x| x.id == vid), "vault 应已删除");

        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    /// reset_db_inner：DROP 全表 + 重建空 schema，移除 vault 注册，且 schema 仍可用（能再注册+索引）。
    #[test]
    fn reset_db_inner_clears_and_reinits() {
        let db = setup_db();
        let vault_dir = std::env::temp_dir().join(format!(
            "helmose_reset_dir_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&vault_dir).unwrap();
        std::fs::write(vault_dir.join("a.md"), "# A\n- [ ] t\n").unwrap();

        // 注册 + 索引（产生 notes/tasks 等派生数据）
        let v = add_vault_inner(
            VaultInput {
                name: "t".into(),
                root_path: vault_dir.to_string_lossy().to_string(),
                is_obsidian_shared: false,
            },
            &db,
        )
        .unwrap();
        index_vault_inner(&v.id, &db).unwrap();
        assert!(get_default_vault_inner(&db).unwrap().is_some(), "reset 前应有 vault");

        // reset
        reset_db_inner(&db).unwrap();

        // vaults 应空（注册移除）
        assert!(
            get_default_vault_inner(&db).unwrap().is_none(),
            "reset 后应无 vault"
        );

        // schema 仍有效：能再注册 + 索引（全表可用）
        let v2 = add_vault_inner(
            VaultInput {
                name: "t2".into(),
                root_path: vault_dir.to_string_lossy().to_string(),
                is_obsidian_shared: false,
            },
            &db,
        )
        .unwrap();
        index_vault_inner(&v2.id, &db).unwrap();
        assert_eq!(v2.name, "t2");
        assert!(get_default_vault_inner(&db).unwrap().is_some(), "reset 后能再注册");

        let _ = std::fs::remove_dir_all(&vault_dir);
    }
}
