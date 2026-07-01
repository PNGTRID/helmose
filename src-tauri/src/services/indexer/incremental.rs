// ============================================================
// 增量索引：单文件 upsert / remove（notify watcher 与「编辑保存」共用）
// 设计要点：
//   1. 复用 indexer::parse_file 解析，与全量索引同口径
//   2. FTS5 contentless 单行维护：用 `INSERT ... SELECT FROM notes` 插、
//      用查出的原值发 'delete'——与全量 'rebuild' 产出一致（都取 notes 表原值）
//   3. 单文件 tasks/links 删旧重插；wikilink target 按 <stem>.md 近似解析
//      （全量用全局 stem_to_id，增量近似，下次全量会修正）
// ============================================================

use crate::services::indexer;
use crate::services::Database;
use crate::utils::dates;
use crate::utils::exclude::is_excluded_rel;
use rusqlite::params;
use std::path::Path;

fn rel_of(abs: &Path, root: &Path) -> Option<String> {
    abs.strip_prefix(root)
        .ok()
        .map(|r| r.to_string_lossy().replace('\\', "/"))
}

/// 判定 + 取相对路径。非 md / 排除目录 / 不在 root 下 → None。
fn qualify(abs: &Path, root: &Path) -> Option<String> {
    if abs.extension().and_then(|s| s.to_str()) != Some("md") {
        return None;
    }
    let rel = rel_of(abs, root)?;
    if is_excluded_rel(&rel) {
        return None;
    }
    Some(rel)
}

/// upsert 单个 md 文件（读盘 → 解析 → 写库 + 同步 FTS）。
/// 文件不存在 / 非 md / 排除目录 → 返回 Ok(false)。
pub fn upsert_file(db: &Database, vault_id: &str, root: &Path, abs: &Path) -> Result<bool, String> {
    let rel = match qualify(abs, root) {
        Some(r) => r,
        None => return Ok(false),
    };
    let content = std::fs::read_to_string(abs).map_err(|e| e.to_string())?;
    upsert_rel(db, vault_id, &rel, &content, Some(abs))
}

/// upsert 指定相对路径与内容（编辑保存直接调用，不必再读盘）。
/// `abs` 用于取 mtime；若为 None 则用当前时间。
pub fn upsert_rel(
    db: &Database,
    vault_id: &str,
    rel: &str,
    content: &str,
    abs: Option<&Path>,
) -> Result<bool, String> {
    if is_excluded_rel(rel) {
        return Ok(false);
    }
    let mtime = abs
        .and_then(|p| {
            p.metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
        })
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0)
        });

    let p = indexer::parse_file(rel, content, mtime);
    let tags_json = serde_json::to_string(&p.tags).unwrap_or_else(|_| "[]".into());
    let fm_json = serde_json::to_string(&p.frontmatter).unwrap_or_else(|_| "{}".into());

    db.sqlite()
        .transaction(|tx| {
            // 1. 旧记录：拿 id 复用 + 取 FTS delete 所需原值（title 可能 NULL）
            let old: Option<(String, i64, Option<String>, String, String)> = tx
                .query_row(
                    "SELECT id, rowid, title, raw_content, tags \
                     FROM notes WHERE vault_id = ?1 AND rel_path = ?2",
                    params![vault_id, rel],
                    |r| {
                        Ok((
                            r.get(0)?,
                            r.get(1)?,
                            r.get(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, String>(4)?,
                        ))
                    },
                )
                .ok();
            if let Some((_, old_rowid, old_title, old_raw, old_tags)) = &old {
                let _ = tx.execute(
                    "INSERT INTO notes_fts(notes_fts, rowid, title, raw_content, tags) \
                     VALUES('delete', ?1, ?2, ?3, ?4)",
                    params![old_rowid, old_title, old_raw, old_tags],
                );
            }

            // 1.5 缓存旧 done task 的 completed_at（按 source_line+text 匹配）。
            //    跨重索引保留首完时间：步骤2 DELETE notes 会 CASCADE 删旧 tasks，
            //    步骤4 INSERT 新 task 时优先复用旧 completed_at，避免编辑已 done 任务时完成时间被刷新。
            let old_completed: std::collections::HashMap<(Option<i32>, String), String> = {
                let mut m = std::collections::HashMap::new();
                if let Some((old_id, _, _, _, _)) = &old {
                    let mut stmt = tx.prepare(
                        "SELECT source_line, text, completed_at FROM tasks \
                         WHERE note_id = ?1 AND completed_at IS NOT NULL",
                    )?;
                    let rows = stmt.query_map(params![old_id], |r| {
                        Ok((
                            r.get::<_, Option<i32>>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                        ))
                    });
                    if let Ok(rows) = rows {
                        for row in rows {
                            if let Ok((sl, text, ts)) = row {
                                m.insert((sl, text), ts);
                            }
                        }
                    }
                }
                m
            };

            // 2. note id = content_hash（稳定，移动不变）；删旧 note 后检测碰撞：
            //    同 vault 若已有同 hash 的别的 rel_path → 加 rel_path 短哈希消歧
            let base_hash = p
                .content_hash
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            tx.execute(
                "DELETE FROM notes WHERE vault_id = ?1 AND rel_path = ?2",
                params![vault_id, rel],
            )?;
            let collision: Option<i64> = tx
                .query_row(
                    "SELECT 1 FROM notes \
                     WHERE vault_id = ?1 AND content_hash = ?2 AND rel_path <> ?3 \
                     LIMIT 1",
                    params![vault_id, &base_hash, rel],
                    |r| r.get(0),
                )
                .ok();
            let id = if collision.is_some() {
                eprintln!(
                    "[incremental] content_hash 碰撞，加 rel_path 消歧：{} ← {}",
                    base_hash, rel
                );
                format!("{}#{}", base_hash, crate::utils::hash::short_hash(rel))
            } else {
                base_hash
            };
            tx.execute(
                "INSERT INTO notes \
                 (id,vault_id,rel_path,file_name,title,note_type,layer,date_iso,week_iso,tags,frontmatter,raw_content,mtime,content_hash) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                params![
                    id,
                    vault_id,
                    p.rel_path,
                    p.file_name,
                    p.title,
                    p.note_type,
                    p.layer,
                    p.date_iso,
                    p.week_iso,
                    tags_json,
                    fm_json,
                    p.raw_content,
                    p.mtime,
                    p.content_hash
                ],
            )?;
            // 3. FTS：从 notes 表读原值插入（与全量 'rebuild' 同源，保证一致）
            tx.execute(
                "INSERT INTO notes_fts(rowid, title, raw_content, tags) \
                 SELECT rowid, title, raw_content, tags FROM notes WHERE id = ?1",
                params![id],
            )?;
            // 4. 重建该 note 的 tasks
            for t in &p.tasks {
                // completed_at：status='done' 优先复用旧值（跨重索引保留首完时间），无旧值才记 now。
                let completed_at: Option<String> = if t.status == "done" {
                    old_completed
                        .get(&(t.source_line, t.text.clone()))
                        .cloned()
                        .or_else(|| Some(dates::now_iso8601()))
                } else {
                    None
                };
                tx.execute(
                    "INSERT INTO tasks \
                     (id,note_id,vault_id,text,done,due_date,source,source_line,created_at,completed_at,status,priority,urgency) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        id,
                        vault_id,
                        t.text,
                        if t.done { 1 } else { 0 },
                        t.due_date,
                        t.source,
                        t.source_line,
                        dates::now_iso8601(),
                        completed_at,
                        t.status,
                        t.priority,
                        t.urgency
                    ],
                )?;
            }
            // 5. 重建该 note 的 links（target 按 <stem>.md 近似解析）
            for l in &p.wikilinks {
                let stem = l.target.split('/').next_back().unwrap_or(&l.target);
                let fname = format!("{}.md", stem);
                let target_id: Option<String> = tx
                    .query_row(
                        "SELECT id FROM notes WHERE vault_id = ?1 AND file_name = ?2 COLLATE NOCASE LIMIT 1",
                        params![vault_id, fname],
                        |r| r.get(0),
                    )
                    .ok();
                tx.execute(
                    "INSERT INTO links (id,vault_id,source_note_id,target_text,target_note_id,alias,is_dangling,link_type) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,'wikilink')",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        vault_id,
                        id,
                        l.target,
                        target_id,
                        l.alias,
                        if target_id.is_none() { 1 } else { 0 }
                    ],
                )?;
            }
            // 6. 重建该 note 的 projects 行：先删旧（不论现在是否 project），再按需插。
            //    增量场景全局字段近似——last_activity 用笔记自身 mtime（不扫全库），
            //    is_mainline/priority 仅本地判定。下次全量索引会修正全局部分（与 wikilink 增量近似同口径）。
            tx.execute(
                "DELETE FROM projects WHERE vault_id = ?1 AND note_id = ?2",
                params![vault_id, id],
            )?;
            if let Some(mut info) = indexer::projects::extract(&p) {
                info.last_activity = Some(crate::utils::dates::secs_to_iso8601(info.activity_mtime));
                tx.execute(
                    "INSERT INTO projects \
                     (id,vault_id,note_id,name,status,priority,is_mainline,okr_priority,home_rel_path,last_activity,owner) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        vault_id,
                        id,
                        info.name,
                        info.status,
                        info.priority,
                        if info.is_mainline { 1 } else { 0 },
                        info.okr_priority,
                        info.home_rel_path,
                        info.last_activity,
                        info.owner,
                    ],
                )?;
            }
            // 7. 重建该 note 的 events 行
            tx.execute(
                "DELETE FROM events WHERE vault_id = ?1 AND note_id = ?2",
                params![vault_id, id],
            )?;
            for ev in &p.events {
                tx.execute(
                    "INSERT INTO events \
                     (id,note_id,vault_id,title,event_time,event_date,content,output,project_id,raw_bullet,source_line) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        id,
                        vault_id,
                        ev.title,
                        ev.event_time,
                        ev.event_date,
                        ev.content,
                        ev.output,
                        None::<String>,
                        ev.raw_bullet,
                        ev.source_line,
                    ],
                )?;
            }
            // 8. 重建该 note 的 tomorrow_sentence（需 date_iso）
            tx.execute(
                "DELETE FROM tomorrow_sentences WHERE vault_id = ?1 AND note_id = ?2",
                params![vault_id, id],
            )?;
            if let (Some(date), Some(s)) = (&p.date_iso, &p.tomorrow_sentence) {
                tx.execute(
                    "INSERT INTO tomorrow_sentences (id,note_id,vault_id,date_iso,sentence) \
                     VALUES (?1,?2,?3,?4,?5)",
                    params![uuid::Uuid::new_v4().to_string(), id, vault_id, date, s],
                )?;
            }
            // 9. 回填 tasks + events 的 project_id：本笔记 frontmatter.project（项目名）匹配已入库 projects。
            //    增量场景按名查 projects 表（项目可能在别的笔记，已入库；与 wikilink 增量近似同口径）。
            if let Some(proj_name) = p.frontmatter.get("project").and_then(|v| v.as_str()) {
                let pid: Option<String> = tx
                    .query_row(
                        "SELECT id FROM projects WHERE vault_id = ?1 AND name = ?2 LIMIT 1",
                        params![vault_id, proj_name],
                        |r| r.get(0),
                    )
                    .ok();
                if let Some(pid) = pid {
                    tx.execute(
                        "UPDATE tasks SET project_id = ?1 WHERE note_id = ?2 AND vault_id = ?3",
                        params![pid, id, vault_id],
                    )?;
                    tx.execute(
                        "UPDATE events SET project_id = ?1 WHERE note_id = ?2 AND vault_id = ?3",
                        params![pid, id, vault_id],
                    )?;
                }
            }
            Ok(())
        })
        .map_err(|e: rusqlite::Error| e.to_string())?;
    Ok(true)
}

/// remove 单个 md 文件（文件已删除事件调用）。返回是否确实删了一行。
pub fn remove_file(db: &Database, vault_id: &str, root: &Path, abs: &Path) -> Result<bool, String> {
    let rel = match rel_of(abs, root) {
        Some(r) => r,
        None => return Ok(false),
    };
    remove_rel(db, vault_id, &rel)
}

/// remove 指定相对路径（删除笔记时直接调用）。
pub fn remove_rel(db: &Database, vault_id: &str, rel: &str) -> Result<bool, String> {
    db.sqlite()
        .transaction(|tx| {
            let old: Option<(i64, Option<String>, String, String)> = tx
                .query_row(
                    "SELECT rowid, title, raw_content, tags \
                     FROM notes WHERE vault_id = ?1 AND rel_path = ?2",
                    params![vault_id, rel],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)),
                )
                .ok();
            if let Some((rowid, title, raw, tags)) = old {
                let _ = tx.execute(
                    "INSERT INTO notes_fts(notes_fts, rowid, title, raw_content, tags) \
                     VALUES('delete', ?1, ?2, ?3, ?4)",
                    params![rowid, title, raw, tags],
                );
                tx.execute(
                    "DELETE FROM notes WHERE vault_id = ?1 AND rel_path = ?2",
                    params![vault_id, rel],
                )?;
                return Ok(true);
            }
            Ok(false)
        })
        .map_err(|e: rusqlite::Error| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, std::path::PathBuf, Database) {
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
        (tmp, vault_dir, db)
    }

    #[test]
    fn upsert_then_search_then_remove() {
        let (_tmp, vault_dir, db) = setup();
        let vid: String = db
            .sqlite()
            .query_row("SELECT id FROM vaults", &[], |r| r.get::<_, String>(0))
            .unwrap()
            .unwrap();

        let md = vault_dir.join("会员系统.md");
        std::fs::write(&md, "# 会员系统\n这是关于会员体系的设计\n").unwrap();

        // upsert
        assert!(upsert_file(&db, &vid, &vault_dir, &md).unwrap());

        // FTS 应能命中“会员系统”
        let cnt: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH '\"会员系统\"'",
                &[],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert!(cnt > 0, "upsert 后 FTS 应能命中");

        // 编辑：upsert_rel 改内容后，新关键词命中、旧关键词不再命中
        assert!(upsert_rel(&db, &vid, "会员系统.md", "# 会员系统\n改为积分商城\n", Some(&md)).unwrap());
        let has_new: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH '\"积分商城\"'",
                &[],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert!(has_new > 0, "编辑后新内容应进入 FTS");

        // remove
        assert!(remove_file(&db, &vid, &vault_dir, &md).unwrap());
        let after: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH '\"会员系统\"'",
                &[],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert_eq!(after, 0, "remove 后 FTS 应无命中");
    }
}
