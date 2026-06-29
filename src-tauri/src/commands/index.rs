// 索引命令：全量索引 vault（遍历 .md → 解析 → 写库）

use crate::services::indexer;
use crate::services::Database;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::State;
use walkdir::WalkDir;

/// 体积大的备份目录，默认不索引（提速；核心内容约 1.5k 文件）
const EXCLUDE_DIRS: &[&str] = &["6-原始资料", "专家团"];

#[derive(Debug, Clone, Serialize, Default)]
pub struct IndexStats {
    pub notes: usize,
    pub tasks: usize,
    pub wikilinks: usize,
    pub dangling: usize,
    pub elapsed_ms: u64,
}

/// 路径是否在排除目录下（隐藏目录 + 备份大目录）
fn is_excluded(path: &Path, root: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    for comp in rel.components() {
        if let Some(name) = comp.as_os_str().to_str() {
            if name.starts_with('.') {
                return true;
            }
            if EXCLUDE_DIRS.contains(&name) {
                return true;
            }
        }
    }
    false
}

fn vault_root(vault_id: &str, db: &Database) -> Result<PathBuf, String> {
    let path = db
        .sqlite()
        .query_row(
            "SELECT root_path FROM vaults WHERE id = ?1",
            params![vault_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;
    path.ok_or_else(|| format!("vault {} not found", vault_id))
        .map(PathBuf::from)
}

/// 全量索引一个 vault
#[tauri::command]
pub fn index_vault(vault_id: String, db: State<'_, Database>) -> Result<IndexStats, String> {
    let started = std::time::Instant::now();
    let root = vault_root(&vault_id, db.inner())?;

    // 更新状态为 scanning
    let _ = db.sqlite().execute(
        "UPDATE vaults SET indexing_state = 'scanning' WHERE id = ?1",
        params![vault_id],
    );

    // 1. 遍历 + 解析
    let mut parsed: Vec<(String, indexer::ParsedNote)> = Vec::new();
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
        let p = indexer::parse_file(&rel_str, &content, mtime);
        let id = uuid::Uuid::new_v4().to_string();
        parsed.push((id, p));
    }

    // 2. 建 file_stem -> note_id（用于 wikilink 悬挂判定）
    let mut stem_to_id: HashMap<String, String> = HashMap::new();
    for (id, p) in &parsed {
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

    // 3. 事务写入
    db.sqlite()
        .transaction(|tx| {
            tx.execute("DELETE FROM tasks WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM links WHERE vault_id = ?1", params![vault_id])?;
            tx.execute("DELETE FROM notes WHERE vault_id = ?1", params![vault_id])?;

            // 第一遍：所有 notes（先建立 notes 表——wikilink 可能指向遍历顺序
            // 上靠后的 note，必须先全部写入，否则 INSERT links 时外键失败）
            for (id, p) in &parsed {
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
            for (id, p) in &parsed {
                for t in &p.tasks {
                    let tid = uuid::Uuid::new_v4().to_string();
                    let created = crate::utils::dates::now_iso8601();
                    tx.execute(
                        "INSERT INTO tasks (id,note_id,vault_id,text,done,source,source_line,created_at) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        params![
                            tid,
                            id,
                            vault_id,
                            t.text,
                            if t.done { 1 } else { 0 },
                            t.source,
                            t.source_line,
                            created
                        ],
                    )?;
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

            // 全量重建 FTS5 索引（contentless 表不会随 notes 自动同步）。
            // 'rebuild' 从 notes 表全量重读重建，一次解决「FTS 空表」+「旧数据残留」。
            // 注：rebuild 覆盖整张 notes_fts（全 vault），v0.1 单 vault 场景下正确。
            tx.execute("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')", [])?;
            Ok(())
        })
        .map_err(|e: rusqlite::Error| {
            eprintln!(
                "[index_vault] FAILED root={} parsed={} notes tasks_so_far={}: {:?}",
                root.display(),
                parsed.len(),
                stats.tasks,
                e
            );
            e.to_string()
        })?;

    stats.elapsed_ms = started.elapsed().as_millis() as u64;

    let _ = db.sqlite().execute(
        "UPDATE vaults SET last_indexed = ?1, indexing_state = 'idle' WHERE id = ?2",
        params![crate::utils::dates::now_iso8601(), vault_id],
    );

    Ok(stats)
}

/// 启动文件监听（增量索引）。前端 vault 就绪后调用，幂等（v0.1 单 vault）。
#[tauri::command]
pub fn start_watcher(
    vault_id: String,
    app: tauri::AppHandle,
    db: State<'_, Database>,
) -> Result<(), String> {
    let root = vault_root(&vault_id, db.inner())?;
    crate::services::watcher::start(app, db.inner().clone(), vault_id, root);
    Ok(())
}

/// 检测是否需要重新索引：磁盘 md 数与 notes 表数差异 >10%，或 notes 为 0。
/// 用于启动时自动追赶「磁盘已变但索引未更新」（如 vault 重构后没重新索引）。
#[tauri::command]
pub fn should_reindex(vault_id: String, db: State<'_, Database>) -> Result<bool, String> {
    let root = vault_root(&vault_id, db.inner())?;
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
        .map_err(|e| e.to_string())?
        .unwrap_or(0);

    if notes_count == 0 {
        return Ok(true);
    }
    let diff = (disk as f64 - notes_count as f64).abs() / notes_count as f64;
    Ok(diff > 0.1)
}
