// 移动/重命名笔记命令（M1 task 4）
//
// 语义：
//   - move_note(note_id, target_dir): 把笔记移到 target_dir（保持文件名不变）
//   - rename_note(note_id, new_file_name): 改文件名（保持目录不变）
//
// 行为：
//   1. 路径校验（防穿越 / 排除目录 / 不覆盖）
//   2. fs::rename 移动 vault 原文（移动本笔记自己的原文不算「改 vault 原文」越权）
//   3. UPDATE notes.rel_path + file_name
//   4. incremental 重索引新位置（tasks/links/okrs/events 同步）
//   5. 检测其他笔记里的「路径型引用」（`[x](旧路径)` / `[[旧路径]]`）→ 返回 RefLoc
//      反链（[[wikilink]] 按文件名）已通过 note id 稳定（content_hash）自动保持，
//      不需要更新；只有显式写了旧路径的需要 task 5 二次授权改原文。
//
// 铁律：本命令只移动本笔记自己的原文 + 同步索引；不批量改其他笔记的路径型引用
//      （那是 apply_ref_updates 的事，需用户二次授权）。

use crate::models::{MoveResult, RefLoc};
use crate::services::Database;
use crate::utils::exclude::is_excluded;
use rusqlite::params;
use std::path::PathBuf;
use tauri::State;

/// 路径安全校验：任一段为 `..` 即拒。返回 true 表示安全。
fn is_safe_rel(rel: &str) -> bool {
    !rel.split(|c| c == '/' || c == '\\').any(|c| c == "..")
}

/// 取笔记 id 的 vault root + rel_path + file_name
fn fetch_note_loc(
    note_id: &str,
    db: &Database,
) -> Result<(String, String, String, String), String> {
    let row = db
        .sqlite()
        .query_row(
            "SELECT n.rel_path, n.file_name, v.root_path, v.id \
             FROM notes n JOIN vaults v ON v.id = n.vault_id WHERE n.id = ?1",
            params![note_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("note {} not found", note_id))?;
    Ok(row)
}

/// 扫描所有其他笔记 raw_content，找含 `old_path` 字符串的行。
/// 匹配模式：`[文本](old_path)` 或 `[[old_path]]`（wikilink 严格按路径形式，按文件名匹配的 wikilink 不算）。
/// 仅返回路径型引用；按文件名匹配的反链由 links 表自动维护，不进此列表。
fn detect_path_refs(
    vault_id: &str,
    note_id: &str,
    old_path: &str,
    new_path: &str,
    db: &Database,
) -> Result<Vec<RefLoc>, String> {
    // 取所有其他笔记的 raw_content + id（性能：old_path 通常很短，SQLite LIKE 全表扫可接受；
    // vault 1.9 万篇，单次 move 不频繁；后续如需优化可加 LIKE 索引）
    let rows: Vec<(String, String)> = db
        .sqlite()
        .query_map(
            "SELECT id, raw_content FROM notes \
             WHERE vault_id = ?1 AND id <> ?2 AND raw_content LIKE ?3",
            params![vault_id, note_id, format!("%{}%", old_path)],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let mut refs = Vec::new();
    for (nid, content) in rows {
        for (i, line) in content.lines().enumerate() {
            if line.contains(old_path) {
                refs.push(RefLoc {
                    note_id: nid.clone(),
                    line: (i + 1) as i32,
                    old_path: old_path.to_string(),
                    new_path: new_path.to_string(),
                });
            }
        }
    }
    Ok(refs)
}

/// 移动笔记到目标目录（保持文件名）。
/// 核心逻辑（可被集成测试直接调用，绕过 Tauri State）。
pub fn move_note_inner(
    note_id: &str,
    target_dir: &str,
    db: &Database,
) -> Result<MoveResult, String> {
    move_or_rename(note_id, Some(target_dir), None, db)
}

/// 重命名笔记（保持目录）。
/// 核心逻辑（可被集成测试直接调用，绕过 Tauri State）。
pub fn rename_note_inner(
    note_id: &str,
    new_file_name: &str,
    db: &Database,
) -> Result<MoveResult, String> {
    move_or_rename(note_id, None, Some(new_file_name), db)
}

/// 移动/重命名统一实现。target_dir 与 new_file_name 至少一个非空；都为空报错。
fn move_or_rename(
    note_id: &str,
    target_dir: Option<&str>,
    new_file_name: Option<&str>,
    db: &Database,
) -> Result<MoveResult, String> {
    use crate::services::indexer::incremental;

    let (old_rel, old_file_name, root_path, vault_id) = fetch_note_loc(note_id, db)?;
    let root = PathBuf::from(&root_path);

    // 算新 rel_path：target_dir 改目录、new_file_name 改文件名
    let file_name = new_file_name.unwrap_or(&old_file_name);
    let new_rel = match target_dir {
        Some(dir) if !dir.is_empty() => format!("{}/{}", dir.trim_end_matches('/'), file_name),
        // 无 target_dir：保持原目录，换文件名
        _ => {
            let parent = match old_rel.rfind('/') {
                Some(i) => &old_rel[..i],
                None => "",
            };
            if parent.is_empty() {
                file_name.to_string()
            } else {
                format!("{}/{}", parent, file_name)
            }
        }
    };

    // 路径校验
    if !is_safe_rel(&new_rel) {
        return Err(format!("非法路径（含 ..）：{}", new_rel));
    }
    let new_abs = root.join(&new_rel);
    if is_excluded(&new_abs, &root) {
        return Err(format!("目标在排除目录，无法索引：{}", new_rel));
    }
    if new_abs == root.join(&old_rel) {
        return Err("新旧路径相同".into());
    }
    if new_abs.exists() {
        return Err(format!("目标已存在：{}", new_rel));
    }

    // fs::rename 移动 vault 原文（移动本笔记自己的原文）
    let old_abs = root.join(&old_rel);
    if !old_abs.exists() {
        return Err(format!(
            "源文件不存在（可能已被外部移动）：{}",
            old_rel
        ));
    }
    if let Some(parent) = new_abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&old_abs, &new_abs).map_err(|e| e.to_string())?;

    // 索引同步：先删旧 rel_path 行（含外键级联派生），再 upsert 新 rel_path。
    // 必须按此顺序——若先 upsert，旧/新同 content_hash 会触发碰撞消歧（hash#short），
    // 导致 id 漂移。先 remove 旧 → upsert 新 → id 稳定（content_hash 不变）。
    incremental::remove_rel(db, &vault_id, &old_rel).map_err(|e| e.to_string())?;
    let content = std::fs::read_to_string(&new_abs).map_err(|e| e.to_string())?;
    incremental::upsert_rel(db, &vault_id, &new_rel, &content, Some(&new_abs))
        .map_err(|e| e.to_string())?;

    // 重索引会按 content_hash 重新计算 id；若 id 不变（常规），重查当前 id；
    // 若碰撞态切换，旧 note_id 行会被 upsert 替换，这里查新位置拿最新 id。
    let current_id: Option<String> = db
        .sqlite()
        .query_row(
            "SELECT id FROM notes WHERE vault_id = ?1 AND rel_path = ?2",
            params![vault_id, new_rel],
            |r| r.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;
    let final_id = current_id.unwrap_or_else(|| note_id.to_string());

    // 检测路径型引用（其他笔记里的 `[x](旧路径)` / `[[旧路径]]`）
    let refs_to_update = detect_path_refs(&vault_id, &final_id, &old_rel, &new_rel, db)?;

    Ok(MoveResult {
        note_id: final_id,
        new_rel_path: new_rel,
        old_rel_path: old_rel,
        refs_to_update,
    })
}

/// 移动笔记到目标目录（命令壳）。
#[tauri::command]
pub fn move_note(
    note_id: String,
    target_dir: String,
    db: State<'_, Database>,
) -> Result<MoveResult, String> {
    move_note_inner(&note_id, &target_dir, db.inner())
}

/// 重命名笔记（命令壳）。
#[tauri::command]
pub fn rename_note(
    note_id: String,
    new_file_name: String,
    db: State<'_, Database>,
) -> Result<MoveResult, String> {
    rename_note_inner(&note_id, &new_file_name, db.inner())
}

/// 应用路径型引用更新（task 5）。
/// 用户授权后，逐条引用所在笔记读盘 → 在指定行替换 old_path → new_path → 经 save_note_content_inner
/// 收口写回（备份 + 重索引）。
/// 铁律：必须经 save_note_content_inner，不自写 fs::write。
/// 多条 RefLoc 命中同一笔记时合并成一次写盘（按行批量替换再一次性 save）。
#[tauri::command]
pub fn apply_ref_updates(
    ref_locations: Vec<RefLoc>,
    db: State<'_, Database>,
) -> Result<usize, String> {
    apply_ref_updates_inner(&ref_locations, db.inner())
}

/// 应用路径型引用更新核心逻辑（可被集成测试直接调用）。
/// 返回成功更新的笔记数（合并同笔记后）。
pub fn apply_ref_updates_inner(
    ref_locations: &[RefLoc],
    db: &Database,
) -> Result<usize, String> {
    use crate::commands::library::save_note_content_inner;

    if ref_locations.is_empty() {
        return Ok(0);
    }

    // 按 note_id 分组（同一笔记的多条引用合并成一次写盘）
    let mut by_note: std::collections::HashMap<String, Vec<&RefLoc>> = std::collections::HashMap::new();
    for r in ref_locations {
        by_note.entry(r.note_id.clone()).or_default().push(r);
    }

    let mut updated = 0usize;
    for (note_id, refs) in by_note {
        // 读当前 raw_content
        let content: String = db
            .sqlite()
            .query_row(
                "SELECT raw_content FROM notes WHERE id = ?1",
                params![note_id],
                |r| r.get::<_, String>(0),
            )
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("note {} not found", note_id))?;

        // 按行替换：定位 line（1-based），仅该行内做 old_path → new_path。
        // 多条引用可能命中同一行（一次 replace 全改）或不同行（逐行 replace）。
        let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
        for r in refs {
            let idx = (r.line as usize).saturating_sub(1);
            if idx < lines.len() {
                // 审查 #11：r.line 是 move 时的快照行号；apply 与 move 之间若用户编辑了该笔记，
                // 行号会漂移 → 盲替换会误伤无关行。替换前校验该行仍含 old_path，不含则跳过并告警。
                if lines[idx].contains(&r.old_path) {
                    lines[idx] = lines[idx].replace(&r.old_path, &r.new_path);
                } else {
                    tracing::warn!(
                        note_id = %r.note_id,
                        line = r.line,
                        old_path = %r.old_path,
                        "apply_ref_updates: 该行已不含旧路径（笔记被编辑/行漂移），跳过"
                    );
                }
            }
        }
        // 重新拼接（保持末尾换行行为：原 content 以 \n 结尾则补回）
        let mut new_content = lines.join("\n");
        if content.ends_with('\n') {
            new_content.push('\n');
        }

        // 经 save_note_content_inner 收口写回（备份到 .helmose/backup + 增量重索引）
        save_note_content_inner(&note_id, &new_content, db)?;
        updated += 1;
    }
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::index::index_vault_inner;

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

    /// 移动笔记：fs::rename + 索引更新 rel_path + note id 稳定（content_hash 不变）。
    #[test]
    fn move_note_更新索引_且id稳定() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("源.md"), "# 源笔记\n内容不变\n").unwrap();
        std::fs::create_dir_all(vault_dir.join("子目录")).unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let old_id: String = db
            .sqlite()
            .query_row(
                "SELECT id FROM notes WHERE file_name='源.md'",
                &[],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap();

        // 移动到 子目录/源.md
        let result = move_note_inner(&old_id, "子目录", &db).expect("move 应成功");
        assert_eq!(result.new_rel_path, "子目录/源.md");
        assert_eq!(result.old_rel_path, "源.md");
        assert_eq!(
            result.note_id, old_id,
            "内容不变 → id 应稳定（content_hash）"
        );
        // vault 原文已移动
        assert!(!vault_dir.join("源.md").exists(), "旧位置文件应已移走");
        assert!(
            vault_dir.join("子目录/源.md").exists(),
            "新位置文件应存在"
        );
        // 索引同步
        let new_rel: String = db
            .sqlite()
            .query_row(
                "SELECT rel_path FROM notes WHERE id = ?1",
                params![&old_id],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap();
        assert_eq!(new_rel, "子目录/源.md");
        let _ = &_tmp;
    }

    /// 移动笔记检测其他笔记的路径型引用 → RefLoc 列表。
    /// wikilink 按文件名匹配的（[[源]]）不进列表；按路径写的（[[源.md]]）才进列表。
    #[test]
    fn move_note_检测路径型引用() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("源.md"), "# 源\n").unwrap();
        // 另一篇笔记用路径型引用（markdown link + wikilink 带路径）
        std::fs::write(
            vault_dir.join("ref.md"),
            "# 引用\n\n见 [详情](源.md) 或 [[源.md]]。\n",
        )
        .unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let src_id: String = db
            .sqlite()
            .query_row(
                "SELECT id FROM notes WHERE file_name='源.md'",
                &[],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap();

        let result = move_note_inner(&src_id, "归档", &db).expect("move 应成功");
        assert_eq!(result.new_rel_path, "归档/源.md");
        // 应检测到 ref.md 里有 1 行（同时含 `(源.md)` 和 `[[源.md]]`）
        assert_eq!(
            result.refs_to_update.len(),
            1,
            "应检测到 1 处路径型引用（同一行的两种写法合并为 1 行）"
        );
        let r = &result.refs_to_update[0];
        assert_eq!(r.old_path, "源.md");
        assert_eq!(r.new_path, "归档/源.md");
        assert_eq!(r.line, 3, "引用在第 3 行");
        let _ = &_tmp;
    }

    /// 重命名：保持目录改文件名。
    #[test]
    fn rename_note_保持目录改文件名() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::create_dir_all(vault_dir.join("docs")).unwrap();
        std::fs::write(vault_dir.join("docs/旧名.md"), "# 旧\n内容\n").unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let old_id: String = db
            .sqlite()
            .query_row(
                "SELECT id FROM notes WHERE file_name='旧名.md'",
                &[],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap();

        let result = rename_note_inner(&old_id, "新名.md", &db).expect("rename 应成功");
        assert_eq!(result.new_rel_path, "docs/新名.md");
        assert_eq!(result.old_rel_path, "docs/旧名.md");
        assert!(vault_dir.join("docs/新名.md").exists());
        assert!(!vault_dir.join("docs/旧名.md").exists());
        let _ = &_tmp;
    }

    /// 路径校验：目标已存在 → 报错（不覆盖）。
    #[test]
    fn move_note_目标已存在_报错() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("a.md"), "# A\n").unwrap();
        std::fs::create_dir_all(vault_dir.join("sub")).unwrap();
        std::fs::write(vault_dir.join("sub/a.md"), "# 已存在\n").unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let id: String = db
            .sqlite()
            .query_row(
                "SELECT id FROM notes WHERE file_name='a.md' AND rel_path='a.md'",
                &[],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap();
        let err = move_note_inner(&id, "sub", &db).unwrap_err();
        assert!(err.contains("目标已存在"), "错误信息应含「目标已存在」：{}", err);
        let _ = &_tmp;
    }

    /// 路径穿越：target_dir 含 `..` → 拒。
    #[test]
    fn move_note_路径穿越_拒绝() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("a.md"), "# A\n").unwrap();
        index_vault_inner(&vid, &db).unwrap();
        let id: String = db
            .sqlite()
            .query_row("SELECT id FROM notes WHERE file_name='a.md'", &[], |r| r.get(0))
            .unwrap()
            .unwrap();
        let err = move_note_inner(&id, "../escape", &db).unwrap_err();
        assert!(err.contains("非法路径"), "应拒绝路径穿越：{}", err);
        let _ = &_tmp;
    }

    /// M1 task 5：apply_ref_updates 把路径型引用旧路径换成新路径，
    /// 经 save_note_content_inner 写回（生成 .helmose/backup 备份 + 重索引）。
    #[test]
    fn apply_ref_updates_替换路径并备份() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("源.md"), "# 源\n").unwrap();
        // 引用笔记：第 3 行有路径型引用 `[详情](源.md)` + `[[源.md]]`
        std::fs::write(
            vault_dir.join("ref.md"),
            "# 引用\n\n见 [详情](源.md) 或 [[源.md]]。\n",
        )
        .unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let ref_id: String = db
            .sqlite()
            .query_row(
                "SELECT id FROM notes WHERE file_name='ref.md'",
                &[],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap();

        // 应用 1 条引用更新（第 3 行：源.md → 归档/源.md）
        let refs = vec![RefLoc {
            note_id: ref_id.clone(),
            line: 3,
            old_path: "源.md".to_string(),
            new_path: "归档/源.md".to_string(),
        }];
        let n = apply_ref_updates_inner(&refs, &db).expect("apply 应成功");
        assert_eq!(n, 1, "应更新 1 篇笔记");

        // 原文已替换（第 3 行的两处「源.md」都变成「归档/源.md」）
        let new_content = std::fs::read_to_string(vault_dir.join("ref.md")).unwrap();
        assert!(
            new_content.contains("[详情](归档/源.md)"),
            "markdown link 应替换为新路径：\n{}",
            new_content
        );
        assert!(
            new_content.contains("[[归档/源.md]]"),
            "wikilink 路径应替换为新路径：\n{}",
            new_content
        );
        assert!(
            !new_content.contains("](源.md)") && !new_content.contains("[[源.md]]"),
            "旧路径应已被替换"
        );

        // .helmose/backup 生成备份（save_note_content_inner 备份机制生效）
        let backup_dir = vault_dir.join(".helmose").join("backup");
        assert!(backup_dir.exists(), "备份目录应存在");
        let backups: Vec<_> = std::fs::read_dir(&backup_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().to_string_lossy().contains("ref.md"))
            .collect();
        assert!(!backups.is_empty(), "应至少有 1 个 ref.md 的备份");

        // 索引同步：raw_content 已更新（content 变后 note id 随 content_hash 变，按 rel_path 查新 id）
        let indexed: String = db
            .sqlite()
            .query_row(
                "SELECT raw_content FROM notes WHERE vault_id = ?1 AND rel_path = 'ref.md'",
                params![&vid],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .unwrap();
        assert!(indexed.contains("归档/源.md"), "索引 raw_content 应同步更新");
        let _ = &_tmp;
    }

    /// apply_ref_updates 空 Vec 直接返回 0（不报错）。
    #[test]
    fn apply_ref_updates_空列表_返回0() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("a.md"), "# A\n").unwrap();
        index_vault_inner(&vid, &db).unwrap();
        let n = apply_ref_updates_inner(&[], &db).expect("空列表应成功");
        assert_eq!(n, 0);
        let _ = &_tmp;
    }
}
