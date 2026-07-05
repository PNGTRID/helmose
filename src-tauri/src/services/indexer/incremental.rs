// ============================================================
// 增量索引：单文件 upsert / remove（notify watcher 与「编辑保存」共用）
// 设计要点：
//   1. 复用 indexer::parse_file 解析，与全量索引同口径
//   2. FTS5 contentless 单行维护：用 `INSERT ... SELECT FROM notes` 插、
//      用查出的原值发 'delete'——与全量 'rebuild' 产出一致（都取 notes 表原值）
//   3. 单文件 tasks/links 删旧重插；wikilink target 按 <stem>.md 近似解析
//      （全量用全局 stem_to_id，增量近似，下次全量会修正）
// ============================================================

use crate::models::{AppError, AppResult};
use crate::services::indexer;
use crate::services::Database;
use crate::utils::dates;
use crate::utils::exclude::is_excluded_rel;
use rusqlite::params;
use std::collections::HashMap;
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

/// 事务内单行查询：把 `QueryReturnedNoRows` 转成 `Ok(None)`，其余错误上抛。
/// rusqlite 原生 `tx.query_row` 在 NoRows 时返 `Err`（与封装层 `Database::query_row` 的 `Ok(None)` 语义不一致）；
/// 此 helper 统一为 `Option` 语义，替代散落的 `.ok()`——后者会把 DB 真错（锁/磁盘/语法）也吞成 `None`，
/// 导致 FTS 'delete' 跳过（→ B7 孤儿）、project_id 回填静默失效等。B6：为后续 AppError 错误码化铺路（真错可上抛映射）。
fn query_optional<T, F>(
    tx: &rusqlite::Transaction,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
    f: F,
) -> rusqlite::Result<Option<T>>
where
    F: FnOnce(&rusqlite::Row) -> rusqlite::Result<T>,
{
    match tx.query_row(sql, params, f) {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// upsert 单个 md 文件（读盘 → 解析 → 写库 + 同步 FTS）。
/// 文件不存在 / 非 md / 排除目录 → 返回 Ok(false)。
pub fn upsert_file(db: &Database, vault_id: &str, root: &Path, abs: &Path) -> AppResult<bool> {
    let rel = match qualify(abs, root) {
        Some(r) => r,
        None => return Ok(false),
    };
    let content = std::fs::read_to_string(abs)?;
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
) -> AppResult<bool> {
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
            let old: Option<(String, i64, Option<String>, String, String)> = query_optional(
                tx,
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
            )?;
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
                        for (sl, text, ts) in rows.flatten() {
                            m.insert((sl, text), ts);
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
            let collision: Option<i64> = query_optional(
                tx,
                "SELECT 1 FROM notes \
                 WHERE vault_id = ?1 AND content_hash = ?2 AND rel_path <> ?3 \
                 LIMIT 1",
                params![vault_id, &base_hash, rel],
                |r| r.get(0),
            )?;
            let id = if collision.is_some() {
                tracing::warn!(
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
            // 4. 重建该 note 的 tasks（含 repeat_rule / parent_task_id）
            let mut line_to_task_id: HashMap<i32, String> = HashMap::new();
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
                // parent_task_id 翻译：parent_source_line → 同笔记内父 task id（无则 NULL）
                let parent_task_id: Option<String> = t
                    .parent_source_line
                    .and_then(|pl| line_to_task_id.get(&pl).cloned());
                let tid = uuid::Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO tasks \
                     (id,note_id,vault_id,text,done,due_date,source,source_line,created_at,completed_at,status,priority,urgency,repeat_rule,parent_task_id) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                    params![
                        tid,
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
                        t.urgency,
                        t.repeat_rule,
                        parent_task_id
                    ],
                )?;
                if let Some(sl) = t.source_line {
                    line_to_task_id.insert(sl, tid);
                }
            }
            // 5. 重建该 note 的 links（target 按 <stem>.md 近似解析）
            for l in &p.wikilinks {
                let stem = l.target.split('/').next_back().unwrap_or(&l.target);
                let fname = format!("{}.md", stem);
                let target_id: Option<String> = query_optional(
                    tx,
                    "SELECT id FROM notes WHERE vault_id = ?1 AND file_name = ?2 COLLATE NOCASE LIMIT 1",
                    params![vault_id, fname],
                    |r| r.get(0),
                )?;
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
            // 7. 重建该 note 的 events 行（M1：bullet 内 #project:名 行级优先匹配 projects 表填 pid）
            tx.execute(
                "DELETE FROM events WHERE vault_id = ?1 AND note_id = ?2",
                params![vault_id, id],
            )?;
            for ev in &p.events {
                // 行级 pid：bullet 内 `#project:名` 标记 → 查 projects 表按名匹配（与全量第四遍同口径）。
                // 匹配不到留 NULL，由步骤9 frontmatter.project 兜底回填。
                // （原 `and_then` + `.ok()` 会吞 DB 真错 → pid 永远 NULL；改 `if let` + `?` 让真错上抛，B6）
                let pid: Option<String> = if let Some(n) = ev.project_name.as_deref() {
                    query_optional(
                        tx,
                        "SELECT id FROM projects WHERE vault_id = ?1 AND name = ?2 LIMIT 1",
                        params![vault_id, n],
                        |r| r.get::<_, String>(0),
                    )?
                } else {
                    None
                };
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
                        pid,
                        ev.raw_bullet,
                        ev.source_line,
                    ],
                )?;
            }
            // 7.5 重建该 note 的 okrs 行（strategy/project 文档的 KR section 提取）。
            // 修复：原增量只重建 tasks/events/tomorrow_sentences，漏 okrs → 编辑战略文档后
            // okrs 表陈旧（list_okrs 返回旧 KR）。与全量第五遍同口径：纯解析在 indexer/okrs.rs。
            tx.execute(
                "DELETE FROM okrs WHERE vault_id = ?1 AND source_note_id = ?2",
                params![vault_id, id],
            )?;
            for o in indexer::okrs::extract(&p) {
                let raw_row = o.kr_text.clone();
                tx.execute(
                    "INSERT INTO okrs \
                     (id,vault_id,source_note_id,quarter,objective,priority,kr_text,target_value,current_value,raw_row) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        vault_id,
                        id,
                        o.quarter,
                        o.objective,
                        o.priority,
                        o.kr_text,
                        o.target_value,
                        o.current_value,
                        raw_row,
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
            //    M1：events 在步骤7已尝试 bullet 内 #project:名 行级匹配，此处加 `AND project_id IS NULL`
            //    守卫避免覆盖行级标记（与全量第六遍回填同口径）。
            if let Some(proj_name) = p.frontmatter.get("project").and_then(|v| v.as_str()) {
                let pid: Option<String> = query_optional(
                    tx,
                    "SELECT id FROM projects WHERE vault_id = ?1 AND name = ?2 LIMIT 1",
                    params![vault_id, proj_name],
                    |r| r.get(0),
                )?;
                if let Some(pid) = pid {
                    tx.execute(
                        "UPDATE tasks SET project_id = ?1 WHERE note_id = ?2 AND vault_id = ?3",
                        params![pid, id, vault_id],
                    )?;
                    tx.execute(
                        "UPDATE events SET project_id = ?1 WHERE note_id = ?2 AND vault_id = ?3 AND project_id IS NULL",
                        params![pid, id, vault_id],
                    )?;
                }
            }
            Ok(())
        })?;
    Ok(true)
}

/// remove 单个 md 文件（文件已删除事件调用）。返回是否确实删了一行。
pub fn remove_file(db: &Database, vault_id: &str, root: &Path, abs: &Path) -> AppResult<bool> {
    let rel = match rel_of(abs, root) {
        Some(r) => r,
        None => return Ok(false),
    };
    remove_rel(db, vault_id, &rel)
}

/// remove 指定相对路径（删除笔记时直接调用）。
pub fn remove_rel(db: &Database, vault_id: &str, rel: &str) -> AppResult<bool> {
    db.sqlite()
        .transaction(|tx| {
            let old: Option<(i64, Option<String>, String, String)> = query_optional(
                tx,
                "SELECT rowid, title, raw_content, tags \
                 FROM notes WHERE vault_id = ?1 AND rel_path = ?2",
                params![vault_id, rel],
                |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)),
            )?;
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
        .map_err(AppError::Db)
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

    /// 修复 1：增量重索引后 events 行级 project_id 不丢（与全量同口径）。
    /// bullet 内 `#project:P1` → 全量索引建立 pid；后触发增量（重索引该笔记）→
    /// project_id 应保持非空（增量 INSERT 时按 ev.project_name 查 projects 表回填），
    /// 不被重置 NULL。
    #[test]
    fn upsert_preserves_event_project_id_on_reindex() {
        use crate::commands::index::index_vault_inner;
        let (_tmp, vault_dir, db) = setup();
        // 拿 vid（setup 已注册）
        let vid: String = db
            .sqlite()
            .query_row("SELECT id FROM vaults", &[], |r| r.get::<_, String>(0))
            .unwrap()
            .unwrap();

        // 项目笔记：定义项目
        std::fs::write(
            vault_dir.join("项目A.md"),
            "---\ntitle: 项目A\ntype: project\ntags: [project-status:active]\n---\n# 项目A\n",
        )
        .unwrap();
        // 经历笔记：关键事件 section 第一条 bullet 含 #project:项目A 行级标记
        std::fs::create_dir_all(vault_dir.join("05_个人成长与认知资产/经历/2026-04")).unwrap();
        let ev_path = vault_dir.join("05_个人成长与认知资产/经历/2026-04/2026-04-01.md");
        std::fs::write(
            &ev_path,
            "---\ntitle: 2026-04-01\ntype: experience\ncreated: 2026-04-01\n---\n# 概述\n\n## 关键事件\n- 早会 #project:项目A\n",
        )
        .unwrap();

        // 全量索引 → events 行应带 project_id（行级匹配）
        index_vault_inner(&vid, &db).expect("全量索引应成功");
        let pid_full: Option<String> = db
            .sqlite()
            .query_row(
                "SELECT project_id FROM events WHERE vault_id = ?1 LIMIT 1",
                params![vid],
                |r: &rusqlite::Row| r.get::<_, Option<String>>(0),
            )
            .unwrap()
            .unwrap_or(None);
        assert!(pid_full.is_some(), "全量后 event project_id 应非空（行级匹配）");

        // 触发增量（重索引该笔记，文件内容不变）
        let content = std::fs::read_to_string(&ev_path).unwrap();
        let rel = "05_个人成长与认知资产/经历/2026-04/2026-04-01.md";
        assert!(upsert_rel(&db, &vid, rel, &content, Some(&ev_path)).unwrap());

        // 增量后 project_id 应仍非空（不被重置 NULL）
        let pid_inc: Option<String> = db
            .sqlite()
            .query_row(
                "SELECT project_id FROM events WHERE vault_id = ?1 LIMIT 1",
                params![vid],
                |r: &rusqlite::Row| r.get::<_, Option<String>>(0),
            )
            .unwrap()
            .unwrap_or(None);
        assert!(
            pid_inc.is_some(),
            "增量重索引后 event project_id 不应丢，实际 {:?}",
            pid_inc
        );
        // 与全量时同一个 project_id
        assert_eq!(
            pid_inc, pid_full,
            "增量后 project_id 应与全量一致（保留行级匹配结果）"
        );
    }

    /// 修复 #1：增量重索引后 okrs 表应同步刷新（原实现漏 okrs → 编辑战略文档后 list_okrs 返回旧 KR）。
    /// 流程：全量建 okrs → 修改战略文档的 KR（增/改/删）→ 增量重索引 → okrs 表应反映新内容。
    #[test]
    fn upsert_refreshes_okrs_on_reindex() {
        use crate::commands::index::index_vault_inner;
        let (_tmp, vault_dir, db) = setup();
        let vid: String = db
            .sqlite()
            .query_row("SELECT id FROM vaults", &[], |r| r.get::<_, String>(0))
            .unwrap()
            .unwrap();

        let stg = vault_dir.join("战略.md");
        std::fs::write(
            &stg,
            "---\ntitle: 战略\ntype: strategy\npriority: 90\nquarter: 2026Q3\n---\n# 战略\n\n## 关键结果\n- KR1 收入目标 1000 万，当前 600 万\n- KR2 用户目标 5000，当前 3500\n",
        )
        .unwrap();
        index_vault_inner(&vid, &db).expect("全量索引应成功");
        let cnt_full: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM okrs WHERE vault_id = ?1",
                params![vid],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert_eq!(cnt_full, 2, "全量后应有 2 个 KR");

        // 修改战略文档：删 KR2、改 KR1 的当前值、增 KR3
        let rel = "战略.md";
        let new_content = "---\ntitle: 战略\ntype: strategy\npriority: 90\nquarter: 2026Q3\n---\n# 战略\n\n## 关键结果\n- KR1 收入目标 1000 万，当前 800 万\n- KR3 新增目标 200，当前 50\n";
        assert!(upsert_rel(&db, &vid, rel, new_content, Some(&stg)).unwrap());

        // 增量后 okrs 应刷新：KR2 已删、KR1 当前值更新、KR3 新增 → 共 2 条，无 KR2，有 KR3
        let cnt_inc: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM okrs WHERE vault_id = ?1",
                params![vid],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert_eq!(cnt_inc, 2, "增量后应仍 2 条 KR（删 1 增 1）");

        let all_krs: Vec<String> = db
            .sqlite()
            .query_map(
                "SELECT kr_text FROM okrs WHERE vault_id = ?1",
                params![vid],
                |r| r.get::<_, Option<String>>(0).map(|o| o.unwrap_or_default()),
            )
            .unwrap();
        assert!(
            !all_krs.iter().any(|t| t.contains("KR2")),
            "KR2 应已被删除，实际 {:?}",
            all_krs
        );
        assert!(
            all_krs.iter().any(|t| t.contains("KR3")),
            "KR3 应已新增，实际 {:?}",
            all_krs
        );
        assert!(
            all_krs.iter().any(|t| t.contains("800 万")),
            "KR1 当前值应更新为 800 万，实际 {:?}",
            all_krs
        );
    }
}
