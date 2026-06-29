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

/// 注册一个 vault（onboarding 调用）
#[tauri::command]
pub fn add_vault(input: VaultInput, db: State<'_, Database>) -> Result<Vault, String> {
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

/// 列出所有已注册 vault
#[tauri::command]
pub fn list_vaults(db: State<'_, Database>) -> Result<Vec<Vault>, String> {
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

/// 获取第一个（默认）vault
#[tauri::command]
pub fn get_default_vault(db: State<'_, Database>) -> Result<Option<Vault>, String> {
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

/// 删除 vault（级联清理索引数据，wiki 原文不动）
#[tauri::command]
pub fn delete_vault(vault_id: String, db: State<'_, Database>) -> Result<(), String> {
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
