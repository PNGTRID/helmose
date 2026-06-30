// Vault 命令：onboarding 选择/新建 vault，列出已注册 vault

use crate::models::{IndexingState, Vault, VaultInput};
use crate::services::Database;
use crate::utils::dates;
use rusqlite::params;
use std::fs;
use tauri::State;

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
pub fn add_vault_inner(input: VaultInput, db: &Database) -> Result<Vault, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = dates::now_iso8601();
    // 检测 Obsidian 共存
    let obsidian_marker = format!("{}/.obsidian", &input.root_path);
    let is_obs = fs::metadata(&obsidian_marker).is_ok();
    let exclude = default_excludes();
    let exclude_json = serde_json::to_string(&exclude).map_err(|e| e.to_string())?;

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
        .map_err(|e| e.to_string())?;

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
pub fn add_vault(input: VaultInput, db: State<'_, Database>) -> Result<Vault, String> {
    add_vault_inner(input, db.inner())
}

/// 列出所有已注册 vault 核心逻辑（可被集成测试直接调用）。
pub fn list_vaults_inner(db: &Database) -> Result<Vec<Vault>, String> {
    let rows = db
        .sqlite()
        .query_map(
            "SELECT id,name,root_path,created_at,last_indexed,indexing_state,is_obsidian_shared,exclude_patterns \
             FROM vaults ORDER BY created_at DESC",
            &[],
            row_to_vault,
        )
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 列出所有已注册 vault。命令壳：State 解包 + 转调 list_vaults_inner。
#[tauri::command]
pub fn list_vaults(db: State<'_, Database>) -> Result<Vec<Vault>, String> {
    list_vaults_inner(db.inner())
}

/// 获取第一个（默认）vault 核心逻辑（可被集成测试直接调用）。
pub fn get_default_vault_inner(db: &Database) -> Result<Option<Vault>, String> {
    let rows = db
        .sqlite()
        .query_map(
            "SELECT id,name,root_path,created_at,last_indexed,indexing_state,is_obsidian_shared,exclude_patterns \
             FROM vaults ORDER BY created_at DESC LIMIT 1",
            &[],
            row_to_vault,
        )
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().next())
}

/// 获取第一个（默认）vault。命令壳：State 解包 + 转调 get_default_vault_inner。
#[tauri::command]
pub fn get_default_vault(db: State<'_, Database>) -> Result<Option<Vault>, String> {
    get_default_vault_inner(db.inner())
}

/// 删除 vault 核心逻辑（级联清理索引数据，wiki 原文不动；可被集成测试直接调用）。
pub fn delete_vault_inner(vault_id: &str, db: &Database) -> Result<(), String> {
    db.sqlite()
        .transaction(|tx| {
            tx.execute("DELETE FROM tasks WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM links WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM notes WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM vaults WHERE id = ?1", params![vault_id])?;
            Ok(())
        })
        .map_err(|e: rusqlite::Error| e.to_string())?;
    Ok(())
}

/// 删除 vault（级联清理索引数据，wiki 原文不动）。命令壳：State 解包 + 转调 delete_vault_inner。
#[tauri::command]
pub fn delete_vault(vault_id: String, db: State<'_, Database>) -> Result<(), String> {
    delete_vault_inner(&vault_id, db.inner())
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
            let sql = format!("SELECT COUNT(*) FROM {} WHERE vault_id = ?1", table);
            db.sqlite()
                .query_row(&sql, params![&vid], |r| r.get::<_, i64>(0))
                .unwrap()
                .unwrap_or(0)
        };
        assert!(count("notes") > 0, "应有 notes");
        assert!(count("tasks") > 0, "应有 tasks");
        assert!(count("links") > 0, "应有 links");

        // list_vaults 查到该 vault
        let list = list_vaults_inner(&db).unwrap();
        assert!(list.iter().any(|x| x.id == vid), "list_vaults 应含该 vault");

        // delete_vault → 级联清理 notes/tasks/links + vault 本身
        delete_vault_inner(&vid, &db).unwrap();
        assert_eq!(count("notes"), 0, "notes 应级联清空");
        assert_eq!(count("tasks"), 0, "tasks 应级联清空");
        assert_eq!(count("links"), 0, "links 应级联清空");

        let list2 = list_vaults_inner(&db).unwrap();
        assert!(!list2.iter().any(|x| x.id == vid), "vault 应已删除");

        let _ = std::fs::remove_dir_all(&vault_dir);
    }
}
