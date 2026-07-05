// 索引命令：全量索引 vault（遍历 .md → 解析 → 写库）

use crate::models::{AppError, AppResult};
use crate::services::indexer;
use crate::services::Database;
use crate::utils::exclude::is_excluded;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::State;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Default)]
pub struct IndexStats {
    pub notes: usize,
    pub tasks: usize,
    pub wikilinks: usize,
    pub dangling: usize,
    pub elapsed_ms: u64,
}

fn vault_root(vault_id: &str, db: &Database) -> AppResult<PathBuf> {
    let path = db
        .sqlite()
        .query_row(
            "SELECT root_path FROM vaults WHERE id = ?1",
            params![vault_id],
            |row| row.get::<_, String>(0),
        )
        ?;
    path.ok_or_else(|| AppError::not_found(format!("vault {} not found", vault_id)))
        .map(PathBuf::from)
}

/// 全量索引核心逻辑（可被集成测试直接调用，绕过 Tauri State）。行为零变化。
pub fn index_vault_inner(vault_id: &str, db: &Database) -> AppResult<IndexStats> {
    let started = std::time::Instant::now();
    let root = vault_root(vault_id, db)?;

    // 更新状态为 scanning
    let _ = db.sqlite().execute(
        "UPDATE vaults SET indexing_state = 'scanning' WHERE id = ?1",
        params![vault_id],
    );

    // 1. 遍历 + 解析（id 延后到碰撞消歧后生成）
    let mut parsed: Vec<indexer::ParsedNote> = Vec::new();
    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| !is_excluded(e.path(), &root))
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let rel = match path.strip_prefix(&root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let rel_str = rel.to_string_lossy().to_string();
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        parsed.push(indexer::parse_file(&rel_str, &content, mtime));
    }

    // 2. note id = content_hash（稳定，移动不变）；同 vault 内 hash 碰撞（重复内容）
    //    加 rel_path 短哈希消歧；content_hash 列始终存纯 hash（「同内容」判定用）。
    //    ⚠ 已知边缘：碰撞双方其一被删后再次全量索引，剩余方会退出碰撞态，
    //    id 从 hash#short 回到纯 hash（极罕见；无碰撞态完全稳定）。行为由
    //    `index_vault_inner_collision_disambiguates` 回归测试固化。
    let mut hash_count: HashMap<String, usize> = HashMap::new();
    for p in &parsed {
        if let Some(h) = &p.content_hash {
            *hash_count.entry(h.clone()).or_insert(0) += 1;
        }
    }
    let with_id: Vec<(String, &indexer::ParsedNote)> = parsed
        .iter()
        .map(|p| {
            let id = match &p.content_hash {
                Some(h) if *hash_count.get(h).unwrap_or(&0) > 1 => {
                    format!("{}#{}", h, crate::utils::hash::short_hash(&p.rel_path))
                }
                Some(h) => h.clone(),
                None => uuid::Uuid::new_v4().to_string(),
            };
            (id, p)
        })
        .collect();

    // 3. 建 file_stem -> note_id（用于 wikilink 悬挂判定）
    let mut stem_to_id: HashMap<String, String> = HashMap::new();
    for (id, p) in &with_id {
        let stem = Path::new(&p.file_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        stem_to_id.entry(stem).or_insert_with(|| id.clone());
    }

    let mut stats = IndexStats {
        notes: parsed.len(),
        ..Default::default()
    };

    // 3. 收集 projects（本地字段）+ 跑全局 pass（last_activity / 兜底 priority / top-3 mainline）。
    //    全局 pass 需全集（多 project 互比），必须在写库前算完。
    let mut project_records: Vec<(String, indexer::projects::ProjectInfo)> = Vec::new();
    for (id, p) in &with_id {
        if let Some(info) = indexer::projects::extract(p) {
            project_records.push((id.clone(), info));
        }
    }
    indexer::projects::apply_global_passes(&mut project_records, &parsed);

    // 4. 事务写入
    db.sqlite()
        .transaction(|tx| {
            tx.execute("DELETE FROM tasks WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM links WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM events WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM tomorrow_sentences WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM projects WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM okrs WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM notes WHERE vault_id = ?1", params![vault_id])?;

            // 第一遍：所有 notes（先建立 notes 表——wikilink 可能指向遍历顺序
            // 上靠后的 note，必须先全部写入，否则 INSERT links 时外键失败）
            for (id, p) in &with_id {
                let tags_json = serde_json::to_string(&p.tags).unwrap_or_else(|_| "[]".into());
                let fm_json =
                    serde_json::to_string(&p.frontmatter).unwrap_or_else(|_| "{}".into());
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
            }

            // 第二遍：tasks + links（此时所有 notes 已在表，外键约束满足）
            for (id, p) in &with_id {
                // 本笔记内 (source_line) → task_id 的映射，供子任务 parent_task_id 翻译。
                // 子任务的 parent_source_line 指向同笔记内某顶层任务的 1-based 行号；
                // 插入顺序保证父先于子（按 source_line 升序），故查表时父 id 已存在。
                let mut line_to_task_id: HashMap<i32, String> = HashMap::new();
                for t in &p.tasks {
                    let tid = uuid::Uuid::new_v4().to_string();
                    let created = crate::utils::dates::now_iso8601();
                    // completed_at：status='done' 记录完成时间。与 created_at 同源近似——
                    // 重索引会刷新（首完时间难跨重索引保留，留 backlog），但修复了「done 任务永远 NULL」。
                    let completed_at: Option<String> = if t.status == "done" {
                        Some(crate::utils::dates::now_iso8601())
                    } else {
                        None
                    };
                    // parent_task_id 翻译：parent_source_line → 同笔记内父 task id（无则 NULL）
                    let parent_task_id: Option<String> = t
                        .parent_source_line
                        .and_then(|pl| line_to_task_id.get(&pl).cloned());
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
                            created,
                            completed_at,
                            t.status,
                            t.priority,
                            t.urgency,
                            t.repeat_rule,
                            parent_task_id
                        ],
                    )?;
                    // 登记本任务（按 source_line）供后续子任务查父。section 通道 B source_line=None
                    // 不入表（其本就无父子语义，parent_source_line 也恒 None）。
                    if let Some(sl) = t.source_line {
                        line_to_task_id.insert(sl, tid.clone());
                    }
                    stats.tasks += 1;
                }

                for l in &p.wikilinks {
                    let lid = uuid::Uuid::new_v4().to_string();
                    let target_id = stem_to_id.get(&l.target);
                    let dangling = target_id.is_none();
                    tx.execute(
                        "INSERT INTO links (id,vault_id,source_note_id,target_text,target_note_id,alias,is_dangling,link_type) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,'wikilink')",
                        params![
                            lid,
                            vault_id,
                            id,
                            l.target,
                            target_id,
                            l.alias,
                            if dangling { 1 } else { 0 }
                        ],
                    )?;
                    stats.wikilinks += 1;
                    if dangling {
                        stats.dangling += 1;
                    }
                }
            }

            // 第三遍：projects（全局 pass 后的 records → projects 表全字段）。
            // 同时建 name → projects.id 映射，供第六遍回填 tasks.project_id（frontmatter.project 关联）。
            let mut proj_name_to_id: HashMap<String, String> = HashMap::new();
            for (id, info) in &project_records {
                let pid = uuid::Uuid::new_v4().to_string();
                // 同名项目取首个（与 stem_to_id 同口径，稳定优先）
                proj_name_to_id
                    .entry(info.name.clone())
                    .or_insert_with(|| pid.clone());
                tx.execute(
                    "INSERT INTO projects \
                     (id,vault_id,note_id,name,status,priority,is_mainline,okr_priority,home_rel_path,last_activity,owner) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![
                        pid,
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
            // 项目数已含在 notes 统计里，不另计 IndexStats。

            // 第四遍：events（笔记「关键事件」等 section 的 bullet → events 表）。
            // M1：project_id 行级优先——bullet 内 `#project:名` 标记 → proj_name_to_id 匹配；
            //    匹配不到或无标签留 NULL，由第六遍 frontmatter.project 兜底回填。
            for (id, p) in &with_id {
                for ev in &p.events {
                    let pid = ev
                        .project_name
                        .as_deref()
                        .and_then(|n| proj_name_to_id.get(n));
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
            }

            // 第五遍：tomorrow_sentences（日志「明日一句」section 的一句话，需 date_iso）
            tx.execute(
                "DELETE FROM tomorrow_sentences WHERE vault_id = ?1",
                params![vault_id],
            )?;
            // okrs（DELETE 在事务开头统一做）—— strategy/project 文档的 KR section 提取。
            // 纯解析在 indexer/okrs.rs，这里只写库；raw_row 取 kr_text 兜底（与 bullet 同源）。
            for (id, p) in &with_id {
                for o in indexer::okrs::extract(p) {
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
            }
            for (id, p) in &with_id {
                if let (Some(date), Some(s)) = (&p.date_iso, &p.tomorrow_sentence) {
                    tx.execute(
                        "INSERT INTO tomorrow_sentences (id,note_id,vault_id,date_iso,sentence) \
                         VALUES (?1,?2,?3,?4,?5)",
                        params![
                            uuid::Uuid::new_v4().to_string(),
                            id,
                            vault_id,
                            date,
                            s
                        ],
                    )?;
                }
            }

            // 第六遍：回填 tasks + events 的 project_id —— frontmatter.project（项目名）按名匹配 projects。
            // 契约：frontmatter.project 为项目名字符串（Obsidian 习惯）。同笔记的 tasks 与 events 共享关联
            // （让 get_project_progress 聚合生效 + 日历事件可按项目筛）。匹配不到 → project_id 保持 NULL。
            // M1：events 在第四遍已尝试 bullet 内 `#project:名` 行级匹配，这里仅回填仍 NULL 的
            //    （`AND project_id IS NULL` 避免覆盖行级标记）。
            for (id, p) in &with_id {
                let proj_name = match p.frontmatter.get("project").and_then(|v| v.as_str()) {
                    Some(s) => s,
                    None => continue,
                };
                if let Some(pid) = proj_name_to_id.get(proj_name) {
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

            // 全量重建 FTS5 索引（contentless 表不会随 notes 自动同步）。
            // 'rebuild' 从 notes 表全量重读重建，一次解决「FTS 空表」+「旧数据残留」。
            // 注：rebuild 覆盖整张 notes_fts（全 vault），v0.1 单 vault 场景下正确。
            tx.execute("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')", [])?;
            Ok(())
        })
        .map_err(|e: rusqlite::Error| {
            tracing::error!(
                "[index_vault] FAILED root={} parsed={} tasks_so_far={}: {}",
                root.display(),
                parsed.len(),
                stats.tasks,
                e
            );
            AppError::from(e)
        })?;

    stats.elapsed_ms = started.elapsed().as_millis() as u64;

    let _ = db.sqlite().execute(
        "UPDATE vaults SET last_indexed = ?1, indexing_state = 'idle' WHERE id = ?2",
        params![crate::utils::dates::now_iso8601(), vault_id],
    );

    Ok(stats)
}

/// 全量索引一个 vault（async + spawn_blocking）：1.9 万文件遍历 + 大事务丢到阻塞线程池，
/// 不占 Tauri async 命令线程槽（其他 async 命令仍可调度）。index_vault_inner 保留同步签名 +
/// 单事务原子性（全成功或全失败回滚）——不拆分批 commit，避免破坏 DELETE + INSERT + FTS rebuild
/// + apply_global_passes 的顺序依赖导致半成品索引。emit 开始/完成事件供前端显示进度
///（中间逐 N 篇进度需贯穿 inner 签名，标 backlog）。
#[tauri::command]
pub async fn index_vault(
    vault_id: String,
    app: tauri::AppHandle,
    db: State<'_, Database>,
) -> AppResult<IndexStats> {
    use tauri::Emitter;
    let _ = app.emit(
        "index-progress",
        serde_json::json!({ "vault_id": &vault_id, "phase": "started" }),
    );
    let db = db.inner().clone();
    let vid = vault_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || index_vault_inner(&vid, &db))
        .await
        .map_err(|e| AppError::Internal(format!("索引任务调度失败：{}", e)))?;
    let _ = app.emit(
        "index-progress",
        serde_json::json!({
            "vault_id": &vault_id,
            "phase": "done",
            "ok": result.is_ok()
        }),
    );
    result
}

/// 启动文件监听（增量索引）。前端 vault 就绪后调用，幂等（已有 watcher 先停再起新）。
/// 经 WatcherManager 管理生命周期：reset_app / delete_vault 会调 stop / stop_if_watching，
/// 防 reset 后旧 watcher 把删除事件往已清空的 DB 写回（数据回潮）。
#[tauri::command]
pub fn start_watcher(
    vault_id: String,
    app: tauri::AppHandle,
    db: State<'_, Database>,
    wm: State<'_, crate::services::watcher::WatcherManager>,
) -> AppResult<()> {
    let root = vault_root(&vault_id, db.inner())?;
    wm.inner().start(app, db.inner().clone(), vault_id, root)
}

/// 检测是否需要重新索引的核心逻辑（可被集成测试直接调用）。行为零变化。
pub fn should_reindex_inner(vault_id: &str, db: &Database) -> AppResult<bool> {
    let root = vault_root(vault_id, db)?;
    let mut disk = 0usize;
    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| !is_excluded(e.path(), &root))
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        disk += 1;
    }
    let notes_count: i64 = db
        .sqlite()
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE vault_id = ?1",
            params![vault_id],
            |r| r.get(0),
        )
        ?
        .unwrap_or(0);

    if notes_count == 0 {
        return Ok(true);
    }
    let diff = (disk as f64 - notes_count as f64).abs() / notes_count as f64;
    Ok(diff > 0.1)
}

/// 检测是否需要重新索引：磁盘 md 数与 notes 表数差异 >10%，或 notes 为 0。
/// 用于启动时自动追赶「磁盘已变但索引未更新」（如 vault 重构后没重新索引）。
#[tauri::command]
pub fn should_reindex(vault_id: String, db: State<'_, Database>) -> AppResult<bool> {
    should_reindex_inner(&vault_id, db.inner())
}

// ============================================================
// 集成测试：index_vault_inner 写库全链路（真 SQLite + 真临时 FS，不 mock）
// 复用 incremental::tests::setup 模式；不依赖 ~/wiki（pid+uuid 唯一临时目录隔离）
// ============================================================
#[cfg(test)]
mod tests {
    use super::*;

    /// 构造临时 vault + 临时 DB + 注册 vault（TempDir RAII：drop 自动清理，零残留）。
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

    /// 写 3 个 md：① type:project frontmatter；② 普通笔记（stem=目标，供 wikilink 命中）；
    /// ③ 含 checkbox + [[目标]] wikilink。
    fn seed(vault_dir: &std::path::Path) {
        std::fs::write(
            vault_dir.join("项目A.md"),
            "---\ntitle: 项目A\ntype: project\ntags: [project-status:active]\n---\n# 项目A\n项目主页\n",
        )
        .unwrap();
        std::fs::write(
            vault_dir.join("目标.md"),
            "# 目标\n描述目标的普通笔记。\n",
        )
        .unwrap();
        std::fs::write(
            vault_dir.join("日志.md"),
            "# 今日日志\n\n- [ ] 写集成测试\n- [ ] 跑通 cargo test\n\n见 [[目标]]。\n",
        )
        .unwrap();
    }

    /// index_vault_inner 写库全链路：notes.id 64 位 hex / content_hash 非空 /
    /// projects 命中 type=project / tasks 有行 / links 外键有效。
    #[test]
    fn index_vault_inner_writes_full_pipeline() {
        let (_tmp, vid, vault_dir, db) = setup();
        seed(&vault_dir);

        let stats = index_vault_inner(&vid, &db).expect("index_vault_inner 应成功");
        assert_eq!(stats.notes, 3, "应索引 3 篇笔记");

        let sqlite = db.sqlite();

        // 1. notes.id 全为 64 位 hex（content_hash；3 个不同内容无碰撞 → 纯 hash）
        let ids: Vec<String> = sqlite
            .query_map(
                "SELECT id FROM notes WHERE vault_id = ?1",
                params![vid],
                |r| r.get::<_, String>(0),
            )
            .unwrap();
        assert!(!ids.is_empty(), "notes 表应有行");
        for id in &ids {
            assert_eq!(id.len(), 64, "id 应为 64 位 hex（content_hash），实际 {}", id);
            assert!(
                id.chars().all(|c| c.is_ascii_hexdigit()),
                "id 应全为 hex 字符，实际 {}",
                id
            );
        }

        // 2. content_hash 列非 null（NULL 计数应为 0）
        let hash_null: i64 = sqlite
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE vault_id = ?1 AND content_hash IS NULL",
                params![vid],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(1);
        assert_eq!(hash_null, 0, "content_hash 不应有 NULL");

        // 3. projects 表命中 type=project（① 项目A）
        let projects: i64 = sqlite
            .query_row(
                "SELECT COUNT(*) FROM projects WHERE vault_id = ?1",
                params![vid],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert!(projects >= 1, "projects 表应 >=1，实际 {}", projects);

        // 4. tasks 表有行（③ 两个 checkbox）
        let tasks: i64 = sqlite
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE vault_id = ?1",
                params![vid],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert!(tasks >= 1, "tasks 表应有行，实际 {}", tasks);

        // 5. links 表有行且 target_note_id 外键有效（③ [[目标]] → ② 目标.md）
        let links_total: i64 = sqlite
            .query_row(
                "SELECT COUNT(*) FROM links WHERE vault_id = ?1",
                params![vid],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert!(links_total >= 1, "links 表应有行");

        // 非悬挂（已解析）链接至少 1 条
        let links_resolved: i64 = sqlite
            .query_row(
                "SELECT COUNT(*) FROM links WHERE vault_id = ?1 AND target_note_id IS NOT NULL",
                params![vid],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert!(
            links_resolved >= 1,
            "应有已解析（非悬挂）的 wikilink，实际 {}",
            links_resolved
        );

        // 外键有效性：非悬挂链接的 target_note_id 必须在 notes 表存在（无效计数应为 0）
        let links_invalid_fk: i64 = sqlite
            .query_row(
                "SELECT COUNT(*) FROM links l \
                 WHERE l.vault_id = ?1 AND l.target_note_id IS NOT NULL \
                 AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = l.target_note_id)",
                params![vid],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(1);
        assert_eq!(links_invalid_fk, 0, "非悬挂链接的 target_note_id 外键必须有效");
    }

    /// 移动文件（改 rel_path，内容不变）→ 重新索引 → note id 不变（content_hash 稳定）。
    #[test]
    fn index_vault_inner_id_stable_on_move() {
        let (_tmp, vid, vault_dir, db) = setup();
        seed(&vault_dir);

        index_vault_inner(&vid, &db).unwrap();

        let sqlite = db.sqlite();
        let old_id: String = sqlite
            .query_row(
                "SELECT id FROM notes WHERE vault_id = ?1 AND file_name = ?2",
                params![vid, "日志.md"],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .expect("索引后应有 日志.md");
        assert_eq!(old_id.len(), 64, "原 id 应为 64 位 hex");

        // 改名（改 rel_path，内容字节不变）→ 重新全量索引
        std::fs::rename(vault_dir.join("日志.md"), vault_dir.join("日志归档.md")).unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let new_id: String = sqlite
            .query_row(
                "SELECT id FROM notes WHERE vault_id = ?1 AND file_name = ?2",
                params![vid, "日志归档.md"],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .expect("重索引后应有 日志归档.md");

        assert_eq!(
            new_id, old_id,
            "内容不变（仅改 rel_path）→ id 应稳定不变（content_hash 驱动）"
        );
    }

    /// 碰撞消歧：两篇内容字节完全相同的 md → 全量 → 双双带 #short 后缀、content_hash 列存纯 hash。
    /// 删其一、重新全量 → 剩余方退出碰撞态，id 从 hash#short 回到纯 hash（已知边缘，见上文注释）。
    #[test]
    fn index_vault_inner_collision_disambiguates() {
        let (_tmp, vid, vault_dir, db) = setup();
        // 两篇内容字节完全相同（不同文件名）
        let same = "# 完全相同的内容\n\n- [x] 同一份待办\n";
        std::fs::write(vault_dir.join("a.md"), same).unwrap();
        std::fs::write(vault_dir.join("b.md"), same).unwrap();

        index_vault_inner(&vid, &db).expect("index_vault_inner 应成功");
        let sqlite = db.sqlite();

        let id_a: String = sqlite
            .query_row(
                "SELECT id FROM notes WHERE vault_id = ?1 AND file_name = 'a.md'",
                params![vid],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .expect("应有 a.md");
        let id_b: String = sqlite
            .query_row(
                "SELECT id FROM notes WHERE vault_id = ?1 AND file_name = 'b.md'",
                params![vid],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .expect("应有 b.md");
        assert!(id_a.contains('#'), "碰撞 a.md id 应带 #short：{}", id_a);
        assert!(id_b.contains('#'), "碰撞 b.md id 应带 #short：{}", id_b);
        assert_ne!(id_a, id_b, "碰撞双方 id 必须不同");

        // content_hash 列恒为纯 hash（64 hex），两行相等
        let hash_a: String = sqlite
            .query_row(
                "SELECT content_hash FROM notes WHERE vault_id = ?1 AND file_name = 'a.md'",
                params![vid],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .expect("应有 a.md hash");
        let hash_b: String = sqlite
            .query_row(
                "SELECT content_hash FROM notes WHERE vault_id = ?1 AND file_name = 'b.md'",
                params![vid],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .expect("应有 b.md hash");
        assert_eq!(hash_a.len(), 64, "content_hash 应为 64 hex");
        assert_eq!(hash_a, hash_b, "同内容两份 content_hash 应相等");
        assert!(!hash_a.contains('#'), "content_hash 列不应带 #");

        // 删 a.md → 重新全量 → b.md 退出碰撞，id 回纯 hash（已知边缘漂移，固化）
        std::fs::remove_file(vault_dir.join("a.md")).unwrap();
        index_vault_inner(&vid, &db).unwrap();
        let id_b_after: String = sqlite
            .query_row(
                "SELECT id FROM notes WHERE vault_id = ?1 AND file_name = 'b.md'",
                params![vid],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .expect("b.md 仍应在");
        assert_eq!(
            id_b_after, hash_b,
            "碰撞解除后 b.md id 应回纯 content_hash（已知边缘漂移）"
        );
    }

    /// M1：projects 全字段写库（priority / is_mainline / okr_priority / last_activity）。
    /// 种 2 个 project：A 明确 fm priority+mainline+okr，放自己子目录（验 last_activity 扫描）；
    /// B 无 priority/mainline（验兜底 150 + top-3 补主线）。
    #[test]
    fn index_vault_inner_projects_full_fields() {
        let (_tmp, vid, vault_dir, db) = setup();
        // A：明确 priority=90 + mainline:true + okr:P0，放自己子目录（父目录非顶层 → 扫描 last_activity）
        std::fs::create_dir_all(vault_dir.join("01_企业与项目资产/项目A")).unwrap();
        std::fs::write(
            vault_dir.join("01_企业与项目资产/项目A/项目A.md"),
            "---\ntitle: 项目A\ntype: project\npriority: 90\nmainline: true\nokr: P0\ntags: [project-status:active]\n---\n# 项目A\n",
        )
        .unwrap();
        // A 子目录下一篇普通笔记（供 last_activity 同目录扫描）
        std::fs::write(
            vault_dir.join("01_企业与项目资产/项目A/子笔记.md"),
            "# 子笔记\n一些内容\n",
        )
        .unwrap();
        // B：无 priority/mainline/okr（验兜底 + top-3）；放顶层目录下（父目录是顶层 → last_activity 退化）
        std::fs::write(
            vault_dir.join("01_企业与项目资产/项目B.md"),
            "---\ntitle: 项目B\ntype: project\ntags: [project-status:active]\n---\n# 项目B\n",
        )
        .unwrap();

        index_vault_inner(&vid, &db).expect("index 应成功");
        let sqlite = db.sqlite();

        // A：priority=90 / is_mainline=1 / okr=P0 / last_activity 非空
        let a: (Option<f64>, i64, Option<String>, Option<String>) = sqlite
            .query_row(
                "SELECT priority, is_mainline, okr_priority, last_activity FROM projects WHERE name = '项目A'",
                &[],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap()
            .expect("应有 项目A");
        assert_eq!(a.0, Some(90.0), "A priority 应为 fm 值 90");
        assert_eq!(a.1, 1, "A fm.mainline=true → is_mainline=1");
        assert_eq!(a.2.as_deref(), Some("P0"), "A okr 应为 P0");
        assert!(a.3.is_some(), "A last_activity 应非空（ISO8601）");

        // B：priority 兜底（None 中 rank0 → 150），is_mainline 经 top-3 补 → 1
        let b: (Option<f64>, i64, Option<String>) = sqlite
            .query_row(
                "SELECT priority, is_mainline, last_activity FROM projects WHERE name = '项目B'",
                &[],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap()
            .expect("应有 项目B");
        assert_eq!(b.0, Some(150.0), "B 兜底 priority rank0 → 150");
        assert_eq!(b.1, 1, "B active 且进 top-3 → is_mainline=1");
        assert!(b.2.is_some(), "B last_activity 退化用自身 mtime，应非空");
    }

    /// M2：events 表写库（从 experience 笔记的「关键事件」section 提取 bullet）。
    #[test]
    fn index_vault_inner_events_extracted() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::create_dir_all(vault_dir.join("05_个人成长与认知资产/经历/2026-04")).unwrap();
        std::fs::write(
            vault_dir.join("05_个人成长与认知资产/经历/2026-04/2026-04-01.md"),
            "---\ntitle: 2026-04-01 经历\ntype: experience\ncreated: 2026-04-01\n---\n# 概述\n\n## 关键事件\n- **早会**: 9:00 和团队对齐\n- 写了设计文档\n\n## 明日待办\n- 跟进 A\n",
        )
        .unwrap();

        index_vault_inner(&vid, &db).expect("index 应成功");
        let sqlite = db.sqlite();

        // events 表应有 2 行（关键事件 section 下 2 个 bullet；明日待办不算事件）
        let cnt: i64 = sqlite
            .query_row(
                "SELECT COUNT(*) FROM events WHERE vault_id = ?1",
                params![vid],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert_eq!(cnt, 2, "应提取 2 条事件，实际 {}", cnt);

        // event_date = 笔记 date_iso（2026-04-01）
        let dates: Vec<Option<String>> = sqlite
            .query_map(
                "SELECT DISTINCT event_date FROM events WHERE vault_id = ?1",
                params![vid],
                |r| r.get::<_, Option<String>>(0),
            )
            .unwrap();
        assert!(
            dates.iter().all(|d| d.as_deref() == Some("2026-04-01")),
            "event_date 应为 2026-04-01，实际 {:?}",
            dates
        );

        // 第一条应解析出时间 9:00
        let t: Option<String> = sqlite
            .query_row(
                "SELECT event_time FROM events WHERE vault_id = ?1 AND event_time IS NOT NULL LIMIT 1",
                params![vid],
                |r| r.get::<_, Option<String>>(0),
            )
            .unwrap()
            .flatten();
        assert_eq!(t.as_deref(), Some("9:00"), "应解析出事件时间 9:00");
    }

    /// 真实 wiki 全链路 smoke：注册 ~/wiki → 全量索引（派生 SQLite，不写 vault md）→
    /// 统计 projects/events/tasks.due_date 填充情况，验证 M1/M2/M8 对真实 1.9 万文件的端到端效果。
    /// #[ignore]：依赖本机 ~/wiki（CI 无），`cargo test -- --ignored index_real_wiki_full_pipeline` 显式跑。
    #[test]
    #[ignore]
    fn index_real_wiki_full_pipeline() {
        let root = std::env::var("HELMOSE_TEST_VAULT")
            .unwrap_or_else(|_| "/Users/yuanruiqin/wiki".into());
        if !Path::new(&root).exists() {
            eprintln!("[smoke-full] skip: {} 不存在", root);
            return;
        }
        let vid = uuid::Uuid::new_v4().to_string();
        let tag = format!("{}_{}", std::process::id(), vid);
        let db_path = std::env::temp_dir().join(format!("helmose_realwiki_db_{}.db", tag));
        let db = Database::new(db_path).unwrap();
        db.init_schema().unwrap();
        db.sqlite()
            .execute(
                "INSERT INTO vaults (id,name,root_path,created_at,indexing_state,is_obsidian_shared,exclude_patterns) \
                 VALUES (?1,'real',?2,'2026-01-01T00:00:00Z','idle',0,'[]')",
                params![vid, root],
            )
            .unwrap();

        let stats = index_vault_inner(&vid, &db).expect("全量索引应成功");
        let sqlite = db.sqlite();

        let projects: i64 = sqlite
            .query_row("SELECT COUNT(*) FROM projects WHERE vault_id=?1", params![vid], |r| r.get(0))
            .unwrap().unwrap_or(0);
        let mainline: i64 = sqlite
            .query_row("SELECT COUNT(*) FROM projects WHERE vault_id=?1 AND is_mainline=1", params![vid], |r| r.get(0))
            .unwrap().unwrap_or(0);
        let proj_with_priority: i64 = sqlite
            .query_row("SELECT COUNT(*) FROM projects WHERE vault_id=?1 AND priority IS NOT NULL", params![vid], |r| r.get(0))
            .unwrap().unwrap_or(0);
        let proj_with_activity: i64 = sqlite
            .query_row("SELECT COUNT(*) FROM projects WHERE vault_id=?1 AND last_activity IS NOT NULL", params![vid], |r| r.get(0))
            .unwrap().unwrap_or(0);
        let events: i64 = sqlite
            .query_row("SELECT COUNT(*) FROM events WHERE vault_id=?1", params![vid], |r| r.get(0))
            .unwrap().unwrap_or(0);
        let tasks_due: i64 = sqlite
            .query_row("SELECT COUNT(*) FROM tasks WHERE vault_id=?1 AND due_date IS NOT NULL", params![vid], |r| r.get(0))
            .unwrap().unwrap_or(0);
        let log_notes: i64 = sqlite
            .query_row("SELECT COUNT(*) FROM notes WHERE vault_id=?1 AND note_type='log'", params![vid], |r| r.get(0))
            .unwrap().unwrap_or(0);
        let tomorrow: i64 = sqlite
            .query_row("SELECT COUNT(*) FROM tomorrow_sentences WHERE vault_id=?1", params![vid], |r| r.get(0))
            .unwrap().unwrap_or(0);

        eprintln!(
            "[smoke-full] 真实 wiki 全链路：notes={} tasks={} wikilinks={} | projects={} (主线={} 有priority={} 有activity={}) | events={} | tasks_with_due={} | log_notes={} | tomorrow_sentences={}",
            stats.notes, stats.tasks, stats.wikilinks,
            projects, mainline, proj_with_priority, proj_with_activity,
            events, tasks_due, log_notes, tomorrow
        );

        // 所有 project 都应有 priority + last_activity（M1 全字段填充）
        assert!(projects == 0 || proj_with_priority == projects, "所有 project 应有 priority（兜底或 fm），缺: {}", projects - proj_with_priority);
        assert!(projects == 0 || proj_with_activity == projects, "所有 project 应有 last_activity");
        assert!(stats.notes > 100, "真 wiki 应 >100 笔记，实际 {}", stats.notes);

        let _ = std::fs::remove_file(std::env::temp_dir().join(format!("helmose_realwiki_db_{}.db", tag)));
    }

    /// M3 migration 幂等性：init_schema 连续调两次不应报错（PRAGMA table_info 守列存在性，
    /// 新库 CREATE 自带列会跳过 ALTER）。同时验证 status/priority/urgency/owner 列确实存在。
    #[test]
    fn init_schema_幂等_含_m3_m5_新列() {
        let tag = format!("{}_{}", std::process::id(), uuid::Uuid::new_v4());
        let db_path = std::env::temp_dir().join(format!("helmose_idem_db_{}.db", tag));
        let db = Database::new(db_path).unwrap();
        // 第一次：新库 CREATE 自带 status/priority/urgency/owner
        db.init_schema().expect("第一次 init_schema 应成功");
        // 第二次：列已存在，PRAGMA 应跳过 ALTER（不报 duplicate column）
        db.init_schema().expect("第二次 init_schema 应幂等成功");

        // 验证 tasks 表 4 列存在（status / priority / urgency + 旧列 done）
        let task_cols: Vec<String> = db
            .sqlite()
            .query_map("PRAGMA table_info(tasks)", &[], |r| r.get::<_, String>(1))
            .unwrap();
        for needed in ["status", "priority", "urgency", "done"] {
            assert!(
                task_cols.iter().any(|c| c == needed),
                "tasks 表应有 {} 列，实际 {:?}",
                needed,
                task_cols
            );
        }

        // 验证 projects 表 owner 列
        let proj_cols: Vec<String> = db
            .sqlite()
            .query_map("PRAGMA table_info(projects)", &[], |r| r.get::<_, String>(1))
            .unwrap();
        assert!(
            proj_cols.iter().any(|c| c == "owner"),
            "projects 表应有 owner 列，实际 {:?}",
            proj_cols
        );

        // M2：tasks 表应有 repeat_rule + parent_task_id 两列
        for needed in ["repeat_rule", "parent_task_id"] {
            assert!(
                task_cols.iter().any(|c| c == needed),
                "tasks 表应有 {} 列（M2），实际 {:?}",
                needed,
                task_cols
            );
        }

        // M2：reminders 表应存在 + idx_reminders_at 索引存在
        let rem_cols: Vec<String> = db
            .sqlite()
            .query_map(
                "PRAGMA table_info(reminders)",
                &[],
                |r| r.get::<_, String>(1),
            )
            .unwrap();
        for needed in [
            "id",
            "task_id",
            "note_id",
            "vault_id",
            "remind_at",
            "fired",
            "task_text",
            "due_date",
            "created_at",
        ] {
            assert!(
                rem_cols.iter().any(|c| c == needed),
                "reminders 表应有 {} 列，实际 {:?}",
                needed,
                rem_cols
            );
        }
        let idx_cnt: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_reminders_at'",
                &[],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert_eq!(idx_cnt, 1, "idx_reminders_at 索引应存在");
    }

    /// M3 旧库 backfill：模拟旧库 tasks 行（done=1，无 status 列）→ init_schema 后 status='done' 反填。
    /// 验证迁移不会让旧的 done 任务退化为 todo。
    #[test]
    fn migrate_旧库done任务反填status_done() {
        use crate::services::database_sqlite::SqliteDatabase;
        let tag = format!("{}_{}", std::process::id(), uuid::Uuid::new_v4());
        let db_path = std::env::temp_dir().join(format!("helmose_backfill_db_{}.db", tag));
        // 先建一个「旧 schema」库（无 status/priority/urgency/owner）
        {
            let old = SqliteDatabase::new(db_path.clone()).unwrap();
            old.execute(
                "CREATE TABLE vaults (id TEXT PRIMARY KEY, name TEXT, root_path TEXT, created_at TEXT, last_indexed TEXT, indexing_state TEXT, is_obsidian_shared INTEGER, exclude_patterns TEXT)",
                &[],
            )
            .unwrap();
            old.execute(
                "CREATE TABLE notes (id TEXT PRIMARY KEY, vault_id TEXT, rel_path TEXT, file_name TEXT, title TEXT, note_type TEXT, layer INTEGER, date_iso TEXT, week_iso TEXT, tags TEXT, frontmatter TEXT, raw_content TEXT, mtime INTEGER, content_hash TEXT)",
                &[],
            )
            .unwrap();
            // 旧 tasks 表：无 status/priority/urgency 列
            old.execute(
                "CREATE TABLE tasks (id TEXT PRIMARY KEY, note_id TEXT, vault_id TEXT, text TEXT, done INTEGER, due_date TEXT, source TEXT, source_line INTEGER, project_id TEXT, created_at TEXT, completed_at TEXT)",
                &[],
            )
            .unwrap();
            // 旧 projects 表：无 owner 列
            old.execute(
                "CREATE TABLE projects (id TEXT PRIMARY KEY, vault_id TEXT, note_id TEXT, name TEXT, status TEXT, priority REAL, is_mainline INTEGER, okr_priority TEXT, home_rel_path TEXT, last_activity TEXT)",
                &[],
            )
            .unwrap();
            // 一行旧任务 done=1
            old.execute(
                "INSERT INTO tasks (id,note_id,vault_id,text,done,source,created_at) VALUES ('t1','n1','v1','旧完成',1,'checkbox','2026-01-01')",
                &[],
            )
            .unwrap();
        }
        // 现在用 Database 包装，触发 migrate（应补 status 列 + backfill status='done'）
        let db = Database::new(db_path).unwrap();
        db.init_schema().expect("migrate 应成功");
        let status: String = db
            .sqlite()
            .query_row(
                "SELECT status FROM tasks WHERE id='t1'",
                &[],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .unwrap();
        assert_eq!(status, "done", "旧 done=1 任务应被 backfill 为 status='done'");
    }
}
