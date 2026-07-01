// ============================================================
// 文档库命令 —— Obsidian 式浏览：目录树 + 列表 + 单篇预览
// 设计要点：
//   1. 列表/树只返回元数据（NoteMeta），不带正文 → 1.9 万文件不爆 IPC
//   2. 单篇预览才取全文，并由 Rust 端 pulldown-cmark 渲染成 HTML
//   3. 排除目录与 index.rs 保持一致，树视图 = 索引视图
// ============================================================

use crate::models::{NoteContent, NoteMeta};
use crate::services::Database;
use crate::services::indexer::tasks;
use crate::utils::exclude::{is_excluded, is_excluded_rel};
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::params;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;
use walkdir::WalkDir;

/// 备份文件信息（.helmose/backup/ 下的历史备份，供 SettingsPage 查看/清理）
#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub name: String,
    pub size: u64,
    pub mtime: String,
}

fn vault_root(vault_id: &str, db: &Database) -> Result<PathBuf, String> {
    let path = db
        .sqlite()
        .query_row(
            "SELECT root_path FROM vaults WHERE id = ?1",
            params![vault_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("vault {} not found", vault_id))?;
    Ok(PathBuf::from(path))
}

/// 列出 vault 的所有目录（相对路径，扁平），供前端构建 Obsidian 式文件树。
/// 根目录用空串 "" 表示。排除隐藏目录 + 大目录（与索引一致）。
#[tauri::command]
pub fn list_dirs(vault_id: String, db: State<'_, Database>) -> Result<Vec<String>, String> {
    let root = vault_root(&vault_id, db.inner())?;
    let mut dirs: Vec<String> = vec![String::new()]; // 根

    for entry in WalkDir::new(&root)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| !is_excluded(e.path(), &root))
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_dir() {
            continue;
        }
        let rel = entry.path().strip_prefix(&root).unwrap_or(entry.path());
        dirs.push(rel.to_string_lossy().replace('\\', "/"));
    }
    Ok(dirs)
}

/// 列出某目录「直接子」的笔记元数据（不含正文），用于文档库中间列表。
/// - `dir_prefix`：相对目录路径，"" 表示 vault 根。
/// - `limit`：截断条数（默认 5000，防止意外超大目录）。
///
/// 直接子 = 去掉 dir_prefix 后路径里不再含 '/'；更深层的文件在其子目录节点下展示。
#[tauri::command]
pub fn list_notes_meta(
    vault_id: String,
    dir_prefix: Option<String>,
    limit: Option<i64>,
    db: State<'_, Database>,
) -> Result<Vec<NoteMeta>, String> {
    let prefix = dir_prefix.unwrap_or_default();
    let prefix_slash = if prefix.is_empty() {
        String::new()
    } else {
        format!("{}/", prefix)
    };

    // 根目录直接用 SQL 过滤顶层；子目录匹配前缀后在 Rust 里过滤直接子
    let mut sql = String::from(
        "SELECT id,rel_path,file_name,title,note_type,date_iso,tags,mtime \
         FROM notes WHERE vault_id = ?1",
    );
    let like = format!("{}%", prefix_slash);
    let mut pv: Vec<&dyn rusqlite::ToSql> = vec![&vault_id];
    if prefix.is_empty() {
        sql.push_str(" AND rel_path NOT LIKE '%/%'");
    } else {
        sql.push_str(" AND rel_path LIKE ?2");
        pv.push(&like);
    }
    sql.push_str(" ORDER BY file_name COLLATE NOCASE");

    let rows = db
        .sqlite()
        .query_map(
            &sql,
            &pv,
            |row| {
                let tags_json: String = row.get("tags")?;
                Ok((
                    row.get::<_, String>("id")?,
                    row.get::<_, String>("rel_path")?,
                    row.get::<_, String>("file_name")?,
                    row.get::<_, Option<String>>("title")?,
                    row.get::<_, Option<String>>("note_type")?,
                    row.get::<_, Option<String>>("date_iso")?,
                    serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default(),
                    row.get::<_, i64>("mtime")?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let max = limit.unwrap_or(5000) as usize;
    let mut out: Vec<NoteMeta> = Vec::new();
    for (id, rel_path, file_name, title, note_type, date_iso, tags, mtime) in rows {
        // 直接子判定：去掉 prefix 后不再含 '/'
        let rest = rel_path
            .strip_prefix(&prefix_slash)
            .unwrap_or(&rel_path);
        if rest.contains('/') {
            continue;
        }
        out.push(NoteMeta {
            id,
            rel_path,
            file_name,
            title,
            note_type,
            date_iso,
            tags,
            mtime,
        });
        if out.len() >= max {
            break;
        }
    }
    Ok(out)
}

/// 列出 vault 所有笔记的轻量元数据（无正文——性能红线只禁 raw_content 全文，
/// 元数据允许）。供前端一次性构建完整目录+文件树（Obsidian 式混合树）。
/// 约 1.9 万条 ~3MB，启动/刷新时一次 IPC，桌面单用户可接受。
#[tauri::command]
pub fn list_all_notes_meta(
    vault_id: String,
    db: State<'_, Database>,
) -> Result<Vec<NoteMeta>, String> {
    let rows = db
        .sqlite()
        .query_map(
            "SELECT id,rel_path,file_name,title,note_type,date_iso,tags,mtime \
             FROM notes WHERE vault_id = ?1 ORDER BY file_name COLLATE NOCASE",
            params![vault_id],
            |row| {
                let tags_json: String = row.get("tags")?;
                Ok(NoteMeta {
                    id: row.get("id")?,
                    rel_path: row.get("rel_path")?,
                    file_name: row.get("file_name")?,
                    title: row.get("title")?,
                    note_type: row.get("note_type")?,
                    date_iso: row.get("date_iso")?,
                    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                    mtime: row.get("mtime")?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 按标签精确筛选笔记核心逻辑（tags JSON 数组含该 tag 元素，非 FTS 全文搜）。
/// 匹配 `"tag"` 带引号 → 避免 `project` 误命中 `project-status:active`。
pub fn list_notes_by_tag_inner(
    vault_id: &str,
    tag: &str,
    limit: Option<i64>,
    db: &Database,
) -> Result<Vec<NoteMeta>, String> {
    // LIKE pattern：在 tags JSON（["a","b"]）里精确匹配 "tag" 元素
    let pattern = format!("%\"{}\"%", tag);
    let lim = limit.unwrap_or(500);
    let rows = db
        .sqlite()
        .query_map(
            "SELECT id,rel_path,file_name,title,note_type,date_iso,tags,mtime \
             FROM notes WHERE vault_id = ?1 AND tags LIKE ?2 \
             ORDER BY date_iso DESC LIMIT ?3",
            params![vault_id, pattern, lim],
            |row| {
                let tags_json: String = row.get("tags")?;
                Ok(NoteMeta {
                    id: row.get("id")?,
                    rel_path: row.get("rel_path")?,
                    file_name: row.get("file_name")?,
                    title: row.get("title")?,
                    note_type: row.get("note_type")?,
                    date_iso: row.get("date_iso")?,
                    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                    mtime: row.get("mtime")?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 按标签精确筛选笔记（命令壳）。返回 NoteMeta（无正文，守性能红线）。
#[tauri::command]
pub fn list_notes_by_tag(
    vault_id: String,
    tag: String,
    limit: Option<i64>,
    db: State<'_, Database>,
) -> Result<Vec<NoteMeta>, String> {
    list_notes_by_tag_inner(&vault_id, &tag, limit, db.inner())
}

/// 从 DB 查单篇笔记完整 NoteContent（含 note_type/tags/frontmatter + 渲染 HTML）。
/// 统一 get_note_content / create / save 链路的返回构造（DRY）。找不到 → Err。
fn fetch_note_content(note_id: &str, db: &Database) -> Result<NoteContent, String> {
    let row = db
        .sqlite()
        .query_row(
            "SELECT id,rel_path,title,note_type,tags,frontmatter,raw_content \
             FROM notes WHERE id = ?1",
            params![note_id],
            |r| {
                let tags_json: String = r.get("tags")?;
                let fm_json: String = r.get("frontmatter")?;
                Ok((
                    r.get::<_, String>("id")?,
                    r.get::<_, String>("rel_path")?,
                    r.get::<_, Option<String>>("title")?,
                    r.get::<_, Option<String>>("note_type")?,
                    tags_json,
                    fm_json,
                    r.get::<_, Option<String>>("raw_content")?.unwrap_or_default(),
                ))
            },
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("note {} not found", note_id))?;
    let (id, rel_path, title, note_type, tags_json, fm_json, raw_content) = row;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let frontmatter: serde_json::Value =
        serde_json::from_str(&fm_json).unwrap_or_else(|_| serde_json::json!({}));
    let html = render_markdown(&raw_content);
    Ok(NoteContent {
        id,
        rel_path,
        title,
        note_type,
        tags,
        frontmatter,
        raw_content,
        html,
    })
}

/// 取单篇笔记正文 + frontmatter + 渲染 HTML（预览/编辑用）。
#[tauri::command]
pub fn get_note_content(
    note_id: String,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    fetch_note_content(&note_id, db.inner())
}

/// 保存笔记内容核心逻辑（可被集成测试直接调用，绕过 Tauri State）。
/// 写前把原文件备份到 <vault>/.helmose/backup/（隐藏目录，不索引），保护原文。
/// 注：本函数写 vault 原文——用户明确点「保存」触发，带备份保护。
pub fn save_note_content_inner(
    note_id: &str,
    content: &str,
    db: &Database,
) -> Result<NoteContent, String> {
    use crate::services::indexer::incremental;

    // 1. 查 note 所属 vault + 相对路径
    let row = db
        .sqlite()
        .query_row(
            "SELECT n.rel_path, v.root_path, v.id \
             FROM notes n JOIN vaults v ON v.id = n.vault_id WHERE n.id = ?1",
            params![note_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("note {} not found", note_id))?;
    let (rel_path, root_path, vault_id) = row;
    let root = PathBuf::from(&root_path);
    let abs = root.join(&rel_path);

    // 2. 备份原文件（若存在）。备份失败不阻塞写（磁盘满/权限时返回 Err 反而让用户无法保存），
    //    但要 eprintln 留痕，绝不静默吞错（review 要求：log 不静默）。
    if abs.exists() {
        let backup_dir = root.join(".helmose").join("backup");
        if let Err(e) = std::fs::create_dir_all(&backup_dir) {
            tracing::warn!("备份目录创建失败 {}: {}", backup_dir.display(), e);
        }
        let safe_name = rel_path.replace('/', "_");
        let ts = crate::utils::dates::now_iso8601().replace(':', "-");
        let backup_path = backup_dir.join(format!("{}.{}.md", safe_name, ts));
        if let Err(e) = std::fs::copy(&abs, &backup_path) {
            tracing::warn!(
                "备份失败 {} -> {}: {}",
                abs.display(),
                backup_path.display(),
                e
            );
        }
    }

    // 3. 确保父目录存在，写新内容到 vault 原文
    if let Some(parent) = abs.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&abs, content).map_err(|e| e.to_string())?;

    // 4. 增量重索引（notes + FTS + tasks + links 同步更新）
    incremental::upsert_rel(db, &vault_id, &rel_path, content, Some(&abs))
        .map_err(|e| e.to_string())?;

    // 5. 返回最新 NoteContent：save 后 id 随 content_hash 变，按 (vault_id, rel_path) 查当前 id → fetch 全字段
    let new_id: String = db
        .sqlite()
        .query_row(
            "SELECT id FROM notes WHERE vault_id = ?1 AND rel_path = ?2",
            params![vault_id, rel_path],
            |r| r.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("save 后未找到笔记：{}", rel_path))?;
    fetch_note_content(&new_id, db)
}

/// 保存笔记内容（写回 vault md 原文 + 自动备份 + 增量重索引）。
/// 命令壳：State 解包 + 转调 save_note_content_inner，行为零变化。
#[tauri::command]
pub fn save_note_content(
    note_id: String,
    content: String,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    save_note_content_inner(&note_id, &content, db.inner())
}

/// 只更新笔记正文（保留原 frontmatter 不变）。
/// 动机：getNoteContent 返回的 raw_content 是「去 fm 正文」（与 frontmatter::parse.content 同源），
/// WYSIWYG 编辑器只编辑正文；若直接 save_note_content(正文) 写盘会丢失 frontmatter
/// （type/tags/created 全丢）。故读盘取原 fm → reassemble 拼回新正文 → 复用 save 链路
/// （备份+写盘+索引），与 toggle_task / update_line 同构。返回 NoteContent.raw_content = 正文
/// （与 get_note_content 一致，前端 RichEditor 可直接复用）。
pub fn save_note_body_inner(note_id: &str, body: &str, db: &Database) -> Result<NoteContent, String> {
    let full = read_full(note_id, db)?;
    let new_full = reassemble(&full, body);
    // save_note_content_inner 内部 upsert 后 fetch，返回完整 NoteContent
    // （raw=正文、note_type/tags/frontmatter 全，与 get_note_content 同源）
    save_note_content_inner(note_id, &new_full, db)
}

/// 保存笔记正文（保留 frontmatter）。WYSIWYG 编辑器（去 fm 正文）保存触发。
#[tauri::command]
pub fn save_note_body(
    note_id: String,
    body: String,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    save_note_body_inner(&note_id, &body, db.inner())
}

/// 切换任务完成态核心逻辑：改 source_line 行的 checkbox（[ ]↔[x]）→ 复用 save（备份+写+索引）。
/// 用户在任务列表直接打勾，免开笔记编辑。铁律：用户动作触发 + save 带备份保护。
pub fn toggle_task_inner(
    note_id: &str,
    source_line: i64,
    done: bool,
    db: &Database,
) -> Result<NoteContent, String> {
    // 读盘完整文件 + 取正文（去 fm，source_line 与之同源）——避免写回丢失 frontmatter
    let full = read_full(note_id, db)?;
    let body = body_of(&full);
    // 按 1-based 行号改该行 checkbox（首个匹配）
    let mut lines: Vec<String> = body.lines().map(String::from).collect();
    let idx = (source_line - 1) as usize;
    if idx >= lines.len() {
        return Err(format!(
            "source_line {} 越界（正文共 {} 行）",
            source_line,
            lines.len()
        ));
    }
    lines[idx] = if done {
        lines[idx].replace("[ ]", "[x]")
    } else {
        lines[idx].replace("[x]", "[ ]").replace("[X]", "[ ]")
    };
    let mut new_body = lines.join("\n");
    if body.ends_with('\n') {
        new_body.push('\n');
    }
    // 拼回 frontmatter + 复用 save（备份 + 写盘 + 增量索引 → tasks.done 同步）
    let new_full = reassemble(&full, &new_body);
    save_note_content_inner(note_id, &new_full, db)
}

/// 切换任务完成态（写回 vault + 索引）。任务列表勾选触发。
#[tauri::command]
pub fn toggle_task(
    note_id: String,
    source_line: i64,
    done: bool,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    toggle_task_inner(&note_id, source_line, done, db.inner())
}

// ============================================================
// M3：任务字段就地写入（status / priority / urgency）
// 三 inner 复用 toggle_task_inner 的拆行骨架（lines + idx=source_line-1 + 越界检查 + join），
// 改完后统一经 save_note_content_inner 收口（备份 + 写盘 + 重索引 → tasks 新值同步）。
// bullet 文本约定（与 indexer split_* 同口径）：
//   - status：checkbox 前缀 `[ ]`/`[/]`/`[x]` 决定（done 同步派生：done=done==[x]）；
//              bullet 内 🔄 同义 doing（[ ] 任务 🔄 ↔ [/] 任务）。
//   - priority：⭐ 数 0-3（0=清空）。
//   - urgency：🔥 = high，移除 = low（派生只在前端）。
// ============================================================

/// task status 白名单（todo/doing/done）。命令壳入口 + 单元测试共用。
/// 非法值 → Err，避免 inner 走 `_ =>` 分支静默按 todo 兜底。
fn validate_task_status(s: &str) -> Result<(), String> {
    if !["todo", "doing", "done"].contains(&s) {
        return Err(format!("非法 status 值: {}（必须 todo/doing/done）", s));
    }
    Ok(())
}

/// task urgency 白名单（high/mid/low）。命令壳入口 + 单元测试共用。
fn validate_task_urgency(s: &str) -> Result<(), String> {
    if !["high", "mid", "low"].contains(&s) {
        return Err(format!("非法 urgency 值: {}（必须 high/mid/low）", s));
    }
    Ok(())
}

/// task priority 范围（0-3）。命令壳入口 + 单元测试共用。
fn validate_task_priority(p: i32) -> Result<(), String> {
    if !(0..=3).contains(&p) {
        return Err(format!("非法 priority 值: {}（必须 0-3）", p));
    }
    Ok(())
}

/// 行级编辑所需上下文（line_for_edit 返回，避免 4-tuple 顺序错读）。
struct LineEdit {
    /// 完整文件内容（含 frontmatter，拼回用）
    full: String,
    /// 命中行的原文
    line: String,
    /// 正文所有行（可变，改后 join 回写）
    lines: Vec<String>,
    /// 正文是否以换行结尾（join 后补 \n 用）
    trailing_nl: bool,
}

/// 通用拆行：按 1-based source_line 取该行，越界/source_line<=0 → Err。
/// source_line==null（聚合 section 任务）由上层拦截，本函数仅处理 >0 的就地行。
fn line_for_edit(note_id: &str, source_line: i64, db: &Database) -> Result<LineEdit, String> {
    let full = read_full(note_id, db)?;
    let body = body_of(&full);
    let lines: Vec<String> = body.lines().map(String::from).collect();
    if source_line <= 0 {
        return Err("该任务不支持改状态（聚合 section）".to_string());
    }
    let idx = (source_line - 1) as usize;
    if idx >= lines.len() {
        return Err(format!(
            "source_line {} 越界（正文共 {} 行）",
            source_line,
            lines.len()
        ));
    }
    let trailing_nl = body.ends_with('\n');
    Ok(LineEdit {
        full,
        line: lines[idx].clone(),
        lines,
        trailing_nl,
    })
}

/// 把改后的行集合拼回完整文件（保留 frontmatter），交由 save_note_content_inner 收口。
fn save_lines(note_id: &str, full: &str, lines: Vec<String>, trailing_nl: bool, db: &Database) -> Result<NoteContent, String> {
    let mut new_body = lines.join("\n");
    if trailing_nl {
        new_body.push('\n');
    }
    let new_full = reassemble(full, &new_body);
    save_note_content_inner(note_id, &new_full, db)
}

/// 改任务状态（status：todo/doing/done）。
/// bullet 前缀切换：done → `[x]`；doing → `[/]`（保留 🔄 同义）；todo → `[ ]`。
/// 若原行无 checkbox 前缀（section bullet），doing 加 🔄 emoji，其他状态移除 🔄。
/// status=done 同步 done 派生字段（save 后 tasks.done=1）。
pub fn set_task_status_inner(
    note_id: &str,
    source_line: i64,
    status: &str,
    db: &Database,
) -> Result<NoteContent, String> {
    let mut le = line_for_edit(note_id, source_line, db)?;
    let idx = (source_line - 1) as usize;

    // 拆出行首 bullet marker（`- [ ]` / `- [/]` / `- [x]` / `- ` 之一）+ body
    // 用正则一次切出 marker 与 body 两部分；marker 是 `- [X]` 或裸 `- /*`
    static RE_LINE_SPLIT: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"^(\s*[-*+]\s)(\[[ xX/]\]\s+)?(.*)$").unwrap());

    let caps = RE_LINE_SPLIT
        .captures(&le.line)
        .ok_or_else(|| format!("行 {} 不是合法 bullet：{}", source_line, le.line))?;
    let prefix = caps[1].to_string(); // `- ` / `* ` 等
    let _checkbox_opt = caps.get(2).map(|m| m.as_str()).unwrap_or("");
    let body_text = caps[3].to_string();

    // body_text 内剥离 🔄（状态切换前后，body 不带 🔄，状态由 checkbox 前缀承载）。
    // 复用 indexer::tasks 的 pub 正则（emoji 清理单一源，避免两处漂移）。
    let body_no_spin = tasks::RE_STATUS_DOING
        .replace_all(&body_text, "")
        .trim()
        .to_string();

    let new_line = match status {
        "done" => format!("{}[x] {}", prefix, body_no_spin),
        "doing" => format!("{}[/] {}", prefix, body_no_spin),
        _ => format!("{}[ ] {}", prefix, body_no_spin),
    };

    le.lines[idx] = new_line;
    save_lines(note_id, &le.full, le.lines, le.trailing_nl, db)
}

/// 改任务优先级（priority：0-3，0 = 清空 ⭐）。
/// 在行尾按 priority 数补 ⭐（0=删全部 ⭐；1-3=补对应数）。先剥离旧 ⭐ 再补新数。
pub fn set_task_priority_inner(
    note_id: &str,
    source_line: i64,
    priority: i32,
    db: &Database,
) -> Result<NoteContent, String> {
    let mut le = line_for_edit(note_id, source_line, db)?;
    let idx = (source_line - 1) as usize;

    // 剥离旧 ⭐（复用 indexer::tasks 的 pub 正则，单一源；trim_end 保留 bullet 缩进）
    let cleaned = tasks::RE_PRIORITY
        .replace_all(&le.line, "")
        .trim_end()
        .to_string();

    let n = priority.clamp(0, 3);
    let new_line = if n > 0 {
        let stars = "⭐".repeat(n as usize);
        format!("{} {}", cleaned, stars)
    } else {
        cleaned
    };

    le.lines[idx] = new_line;
    save_lines(note_id, &le.full, le.lines, le.trailing_nl, db)
}

/// 改任务紧急度（urgency：high=加 🔥，其他=删 🔥）。
/// 派生（按 due_date 推导）只在前端，本命令只对手动 🔥 增删。
pub fn set_task_urgency_inner(
    note_id: &str,
    source_line: i64,
    urgency: &str,
    db: &Database,
) -> Result<NoteContent, String> {
    let mut le = line_for_edit(note_id, source_line, db)?;
    let idx = (source_line - 1) as usize;

    // 先剥 🔥（复用 indexer::tasks 的 pub 正则，单一源），再按 high 决定补不补
    let cleaned = tasks::RE_URGENCY_HIGH
        .replace_all(&le.line, "")
        .trim_end()
        .to_string();

    let new_line = if urgency == "high" {
        format!("{} 🔥", cleaned)
    } else {
        cleaned
    };

    le.lines[idx] = new_line;
    save_lines(note_id, &le.full, le.lines, le.trailing_nl, db)
}

/// 改任务状态（命令壳）。任务列表 status 切换 / 看板跨列拖拽触发。
#[tauri::command]
pub fn set_task_status(
    note_id: String,
    source_line: i64,
    status: String,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    // 入口显式白名单校验：拒绝非法 status（防 inner 兜底静默成功）
    validate_task_status(&status)?;
    tracing::info!(note_id = %note_id, source_line, status = %status, "set_task_status 写回");
    set_task_status_inner(&note_id, source_line, &status, db.inner())
}

/// 改任务优先级（命令壳）。四象限拖拽 / 行内 ⭐ 切换触发。
#[tauri::command]
pub fn set_task_priority(
    note_id: String,
    source_line: i64,
    priority: i32,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    // 入口显式范围校验：拒绝非法 priority（防 inner clamp 静默兜底成功）
    validate_task_priority(priority)?;
    tracing::info!(note_id = %note_id, source_line, priority, "set_task_priority 写回");
    set_task_priority_inner(&note_id, source_line, priority, db.inner())
}

/// 改任务紧急度（命令壳）。四象限拖拽 / 行内 🔥 切换触发。
#[tauri::command]
pub fn set_task_urgency(
    note_id: String,
    source_line: i64,
    urgency: String,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    // 入口显式白名单校验：拒绝非法 urgency（防 inner 兜底静默成功）
    validate_task_urgency(&urgency)?;
    tracing::info!(note_id = %note_id, source_line, urgency = %urgency, "set_task_urgency 写回");
    set_task_urgency_inner(&note_id, source_line, &urgency, db.inner())
}

/// 删除笔记核心逻辑：**软删除**——移到 <vault>/.helmose/trash/（可恢复），
/// 不硬删 vault 原文；DB 行经 incremental::remove_rel 级联清除（FK CASCADE）。
/// 铁律：用户动作触发 + 软删可恢复（比硬删安全）。
pub fn delete_note_inner(note_id: &str, db: &Database) -> Result<String, String> {
    use crate::services::indexer::incremental;
    let (rel_path, root_path, vault_id) = db
        .sqlite()
        .query_row(
            "SELECT n.rel_path, v.root_path, v.id FROM notes n \
             JOIN vaults v ON v.id = n.vault_id WHERE n.id = ?1",
            params![note_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("note {} not found", note_id))?;
    let root = PathBuf::from(&root_path);
    let abs = root.join(&rel_path);
    let mut dest = String::new();
    if abs.exists() {
        let trash = root.join(".helmose").join("trash");
        let _ = std::fs::create_dir_all(&trash);
        let ts = crate::utils::dates::now_iso8601().replace(':', "-");
        let safe = rel_path.replace('/', "_");
        let mut target = trash.join(format!("{}.{}.md", safe, ts));
        if target.exists() {
            // 极罕：同名同秒，加短随机后缀
            let suffix: String = uuid::Uuid::new_v4().to_string().chars().take(6).collect();
            target = trash.join(format!("{}.{}.{}.md", safe, ts, suffix));
        }
        dest = target.to_string_lossy().to_string();
        std::fs::rename(&abs, &target).map_err(|e| e.to_string())?;
    }
    // DB 清行（remove_rel 删 notes + FTS delete；tasks/links/events/projects/tomorrow 经 FK CASCADE 清）
    incremental::remove_rel(db, &vault_id, &rel_path).map_err(|e| e.to_string())?;
    Ok(dest)
}

/// 删除笔记（软删除到 .helmose/trash，可恢复）。NoteView 删除按钮触发。
#[tauri::command]
pub fn delete_note(note_id: String, db: State<'_, Database>) -> Result<String, String> {
    delete_note_inner(&note_id, db.inner())
}

/// 创建新笔记核心逻辑（写 vault md 原文 + 增量索引）。
/// 铁律：写 vault 须用户明确动作（前端按钮触发）；不覆盖已存在；路径防穿越；排除目录拒（索引不到）。
pub fn create_note_inner(
    vault_id: &str,
    rel_path: &str,
    content: &str,
    db: &Database,
) -> Result<NoteContent, String> {
    use crate::services::indexer::incremental;

    // 1. 路径防穿越：任一段为 .. 即拒
    if rel_path
        .split(|c| c == '/' || c == '\\')
        .any(|c| c == "..")
    {
        return Err(format!("非法路径（含 ..）：{}", rel_path));
    }
    // 2. 排除目录拒（upsert 会跳过，导致查 note_id 失败）
    if is_excluded_rel(rel_path) {
        return Err(format!("目标在排除目录，无法索引：{}", rel_path));
    }
    let root = vault_root(vault_id, db)?;
    let abs = root.join(rel_path);
    // 3. 不覆盖已存在（前端应先查，已存在直接打开）
    if abs.exists() {
        return Err(format!("文件已存在：{}", rel_path));
    }
    // 4. 建父目录 + 写
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&abs, content).map_err(|e| e.to_string())?;
    // 5. 增量索引（notes + FTS + tasks + links + events/projects 同步）
    incremental::upsert_rel(db, vault_id, rel_path, content, Some(&abs))
        .map_err(|e| e.to_string())?;
    // 6. 查回 note_id（upsert 后 notes 表有行）→ fetch 完整 NoteContent（含 note_type/tags/frontmatter）
    let note_id: String = db
        .sqlite()
        .query_row(
            "SELECT id FROM notes WHERE vault_id = ?1 AND rel_path = ?2",
            params![vault_id, rel_path],
            |r| r.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("索引后未找到新笔记：{}", rel_path))?;
    fetch_note_content(&note_id, db)
}

/// 创建新笔记（写 vault 原文 + 增量索引）。onboarding/今日笔记按钮触发。
#[tauri::command]
pub fn create_note(
    vault_id: String,
    rel_path: String,
    content: String,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    create_note_inner(&vault_id, &rel_path, &content, db.inner())
}

/// 今日笔记核心逻辑：07_决策与复盘/日志/YYYY-MM/YYYY-MM-DD.md。
/// 已存在 → 返回其 NoteContent（不覆盖）；不存在 → 用日志模板创建。
/// 供 TodayPage / 命令面板 / 键盘快捷键共用，DRY 路径与模板逻辑。
pub fn create_today_note_inner(vault_id: &str, db: &Database) -> Result<NoteContent, String> {
    let today = crate::utils::dates::today_iso(); // YYYY-MM-DD
    let month = &today[..7]; // YYYY-MM
    let rel_path = format!("07_决策与复盘/日志/{}/{}.md", month, today);
    // 已存在 → 查 raw + render 返回（create_note_inner 不覆盖语义的等价快捷路径）
    let existing: Option<(String, String, String)> = db
        .sqlite()
        .query_row(
            "SELECT id, rel_path, raw_content FROM notes WHERE vault_id=?1 AND rel_path=?2",
            params![vault_id, &rel_path],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        )
        .map_err(|e| e.to_string())?;
    if let Some((id, _rp, _raw)) = existing {
        // 已存在 → fetch 完整 NoteContent（含 note_type/tags/frontmatter）
        return fetch_note_content(&id, db);
    }
    // 不存在 → 日志模板创建（含示例 bullet 引导格式；create_note_inner 带路径安全 + 不覆盖 + 索引）
    let tpl = format!(
        "---\ntitle: {} 日志\ncreated: {}\n---\n\n# {}\n\n## 今日待办\n- [ ] 示例——今日要完成的事 📅 {}\n\n## 关键事件\n- 09:00 示例——与 XX 1:1\n\n## 明日待办\n- 示例——明天跟进 …\n",
        today, today, today, today
    );
    create_note_inner(vault_id, &rel_path, &tpl, db)
}

/// 今日笔记（已存在则打开，无则创建）。前端按钮 / Ctrl+J 快捷键触发。
#[tauri::command]
pub fn create_today_note(
    vault_id: String,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    create_today_note_inner(&vault_id, db.inner())
}

// ============================================================
// 行级就地写入（inline-crud）—— append_bullet / update_line / delete_line
// / patch_frontmatter / set_tag。全部经 save_note_content_inner 收口
// （.helmose/backup 备份 + 写盘 + 增量索引），返回新 NoteContent。
// 设计：命令壳解 State + inner(db) 核心可被集成测试直接调（与 toggle_task 同构）。
// ============================================================

/// 查 note 的 (rel_path, vault_root) —— 行级写入读盘共用。
fn note_rel_and_root(note_id: &str, db: &Database) -> Result<(String, PathBuf), String> {
    let row = db
        .sqlite()
        .query_row(
            "SELECT n.rel_path, v.root_path FROM notes n \
             JOIN vaults v ON v.id = n.vault_id WHERE n.id = ?1",
            params![note_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("note {} not found", note_id))?;
    Ok((row.0, PathBuf::from(row.1)))
}

/// 读盘完整文件内容（含 frontmatter）。行级写入一律在「盘完整文件」上操作，
/// 避免基于 DB raw_content（去 frontmatter 的正文）写回时丢失 frontmatter。
fn read_full(note_id: &str, db: &Database) -> Result<String, String> {
    let (rel, root) = note_rel_and_root(note_id, db)?;
    std::fs::read_to_string(root.join(&rel)).map_err(|e| format!("读取文件失败：{}", e))
}

/// full 里正文起始字节偏移（去 frontmatter 块）。无 frontmatter → 0。
fn body_start_byte(full: &str) -> usize {
    let b = full.as_bytes();
    if !(b.len() >= 3 && &b[..3] == b"---") {
        return 0;
    }
    let mut p = 3usize;
    // 跳过首行 --- 后的换行
    if p < b.len() && b[p] == b'\r' {
        p += 1;
    }
    if p < b.len() && b[p] == b'\n' {
        p += 1;
    }
    // 逐行找闭合 ---
    while p < full.len() {
        let nl = match full[p..].find('\n') {
            Some(i) => i,
            None => return full.len(),
        };
        let line = &full[p..p + nl];
        if line.trim_end_matches('\r') == "---" {
            return (p + nl + 1).min(full.len());
        }
        p += nl + 1;
    }
    full.len()
}

/// 取正文（去 frontmatter），与 indexer frontmatter::parse 同源，source_line 行号一致。
fn body_of(full: &str) -> String {
    crate::services::indexer::frontmatter::parse(full).content
}

/// 把改后的正文拼回原 frontmatter → 完整新文件（保留 fm，不丢字段）。
fn reassemble(full: &str, new_body: &str) -> String {
    let body_start = body_start_byte(full);
    let prefix = &full[..body_start];
    format!("{}{}", prefix, new_body)
}

/// 通用行级改写：按 1-based source_line 把原文对应行替换为 new_text → 复用 save。
/// task/event 文本编辑共用；new_text 为完整新行（含 bullet 前缀，前端按场景拼）。
pub fn update_line_inner(
    note_id: &str,
    source_line: i64,
    new_text: &str,
    db: &Database,
) -> Result<NoteContent, String> {
    let full = read_full(note_id, db)?;
    let body = body_of(&full);
    let mut lines: Vec<String> = body.lines().map(String::from).collect();
    let idx = (source_line - 1) as usize;
    if idx >= lines.len() {
        return Err(format!(
            "source_line {} 越界（正文共 {} 行）",
            source_line,
            lines.len()
        ));
    }
    lines[idx] = new_text.to_string();
    let mut new_body = lines.join("\n");
    if body.ends_with('\n') {
        new_body.push('\n');
    }
    let new_full = reassemble(&full, &new_body);
    save_note_content_inner(note_id, &new_full, db)
}

/// 行级改写命令壳（task/event 文本编辑触发）。
#[tauri::command]
pub fn update_line(
    note_id: String,
    source_line: i64,
    new_text: String,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    update_line_inner(&note_id, source_line, &new_text, db.inner())
}

/// 通用行级删除：按 1-based source_line 删除原文对应行 → 复用 save（删前已备份）。
/// task/event 单条删除共用。
pub fn delete_line_inner(
    note_id: &str,
    source_line: i64,
    db: &Database,
) -> Result<NoteContent, String> {
    let full = read_full(note_id, db)?;
    let body = body_of(&full);
    let mut lines: Vec<String> = body.lines().map(String::from).collect();
    let idx = (source_line - 1) as usize;
    if idx >= lines.len() {
        return Err(format!(
            "source_line {} 越界（正文共 {} 行）",
            source_line,
            lines.len()
        ));
    }
    lines.remove(idx);
    let mut new_body = lines.join("\n");
    if body.ends_with('\n') {
        new_body.push('\n');
    }
    let new_full = reassemble(&full, &new_body);
    save_note_content_inner(note_id, &new_full, db)
}

/// 行级删除命令壳（task/event 单条删除触发）。
#[tauri::command]
pub fn delete_line(
    note_id: String,
    source_line: i64,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    delete_line_inner(&note_id, source_line, db.inner())
}

/// 取标题行 `^#{1,6}` 的层级（1-6）；非标题或空标题 → None。
fn heading_level_of(line: &str) -> Option<usize> {
    let t = line.trim_start();
    let n = t.chars().take_while(|&c| c == '#').count();
    if !(1..=6).contains(&n) {
        return None;
    }
    if t[n..].trim().is_empty() {
        return None;
    }
    Some(n)
}

/// 判定该行是否为「名为 section」的标题（去 # 后 trim == section）。
fn is_heading_named(line: &str, section: &str) -> bool {
    let t = line.trim_start();
    let n = t.chars().take_while(|&c| c == '#').count();
    if !(1..=6).contains(&n) {
        return false;
    }
    t[n..].trim() == section
}

/// 定位 section 末尾的插入行索引（0-based lines Vec）。
/// 找标题行 H，向下到下一个同级/更浅标题或文末，插入点 = 该范围内最后一条非空行 + 1
/// （范围全空则紧贴标题后）。section 未找到 → None。
fn section_insert_index(lines: &[String], section: &str) -> Option<usize> {
    let heading_idx = lines
        .iter()
        .position(|l| is_heading_named(l, section))?;
    let heading_level = heading_level_of(&lines[heading_idx])?;
    let mut end = lines.len();
    for i in (heading_idx + 1)..lines.len() {
        if let Some(lvl) = heading_level_of(&lines[i]) {
            if lvl <= heading_level {
                end = i;
                break;
            }
        }
    }
    let mut last_non_empty = heading_idx;
    for i in (heading_idx + 1)..end {
        if !lines[i].trim().is_empty() {
            last_non_empty = i;
        }
    }
    Some(last_non_empty + 1)
}

/// 向指定 section 末尾追加 bullet → 复用 save。
/// as_task=true → `- [ ] {text}`（任务）；false → `- {text}`（事件）。
/// section 未找到 → Err（不静默追加到文末）。
pub fn append_bullet_inner(
    note_id: &str,
    section: &str,
    text: &str,
    as_task: bool,
    db: &Database,
) -> Result<NoteContent, String> {
    let full = read_full(note_id, db)?;
    let body = body_of(&full);
    let mut lines: Vec<String> = body.lines().map(String::from).collect();
    let insert_at = section_insert_index(&lines, section)
        .ok_or_else(|| format!("未找到 section: {}", section))?;
    let bullet = if as_task {
        format!("- [ ] {}", text)
    } else {
        format!("- {}", text)
    };
    lines.insert(insert_at, bullet);
    let mut new_body = lines.join("\n");
    if body.ends_with('\n') {
        new_body.push('\n');
    }
    let new_full = reassemble(&full, &new_body);
    save_note_content_inner(note_id, &new_full, db)
}

/// 追加 bullet 命令壳（task/event 就地新建触发）。
#[tauri::command]
pub fn append_bullet(
    note_id: String,
    section: String,
    text: String,
    as_task: bool,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    append_bullet_inner(&note_id, &section, &text, as_task, db.inner())
}

/// 序列化 YAML 标量（手写，覆盖 helmose 用到的类型：string/number/bool）。
/// string 含特殊字符（冒号/引号/#/首尾空格/YAML 指示符首字符）→ 加双引号转义；其余原样。
fn serialize_yaml_scalar(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => {
            let needs_quote = s.is_empty()
                || s.contains(':')
                || s.contains('#')
                || s.contains('"')
                || s.contains('\n')
                || s.starts_with(' ')
                || s.ends_with(' ')
                || matches!(
                    s.chars().next(),
                    Some('-') | Some('[') | Some('{') | Some('\'') | Some('&')
                        | Some('*') | Some('|') | Some('>') | Some('%') | Some('@') | Some('`')
                );
            if needs_quote {
                let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
                format!("\"{}\"", escaped)
            } else {
                s.clone()
            }
        }
        _ => value.to_string(),
    }
}

/// 定位 frontmatter 块边界（0-based）。
/// 返回 (start, end)：start = 首个 `---` 行，end = 第二个 `---` 行。要求首行是 `---`，否则 None。
fn frontmatter_bounds(lines: &[String]) -> Option<(usize, usize)> {
    if lines.is_empty() || lines[0].trim() != "---" {
        return None;
    }
    let end = (1..lines.len()).find(|&i| lines[i].trim() == "---")?;
    Some((0, end))
}

/// 改写 frontmatter 指定键（保留其余原文）。value 支持 string/number/bool。
/// 键存在 → 替换值；不存在 → 在 frontmatter 块末尾（第二个 --- 前）插入。
/// 无 frontmatter → Err（项目笔记应有，由 scaffold 保证）。
pub fn patch_frontmatter_inner(
    note_id: &str,
    key: &str,
    value: serde_json::Value,
    db: &Database,
) -> Result<NoteContent, String> {
    let full = read_full(note_id, db)?;
    let mut lines: Vec<String> = full.lines().map(String::from).collect();
    let (fm_start, fm_end) = frontmatter_bounds(&lines)
        .ok_or_else(|| "笔记无 frontmatter，无法 patch".to_string())?;
    let serialized = serialize_yaml_scalar(&value);
    let key_pat = format!("{}:", key);
    let mut found = false;
    for i in (fm_start + 1)..fm_end {
        let t = lines[i].trim_start();
        if t.starts_with(&key_pat) {
            let after = &t[key.len() + 1..];
            // 精确 key（key 后是空格或行尾），避免误匹配 keyXxx
            if after.is_empty() || after.starts_with(' ') {
                lines[i] = format!("{}: {}", key, serialized);
                found = true;
                break;
            }
        }
    }
    if !found {
        lines.insert(fm_end, format!("{}: {}", key, serialized));
    }
    let mut new_full = lines.join("\n");
    if full.ends_with('\n') {
        new_full.push('\n');
    }
    save_note_content_inner(note_id, &new_full, db)
}

/// frontmatter 字段改写命令壳（项目 priority 等触发）。
#[tauri::command]
pub fn patch_frontmatter(
    note_id: String,
    key: String,
    value: serde_json::Value,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    patch_frontmatter_inner(&note_id, &key, value, db.inner())
}

/// 操作 frontmatter tags 数组（inline 格式 `tags: [a, b, c]`）。
/// - value=Some(v)：确保存在该 tag。v == tag_prefix → 无值 tag（mainline）；否则 `{tag_prefix}:{v}`。
///   同前缀旧值（`{tag_prefix}:*`）+ 精确 `{tag_prefix}` 先移除再插入，保证唯一。
/// - value=None：移除该前缀所有 tag。
/// block-array 格式（`tags:\n  - a`）→ Err 提示手动编辑，不破坏原文。
pub fn set_tag_inner(
    note_id: &str,
    tag_prefix: &str,
    value: Option<&str>,
    db: &Database,
) -> Result<NoteContent, String> {
    let full = read_full(note_id, db)?;
    let mut lines: Vec<String> = full.lines().map(String::from).collect();
    let (fm_start, fm_end) = frontmatter_bounds(&lines)
        .ok_or_else(|| "笔记无 frontmatter，无法 set_tag".to_string())?;

    let new_tag = value.map(|v| {
        if v == tag_prefix {
            tag_prefix.to_string() // 无值 tag（mainline）
        } else {
            format!("{}:{}", tag_prefix, v)
        }
    });

    let tags_idx = (fm_start + 1..fm_end).find(|&i| {
        let t = lines[i].trim_start();
        t == "tags:" || t.starts_with("tags:")
    });

    match tags_idx {
        Some(idx) => {
            let after = lines[idx]
                .trim_start()
                .strip_prefix("tags:")
                .unwrap_or("")
                .trim();
            // block-array 检测：tags: 后空 + 下一行 `  - xxx`
            if after.is_empty() && idx + 1 < fm_end {
                let next = lines[idx + 1].trim_start();
                if next.starts_with("- ") {
                    return Err(
                        "frontmatter tags 为 block-array 格式，请手动编辑（本期仅支持 inline）"
                            .to_string(),
                    );
                }
            }
            let arr = after.trim_start_matches('[').trim_end_matches(']');
            let mut tags: Vec<String> = arr
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            let prefix_colon = format!("{}:", tag_prefix);
            tags.retain(|t| t != tag_prefix && !t.starts_with(&prefix_colon));
            if let Some(nt) = new_tag {
                tags.push(nt);
            }
            let content = if tags.is_empty() {
                "[]".to_string()
            } else {
                tags.join(", ")
            };
            lines[idx] = format!("tags: [{}]", content);
        }
        None => {
            if let Some(nt) = new_tag {
                lines.insert(fm_end, format!("tags: [{}]", nt));
            }
            // value=None 且无 tags 行 → 无操作（幂等）
        }
    }

    let mut new_full = lines.join("\n");
    if full.ends_with('\n') {
        new_full.push('\n');
    }
    save_note_content_inner(note_id, &new_full, db)
}

/// tags 改写命令壳（项目 status / mainline 触发）。
#[tauri::command]
pub fn set_tag(
    note_id: String,
    tag_prefix: String,
    value: Option<String>,
    db: State<'_, Database>,
) -> Result<NoteContent, String> {
    set_tag_inner(&note_id, &tag_prefix, value.as_deref(), db.inner())
}

/// 列出 vault 的 .helmose/backup/ 下所有备份（save 时自动生成的历史副本），按时间倒序。
#[tauri::command]
pub fn list_backups(
    vault_id: String,
    db: State<'_, Database>,
) -> Result<Vec<BackupInfo>, String> {
    let root = vault_root(&vault_id, db.inner())?;
    let backup_dir = root.join(".helmose").join("backup");
    if !backup_dir.exists() {
        return Ok(vec![]);
    }
    let mut out: Vec<BackupInfo> = std::fs::read_dir(&backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| crate::utils::dates::secs_to_iso8601(d.as_secs() as i64))
                .unwrap_or_default();
            Some(BackupInfo {
                name,
                size: meta.len(),
                mtime,
            })
        })
        .collect();
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    Ok(out)
}

/// 删除单个备份（name 不含路径分隔符，防穿越；只删 .helmose/backup/<name>）。
#[tauri::command]
pub fn delete_backup(
    vault_id: String,
    name: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("非法备份名：{}", name));
    }
    let root = vault_root(&vault_id, db.inner())?;
    let path = root.join(".helmose").join("backup").join(&name);
    if !path.exists() {
        return Ok(()); // 已不存在，幂等
    }
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

/// 列出 .helmose/trash 下的已删除笔记（软删除文件，可手动恢复/清理）。
#[tauri::command]
pub fn list_trash(
    vault_id: String,
    db: State<'_, Database>,
) -> Result<Vec<BackupInfo>, String> {
    let root = vault_root(&vault_id, db.inner())?;
    let trash = root.join(".helmose").join("trash");
    if !trash.exists() {
        return Ok(vec![]);
    }
    let mut out: Vec<BackupInfo> = std::fs::read_dir(&trash)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| crate::utils::dates::secs_to_iso8601(d.as_secs() as i64))
                .unwrap_or_default();
            Some(BackupInfo {
                name,
                size: meta.len(),
                mtime,
            })
        })
        .collect();
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    Ok(out)
}

/// 清空 .helmose/trash（永久删除所有软删除的笔记）。返回清除文件数。
#[tauri::command]
pub fn clear_trash(
    vault_id: String,
    db: State<'_, Database>,
) -> Result<i64, String> {
    let root = vault_root(&vault_id, db.inner())?;
    let trash = root.join(".helmose").join("trash");
    if !trash.exists() {
        return Ok(0);
    }
    let mut n = 0i64;
    for entry in std::fs::read_dir(&trash).map_err(|e| e.to_string())? {
        if let Ok(e) = entry {
            let p = e.path();
            if p.is_file() {
                let _ = std::fs::remove_file(&p);
                n += 1;
            }
        }
    }
    Ok(n)
}

/// 取某日的「明日一句」（前一日日志写下的次日寄语）。无则 None。
#[tauri::command]
pub fn get_tomorrow_sentence(
    vault_id: String,
    date_iso: String,
    db: State<'_, Database>,
) -> Result<Option<String>, String> {
    let s: Option<String> = db
        .sqlite()
        .query_row(
            "SELECT sentence FROM tomorrow_sentences WHERE vault_id = ?1 AND date_iso = ?2 LIMIT 1",
            params![vault_id, date_iso],
            |r| r.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(s)
}

/// 反向链接：哪些笔记的 [[wikilink]] 指向了本笔记（links.target_note_id = note_id）。
#[tauri::command]
pub fn get_backlinks(
    note_id: String,
    db: State<'_, Database>,
) -> Result<Vec<crate::models::Backlink>, String> {
    use crate::models::Backlink;
    let rows = db
        .sqlite()
        .query_map(
            "SELECT n.id, n.rel_path, n.file_name, n.title, n.note_type, n.date_iso, n.tags, \
                    l.target_text, l.alias \
             FROM links l JOIN notes n ON n.id = l.source_note_id \
             WHERE l.target_note_id = ?1 \
             ORDER BY n.date_iso DESC",
            params![note_id],
            |row| {
                let tags_json: String = row.get("tags")?;
                Ok(Backlink {
                    source: NoteMeta {
                        id: row.get("id")?,
                        rel_path: row.get("rel_path")?,
                        file_name: row.get("file_name")?,
                        title: row.get("title")?,
                        note_type: row.get("note_type")?,
                        date_iso: row.get("date_iso")?,
                        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                        mtime: 0,
                    },
                    target_text: row.get("target_text")?,
                    alias: row.get("alias")?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 前向链接：本文链接了哪些笔记（links.source_note_id = note_id → 目标 note）。
/// 复用 Backlink DTO（source 字段 = 目标 note 的元数据）。只返回已解析（非 dangling）的；
/// dangling（指向不存在的目标）提示留 backlog。
#[tauri::command]
pub fn get_forward_links(
    note_id: String,
    db: State<'_, Database>,
) -> Result<Vec<crate::models::Backlink>, String> {
    use crate::models::Backlink;
    let rows = db
        .sqlite()
        .query_map(
            "SELECT n.id, n.rel_path, n.file_name, n.title, n.note_type, n.date_iso, n.tags, \
                    l.target_text, l.alias \
             FROM links l JOIN notes n ON n.id = l.target_note_id \
             WHERE l.source_note_id = ?1 \
             ORDER BY n.date_iso DESC",
            params![note_id],
            |row| {
                let tags_json: String = row.get("tags")?;
                Ok(Backlink {
                    source: NoteMeta {
                        id: row.get("id")?,
                        rel_path: row.get("rel_path")?,
                        file_name: row.get("file_name")?,
                        title: row.get("title")?,
                        note_type: row.get("note_type")?,
                        date_iso: row.get("date_iso")?,
                        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                        mtime: 0,
                    },
                    target_text: row.get("target_text")?,
                    alias: row.get("alias")?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 图谱数据：双链关系（nodes + edges），按连接度数取 top N 防超大库卡前端。
#[tauri::command]
pub fn get_graph_data(
    vault_id: String,
    limit: Option<i64>,
    db: State<'_, Database>,
) -> Result<crate::models::GraphData, String> {
    use crate::models::{GraphData, GraphEdge, GraphNode};
    use std::collections::{HashMap, HashSet};

    let max = limit.unwrap_or(1000) as usize;

    // 所有已解析的正向链接
    let raw_edges: Vec<(String, String)> = db
        .sqlite()
        .query_map(
            "SELECT source_note_id, target_note_id FROM links \
             WHERE vault_id = ?1 AND target_note_id IS NOT NULL",
            params![vault_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?;

    // 按度数取 top N 节点
    let mut degree: HashMap<String, usize> = HashMap::new();
    for (s, t) in &raw_edges {
        *degree.entry(s.clone()).or_insert(0) += 1;
        *degree.entry(t.clone()).or_insert(0) += 1;
    }
    let mut ranked: Vec<(String, usize)> = degree.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1));
    let keep: HashSet<String> = ranked.into_iter().take(max).map(|(id, _)| id).collect();

    let edges: Vec<GraphEdge> = raw_edges
        .iter()
        .filter(|(s, t)| keep.contains(s) && keep.contains(t))
        .map(|(s, t)| GraphEdge {
            source: s.clone(),
            target: t.clone(),
        })
        .collect();

    // 节点元数据（动态 IN 查询）
    let nodes: Vec<GraphNode> = if keep.is_empty() {
        Vec::new()
    } else {
        let ids: Vec<String> = keep.into_iter().collect();
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let mut pv: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len());
        for id in &ids {
            pv.push(id as &dyn rusqlite::ToSql);
        }
        let sql = format!(
            "SELECT id, COALESCE(title, file_name), note_type FROM notes WHERE id IN ({})",
            placeholders
        );
        db.sqlite()
            .query_map(&sql, &pv, |row| {
                Ok(GraphNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    note_type: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
    };

    Ok(GraphData { nodes, edges })
}

/// pulldown-cmark 渲染 md → HTML（启用 GFM 表格 / 任务列表 / 删除线）。
/// 渲染前先预处理 wikilink `[[x]]` 为可点 <a>（见 render_wikilinks）。
fn render_markdown(md: &str) -> String {
    use pulldown_cmark::{html, Options, Parser};

    let md = render_wikilinks(md);
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_STRIKETHROUGH);

    let parser = Parser::new_ext(&md, opts);
    let mut out = String::with_capacity(md.len().saturating_mul(2));
    html::push_html(&mut out, parser);
    out
}

// wikilink 渲染正则：[[target]] / [[target|alias]]（与 indexer/wikilinks.rs 同口径）
static RE_WIKILINK_RENDER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap());

/// HTML 属性值转义（防注入 / 防破坏 data-target 引号）
fn esc_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

/// HTML 文本转义
fn esc_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// 把正文里的 wikilink `[[x]]` / `[[x|y]]` 预处理为可点 `<a>`（带 data-target）。
/// 跳过 ``` / ~~~ fenced code block（代码里的字面 [[x]] 不应变链接）。
/// pulldown-cmark 默认透传 inline HTML，故替换后再走 markdown 渲染即可。
fn render_wikilinks(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    let mut in_fence = false;
    for line in md.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            out.push_str(line);
            out.push('\n');
            continue;
        }
        if in_fence {
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let replaced = RE_WIKILINK_RENDER.replace_all(line, |caps: &regex::Captures| {
            let target = caps[1].split('#').next().unwrap_or("").trim();
            if target.is_empty() {
                return caps[0].to_string(); // 原样保留（如 [[#anchor]]）
            }
            let alias = caps.get(2).map(|m| m.as_str().trim()).unwrap_or(target);
            format!(
                "<a class=\"helmose-wikilink\" data-target=\"{}\">{}</a>",
                esc_attr(target),
                esc_html(alias)
            )
        });
        out.push_str(&replaced);
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wikilink_basic_replaced() {
        let s = render_wikilinks("见 [[袁锐钦]] 和 [[Picboil|出海工具]]");
        assert!(s.contains("data-target=\"袁锐钦\""));
        assert!(s.contains("data-target=\"Picboil\""));
        assert!(s.contains(">出海工具<")); // alias 作为显示文本
    }

    #[test]
    fn wikilink_skipped_in_code_fence() {
        let s = render_wikilinks("正文 [[x]]\n```\n代码 [[y]]\n```\n尾 [[z]]");
        assert!(s.contains("data-target=\"x\""));
        assert!(!s.contains("data-target=\"y\"")); // 代码块内不替换
        assert!(s.contains("data-target=\"z\""));
    }

    #[test]
    fn markdown_renders_wikilink_as_link() {
        let html = render_markdown("见 [[袁锐钦]]");
        assert!(html.contains("helmose-wikilink"));
        assert!(html.contains("data-target=\"袁锐钦\""));
    }

    /// list_notes_by_tag：精确匹配 tags JSON 数组元素，不误命中含相同前缀的 tag。
    #[test]
    fn list_notes_by_tag_精确匹配() {
        use crate::commands::index::index_vault_inner;

        let (_tmp, vid, vault_dir, db) = setup_lib();
        // A: tags=["project","web"]；B: tags=["project-status:active"]
        std::fs::write(
            vault_dir.join("a.md"),
            "---\ntitle: A\ntype: project\ntags: [project, web]\n---\n# A\n",
        )
        .unwrap();
        std::fs::write(
            vault_dir.join("b.md"),
            "---\ntitle: B\ntype: project\ntags: [project-status:active]\n---\n# B\n",
        )
        .unwrap();
        index_vault_inner(&vid, &db).unwrap();

        // 精确查 "project" → 只命中 A（B 的 "project-status:active" 不精确匹配 "project"）
        let res = list_notes_by_tag_inner(&vid, "project", None, &db).unwrap();
        let names: Vec<&str> = res.iter().map(|m| m.file_name.as_str()).collect();
        assert!(
            names.contains(&"a.md"),
            "应命中 A（精确 project 标签），实际 {:?}",
            names
        );
        assert!(
            !names.contains(&"b.md"),
            "不应命中 B（project-status:active 是另一个标签），实际 {:?}",
            names
        );
    }

    /// create_note_inner：写 vault 原文 + 索引 + 不覆盖 + 路径穿越拒（铁律：用户动作触发）。
    #[test]
    fn create_note_inner_creates_and_indexes() {
        let (_tmp, vid, vault_dir, db) = setup_lib();

        let rel = "07_决策与复盘/日志/2026-07/2026-07-01.md";
        let content = "# 2026-07-01\n\n## 今日待办\n- [ ] 写测试 📅 2026-07-01\n";
        let nc = create_note_inner(&vid, rel, content, &db).expect("应创建成功");
        assert!(vault_dir.join(rel).exists(), "文件应已写入 vault");
        assert_eq!(nc.rel_path, rel);
        // 索引后 notes 表应有行，且 due_date 已解析
        let cnt: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE vault_id = ?1 AND rel_path = ?2",
                params![vid, rel],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert_eq!(cnt, 1, "notes 表应有该笔记");
        let due: Option<String> = db
            .sqlite()
            .query_row(
                "SELECT due_date FROM tasks WHERE vault_id = ?1 LIMIT 1",
                params![vid],
                |r| r.get::<_, Option<String>>(0),
            )
            .unwrap()
            .flatten();
        assert_eq!(due.as_deref(), Some("2026-07-01"), "新笔记的 task due_date 应已索引");

        // 不覆盖已存在
        let err = create_note_inner(&vid, rel, "覆盖", &db);
        assert!(err.is_err(), "已存在文件应报错不覆盖");

        // 路径穿越拒
        let err2 = create_note_inner(&vid, "../escape.md", "x", &db);
        assert!(err2.is_err(), ".. 路径应拒");
    }

    /// save_note_content 集成测试：写回 vault → .helmose/backup 备份 → FTS 命中新内容 → raw_content 更新。
    /// 用临时 vault（非 ~/wiki），用户明确「保存」动作写原文，符合铁律。
    #[test]
    fn save_note_content_backs_up_and_reindexes() {
        use crate::commands::index::index_vault_inner;
        use crate::commands::vault::add_vault_inner;
        use crate::models::VaultInput;

        let _tmp = tempfile::TempDir::new().unwrap();
        let vault_dir = _tmp.path().to_path_buf();
        let db_path = _tmp.path().join("test.db");
        let db = Database::new(db_path).unwrap();
        db.init_schema().unwrap();

        // 旧内容（含「旧关键词」）
        let note_path = vault_dir.join("note.md");
        std::fs::write(&note_path, "# 标题\n\n旧关键词\n").unwrap();

        // add_vault + 全量索引
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

        // 取 note_id
        let note_id: String = db
            .sqlite()
            .query_row(
                "SELECT id FROM notes WHERE vault_id = ?1 AND file_name = 'note.md'",
                params![&v.id],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .unwrap();

        // 保存新内容（含「积分商城」新词）
        let new_content = "# 标题\n\n改为积分商城新词\n";
        save_note_content_inner(&note_id, new_content, &db).unwrap();

        // 1. .helmose/backup/ 下应有备份文件
        let backup_dir = vault_dir.join(".helmose").join("backup");
        let backup_count = std::fs::read_dir(&backup_dir)
            .map(|it| it.count())
            .unwrap_or(0);
        assert!(backup_count > 0, ".helmose/backup/ 应有备份文件");

        // 2. vault 原文已更新
        let on_disk = std::fs::read_to_string(&note_path).unwrap();
        assert!(on_disk.contains("积分商城"), "vault 原文应更新为新内容");

        // 3. FTS 命中新内容
        let fts_hit: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH '\"积分商城\"'",
                &[],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert!(fts_hit > 0, "FTS 应命中新内容「积分商城」");

        // 4. notes.raw_content 已更新（save 后 note id = 新 content_hash，按 file_name 重查）
        let raw: String = db
            .sqlite()
            .query_row(
                "SELECT raw_content FROM notes WHERE vault_id = ?1 AND file_name = 'note.md'",
                params![&v.id],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .unwrap_or_default();
        assert!(raw.contains("积分商城"), "notes.raw_content 应更新为新内容");
    }

    /// delete_note：软删除（移到 .helmose/trash）+ DB 级联清除 + 文件可恢复。
    #[test]
    fn delete_note_inner_软删除可恢复() {
        use crate::commands::index::index_vault_inner;
        let (_tmp, vid, vault_dir, db) = setup_lib();
        std::fs::write(vault_dir.join("a.md"), "# A\n- [ ] t\n").unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let note_id: String = db
            .sqlite()
            .query_row("SELECT id FROM notes WHERE file_name='a.md'", &[], |r| r.get::<_, String>(0))
            .unwrap()
            .unwrap();
        assert!(vault_dir.join("a.md").exists(), "删除前文件应在");

        let dest = delete_note_inner(&note_id, &db).unwrap();
        assert!(!vault_dir.join("a.md").exists(), "删除后原文件应移走");
        assert!(!dest.is_empty(), "应返回 trash 路径");
        // trash 里应有文件（可恢复）
        let trash = vault_dir.join(".helmose").join("trash");
        assert!(trash.exists(), "trash 目录应存在");
        assert_eq!(std::fs::read_dir(&trash).unwrap().count(), 1, "trash 应有 1 个文件");

        // DB 行级联清除
        let cnt: i64 = db
            .sqlite()
            .query_row("SELECT COUNT(*) FROM notes WHERE id=?1", params![&note_id], |r| r.get(0))
            .unwrap()
            .unwrap_or(1);
        assert_eq!(cnt, 0, "notes 行应已清除");
    }

    /// create_today_note：创建今日笔记 + 幂等（已存在返回同一笔记不覆盖）。
    #[test]
    fn create_today_note_创建与幂等() {
        let (_tmp, vid, vault_dir, db) = setup_lib();

        let today = crate::utils::dates::today_iso();
        // 首次：创建
        let nc1 = create_today_note_inner(&vid, &db).expect("首次应创建");
        assert!(
            nc1.rel_path.ends_with(&format!("{}.md", today)),
            "路径应以今天日期结尾，实际 {}",
            nc1.rel_path
        );
        assert!(vault_dir.join(&nc1.rel_path).exists(), "文件应已写入 vault");
        assert!(nc1.raw_content.contains("## 今日待办"), "应使用日志模板");

        // 第二次：幂等，返回同一笔记（不覆盖、不报错）
        let nc2 = create_today_note_inner(&vid, &db).expect("二次应返回已存在");
        assert_eq!(nc1.id, nc2.id, "已存在应返回同一 id，不覆盖");
    }

    /// toggle_task：勾选改 checkbox [ ]→[x] 写回 vault + tasks.done 同步。
    #[test]
    fn toggle_task_inner_勾选改checkbox() {
        use crate::commands::index::index_vault_inner;
        let (_tmp, vid, vault_dir, db) = setup_lib();
        std::fs::write(
            vault_dir.join("t.md"),
            "# T\n\n- [ ] 待办\n- [x] 已完成\n",
        )
        .unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let note_id: String = db
            .sqlite()
            .query_row("SELECT id FROM notes WHERE file_name='t.md'", &[], |r| r.get::<_, String>(0))
            .unwrap()
            .unwrap();
        // source_line：text 全局查（checkbox 类有行号；不限定 note_id，因 toggle 后 id 会随 content_hash 变）
        let line: i64 = db
            .sqlite()
            .query_row(
                "SELECT source_line FROM tasks WHERE text='待办'",
                &[],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap();
        assert!(line > 0, "checkbox 类任务应有 source_line");

        // 勾选 → [ ] 变 [x]（content_hash 变 → note id 变；用 file_name 重查当前 id）
        let cur_id = || -> String {
            db.sqlite()
                .query_row("SELECT id FROM notes WHERE file_name='t.md'", &[], |r| r.get::<_, String>(0))
                .unwrap()
                .unwrap()
        };
        let nc = toggle_task_inner(&note_id, line, true, &db).unwrap();
        assert!(nc.raw_content.contains("- [x] 待办"), "返回 raw 应含 [x] 待办");
        let done: i64 = db
            .sqlite()
            .query_row("SELECT done FROM tasks WHERE text='待办'", &[], |r| r.get(0))
            .unwrap()
            .unwrap_or(0);
        assert_eq!(done, 1, "tasks.done 应同步为 1");

        // 反向：取消勾选（用 toggle 后的新 id，旧 id 已失效）
        toggle_task_inner(&cur_id(), line, false, &db).unwrap();
        let done2: i64 = db
            .sqlite()
            .query_row("SELECT done FROM tasks WHERE text='待办'", &[], |r| r.get(0))
            .unwrap()
            .unwrap_or(1);
        assert_eq!(done2, 0, "取消后 done 应回 0");
    }

    /// 通用临时 vault + DB（TempDir RAII：drop 自动清理 vault_dir + db，零残留）。内联测试共用。
    fn setup_lib() -> (tempfile::TempDir, String, std::path::PathBuf, Database) {
        let tmp = tempfile::TempDir::new().unwrap();
        let vid = uuid::Uuid::new_v4().to_string();
        let vault_dir = tmp.path().to_path_buf();
        let db_path = tmp.path().join(format!("db_{}.db", vid));
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

    /// 行级写入测试辅助：建临时 vault + 单篇笔记 n.md（TempDir 自动清理）。
    fn setup_line_vault(content: &str) -> (tempfile::TempDir, std::path::PathBuf, Database, String) {
        use crate::commands::index::index_vault_inner;
        let (tmp, vid, vault_dir, db) = setup_lib();
        std::fs::write(vault_dir.join("n.md"), content).unwrap();
        index_vault_inner(&vid, &db).unwrap();
        let note_id = cur_note_id(&db);
        (tmp, vault_dir, db, note_id)
    }

    /// 按 file_name=n.md 查当前 note_id（写入后 content_hash 变，id 会变，每次重查）。
    fn cur_note_id(db: &Database) -> String {
        db.sqlite()
            .query_row(
                "SELECT id FROM notes WHERE file_name='n.md'",
                &[],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .unwrap()
    }

    #[test]
    fn update_line_改指定行() {
        let (_tmp, vault_dir, db, note_id) = setup_line_vault("# T\n\n## 今日待办\n- [ ] 旧任务\n");
        // "- [ ] 旧任务" 在第 4 行
        let nc = update_line_inner(&note_id, 4, "- [ ] 新任务", &db).expect("应改成功");
        assert!(nc.raw_content.contains("- [ ] 新任务"), "raw 应含新文本");
        assert!(!nc.raw_content.contains("旧任务"), "raw 不应再含旧文本");
        let on_disk = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(on_disk.contains("- [ ] 新任务"), "vault 原文应已更新");
        // 越界
        let err = update_line_inner(&cur_note_id(&db), 999, "x", &db);
        assert!(err.is_err(), "越界应 Err");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn delete_line_删指定行() {
        let (_tmp, vault_dir, db, note_id) =
            setup_line_vault("# T\n\n## 今日待办\n- [ ] 任务A\n- [ ] 任务B\n");
        let nc = delete_line_inner(&note_id, 4, &db).expect("应删成功");
        assert!(nc.raw_content.contains("任务B"), "任务B 应保留");
        assert!(!nc.raw_content.contains("任务A"), "任务A 应已删除");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn append_bullet_追加到_section_末尾() {
        let (_tmp, vault_dir, db, note_id) =
            setup_line_vault("# T\n\n## 今日待办\n- [ ] 旧\n\n## 关键事件\n- 旧事件\n");
        // 追加 task 到「今日待办」（应插在 `- [ ] 旧` 后、`## 关键事件` 前）
        let nc = append_bullet_inner(&note_id, "今日待办", "新任务", true, &db).unwrap();
        assert!(nc.raw_content.contains("- [ ] 新任务"), "应含新 task bullet");
        let todo_pos = nc.raw_content.find("- [ ] 新任务").unwrap();
        let evt_pos = nc.raw_content.find("## 关键事件").unwrap();
        assert!(todo_pos < evt_pos, "新 task 应落在今日待办段内、关键事件之前");

        // 追加 event 到「关键事件」（无 checkbox）
        let nc2 = append_bullet_inner(&cur_note_id(&db), "关键事件", "新事件", false, &db).unwrap();
        assert!(nc2.raw_content.contains("- 新事件"), "应含新 event bullet（无 checkbox）");

        // section 不存在 → Err
        let err = append_bullet_inner(&cur_note_id(&db), "不存在的section", "x", true, &db);
        assert!(err.is_err(), "section 不存在应 Err");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn patch_frontmatter_改字段与插入新键() {
        let (_tmp, vault_dir, db, note_id) =
            setup_line_vault("---\ntitle: P\ntype: project\npriority: 100\n---\n# P\n");
        // 改已存在 priority（save 链路返回的 raw_content 是去 fm 正文，故读盘验 fm 字段）
        patch_frontmatter_inner(&note_id, "priority", serde_json::json!(200), &db).unwrap();
        let on_disk = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(on_disk.contains("priority: 200"), "应改 priority 为 200");
        assert!(on_disk.contains("title: P"), "其余键应保留");

        // 插入不存在的新键
        patch_frontmatter_inner(&cur_note_id(&db), "okr", serde_json::json!("Q2"), &db).unwrap();
        let on_disk2 = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(on_disk2.contains("okr: Q2"), "应插入新键 okr");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn patch_frontmatter_无frontmatter报错() {
        let (_tmp, vault_dir, db, note_id) = setup_line_vault("# 无 fm\n");
        let err = patch_frontmatter_inner(&note_id, "priority", serde_json::json!(1), &db);
        assert!(err.is_err(), "无 frontmatter 应 Err");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn set_tag_替换status_与切换mainline() {
        let (_tmp, vault_dir, db, note_id) = setup_line_vault(
            "---\ntitle: P\ntype: project\ntags: [project-status:active, web]\n---\n# P\n",
        );
        // 替换 project-status:active → paused（保留 web）；raw_content 去 fm，读盘验 tags
        set_tag_inner(&note_id, "project-status", Some("paused"), &db).unwrap();
        let on_disk = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(on_disk.contains("project-status:paused"), "应替换为 paused");
        assert!(on_disk.contains("web"), "无关 tag web 应保留");
        assert!(!on_disk.contains("project-status:active"), "旧 status 应移除");

        // 加 mainline（无值 tag：tag_prefix == value）
        set_tag_inner(&cur_note_id(&db), "mainline", Some("mainline"), &db).unwrap();
        let on_disk2 = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(on_disk2.contains("mainline"), "应加 mainline tag");

        // 删 mainline（None）—— 精确移除 mainline，不影响 project-status:paused
        set_tag_inner(&cur_note_id(&db), "mainline", None, &db).unwrap();
        let on_disk3 = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(on_disk3.contains("project-status:paused"), "status 应保留");
        // mainline 作为独立 tag 应被移除（retain 删精确 mainline）
        let tags_line = on_disk3
            .lines()
            .find(|l| l.trim_start().starts_with("tags:"))
            .unwrap_or("");
        assert!(
            !tags_line.split(|c: char| c == ',' || c == '[' || c == ']')
                .any(|s| s.trim() == "mainline"),
            "mainline 应已移除：{}",
            tags_line
        );
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn set_tag_无tags行_新建() {
        let (_tmp, vault_dir, db, note_id) =
            setup_line_vault("---\ntitle: P\ntype: project\n---\n# P\n");
        set_tag_inner(&note_id, "project-status", Some("active"), &db).unwrap();
        let on_disk = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(
            on_disk.contains("tags: [project-status:active]"),
            "无 tags 行应新建：{}",
            on_disk
        );
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn set_tag_block_array_报错不破坏原文() {
        let (_tmp, vault_dir, db, note_id) = setup_line_vault(
            "---\ntitle: P\ntype: project\ntags:\n  - project-status:active\n---\n# P\n",
        );
        let err = set_tag_inner(&note_id, "project-status", Some("paused"), &db);
        assert!(err.is_err(), "block-array 应 Err 提示手动编辑");
        let on_disk = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(
            on_disk.contains("project-status:active"),
            "block-array 报错不应破坏原文"
        );
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    /// save_note_body 核心契约：只更正文，保留全部 frontmatter（不丢 type/tags/priority/created）。
    /// 动机：getNoteContent 返回的 raw 是去 fm 正文，WYSIWYG 只编辑正文；
    /// 若直接 save_note_content(正文) 会丢 fm，故 save_note_body 读盘拼回 fm。本测试锁定该行为。
    #[test]
    fn save_note_body_保留frontmatter() {
        let (_tmp, vault_dir, db, note_id) = setup_line_vault(
            "---\ntitle: T\ntype: project\ntags: [project-status:active]\npriority: 50\n---\n# T\n\n旧正文\n",
        );
        let nc = save_note_body_inner(&note_id, "# T\n\n新正文内容\n", &db).unwrap();
        // 盘上 fm 全保留 + 正文已更新
        let on_disk = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(on_disk.contains("title: T"), "应保留 title");
        assert!(on_disk.contains("type: project"), "应保留 type");
        assert!(on_disk.contains("project-status:active"), "应保留 tags");
        assert!(on_disk.contains("priority: 50"), "应保留 priority");
        assert!(on_disk.contains("新正文内容"), "正文应更新");
        assert!(!on_disk.contains("旧正文"), "旧正文应被替换");
        // 返回 NoteContent.raw_content 是去 fm 正文（与 get_note_content 同源）
        assert!(nc.raw_content.contains("新正文内容"), "返回 raw 应为新正文");
        assert!(!nc.raw_content.contains("title:"), "返回 raw 不应含 fm");
        // frontmatter 字段在返回值里也能取到（字段表单用）
        assert_eq!(nc.note_type.as_deref(), Some("project"), "返回 note_type 应为 project");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    // ============ M3 set_task_* 集成测试 ============

    /// 取当前 note_id（按 file_name 重查，因 content_hash 变 id 会变）。
    fn cur_line_note_id(db: &Database) -> String {
        db.sqlite()
            .query_row(
                "SELECT id FROM notes WHERE file_name='n.md'",
                &[],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .unwrap()
    }

    /// 取某 text 的 source_line（checkbox 类有行号；用 text 匹配不绑 note_id）。
    fn source_line_of(db: &Database, text: &str) -> i64 {
        db.sqlite()
            .query_row(
                "SELECT source_line FROM tasks WHERE text=?1",
                params![text],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap()
    }

    #[test]
    fn set_task_status_inner_切换todo_done() {
        let (_tmp, vault_dir, db, note_id) =
            setup_line_vault("# T\n\n## 今日待办\n- [ ] 任务A\n");
        let line = source_line_of(&db, "任务A");
        // 切 done → bullet 变 `- [x] 任务A`
        let nc = set_task_status_inner(&note_id, line, "done", &db).expect("应成功");
        assert!(nc.raw_content.contains("- [x] 任务A"), "raw 应含 [x] 任务A");
        let on_disk = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(on_disk.contains("- [x] 任务A"), "vault 原文应切到 [x]");

        // tasks.done 派生字段同步为 1
        let done: i64 = db
            .sqlite()
            .query_row("SELECT done FROM tasks WHERE text='任务A'", &[], |r| r.get(0))
            .unwrap()
            .unwrap_or(0);
        assert_eq!(done, 1, "tasks.done 应同步为 1（status=done）");

        // 切回 todo → bullet 变 `- [ ] 任务A`
        set_task_status_inner(&cur_line_note_id(&db), line, "todo", &db).unwrap();
        let on_disk2 = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(on_disk2.contains("- [ ] 任务A"), "vault 原文应切回 [ ]");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn set_task_status_inner_切doing用斜杠() {
        let (_tmp, vault_dir, db, note_id) =
            setup_line_vault("# T\n\n## 今日待办\n- [ ] 任务\n");
        let line = source_line_of(&db, "任务");
        let nc = set_task_status_inner(&note_id, line, "doing", &db).unwrap();
        assert!(nc.raw_content.contains("- [/] 任务"), "doing 应切到 [/] 前缀");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn set_task_status_inner_emoji_刷新被清理() {
        // bullet 内已有 🔄 → 切 todo 后 🔄 应被清理（前缀已表达 status）
        let (_tmp, vault_dir, db, note_id) =
            setup_line_vault("# T\n\n## 今日待办\n- [ ] 任务 🔄\n");
        let line = source_line_of(&db, "任务");
        set_task_status_inner(&note_id, line, "todo", &db).unwrap();
        let on_disk = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(!on_disk.contains("🔄"), "切 todo 后 🔄 应被清理");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn set_task_priority_inner_补星与清空() {
        let (_tmp, vault_dir, db, note_id) =
            setup_line_vault("# T\n\n## 今日待办\n- [ ] 任务\n");
        let line = source_line_of(&db, "任务");
        // priority=2 → 补 ⭐⭐
        set_task_priority_inner(&note_id, line, 2, &db).unwrap();
        let on_disk = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(on_disk.contains("- [ ] 任务 ⭐⭐"), "应补 2 颗 ⭐");

        // priority=0 → 清空所有 ⭐
        set_task_priority_inner(&cur_line_note_id(&db), line, 0, &db).unwrap();
        let on_disk2 = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(!on_disk2.contains("⭐"), "priority=0 应清空所有 ⭐");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn set_task_urgency_inner_加火与删火() {
        let (_tmp, vault_dir, db, note_id) =
            setup_line_vault("# T\n\n## 今日待办\n- [ ] 任务\n");
        let line = source_line_of(&db, "任务");
        // urgency=high → 加 🔥
        set_task_urgency_inner(&note_id, line, "high", &db).unwrap();
        let on_disk = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(on_disk.contains("- [ ] 任务 🔥"), "应加 🔥");

        // urgency=low → 删 🔥
        set_task_urgency_inner(&cur_line_note_id(&db), line, "low", &db).unwrap();
        let on_disk2 = std::fs::read_to_string(vault_dir.join("n.md")).unwrap();
        assert!(!on_disk2.contains("🔥"), "low 应删 🔥");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn set_task_status_inner_越界报错() {
        let (_tmp, vault_dir, _db, note_id) =
            setup_line_vault("# T\n\n## 今日待办\n- [ ] 任务\n");
        let err = set_task_status_inner(&note_id, 999, "done", &_db);
        assert!(err.is_err(), "越界 source_line 应 Err");
        let _ = std::fs::remove_dir_all(&vault_dir);
    }

    /// completed_at：done 任务首次索引填入；增量重索引（编辑笔记）保留旧值不刷新。
    /// 验证 upsert_rel 的 old_completed 缓存（跨重索引保留首完时间）。
    #[test]
    fn completed_at_跨增量重索引保留() {
        let (_tmp, _vault_dir, db, _note_id) =
            setup_line_vault("# T\n\n## 今日待办\n- [x] 任务\n");
        // 首次索引：[x] 任务 → status=done，completed_at 填 T1
        let t1: String = db
            .sqlite()
            .query_row("SELECT completed_at FROM tasks WHERE text='任务'", &[], |r| r.get(0))
            .unwrap()
            .unwrap();
        assert!(!t1.is_empty(), "done 任务首次索引应填 completed_at");

        // 编辑笔记（追加无关 section，触发增量重索引）：completed_at 应保留 T1，不刷新
        let cur = cur_line_note_id(&db);
        save_note_body_inner(
            &cur,
            "# T\n\n## 今日待办\n- [x] 任务\n\n## 备注\n编辑触发重索引\n",
            &db,
        )
        .unwrap();
        let t2: String = db
            .sqlite()
            .query_row("SELECT completed_at FROM tasks WHERE text='任务'", &[], |r| r.get(0))
            .unwrap()
            .unwrap();
        assert_eq!(t2, t1, "增量重索引应保留旧 completed_at（不刷新为首完时间）");
        let _ = &_tmp;
    }

    // ============ ux-overhaul review：白名单校验回归 ============

    /// set_task_status 命令壳入口拒绝非法 status（review 要求）。
    /// Tauri State 在单元测试不可直接构造，故测共享的 validate_task_status 纯函数
    /// （命令壳入口与 inner 共用同一校验逻辑，覆盖此函数 = 覆盖命令壳拒绝路径）。
    #[test]
    fn validate_task_status_拒绝非法值() {
        // 合法值
        assert!(validate_task_status("todo").is_ok());
        assert!(validate_task_status("doing").is_ok());
        assert!(validate_task_status("done").is_ok());
        // 非法值
        let err = validate_task_status("bad").expect_err("非法 status 应 Err");
        assert!(err.contains("非法 status"), "Err 文案应含「非法 status」: {}", err);
        assert!(err.contains("bad"), "Err 文案应含原值: {}", err);
        // 大小写敏感（避免 silent 兜底；前端契约小写）
        assert!(validate_task_status("TODO").is_err(), "大写应拒（前端契约小写）");
        assert!(validate_task_status("").is_err(), "空串应拒");
        assert!(validate_task_status("done\n").is_err(), "带换行应拒");
    }

    /// set_task_urgency 命令壳入口拒绝非法 urgency。
    #[test]
    fn validate_task_urgency_拒绝非法值() {
        assert!(validate_task_urgency("high").is_ok());
        assert!(validate_task_urgency("mid").is_ok());
        assert!(validate_task_urgency("low").is_ok());
        let err = validate_task_urgency("urgent").expect_err("非法 urgency 应 Err");
        assert!(err.contains("非法 urgency"), "Err 文案应含「非法 urgency」: {}", err);
        assert!(err.contains("urgent"), "Err 应含原值");
        assert!(validate_task_urgency("HIGH").is_err(), "大写应拒");
    }

    /// set_task_priority 命令壳入口拒绝越界 priority（替换旧 clamp 静默兜底）。
    #[test]
    fn validate_task_priority_拒绝越界() {
        // 合法 0-3
        for p in 0..=3 {
            assert!(validate_task_priority(p).is_ok(), "priority={} 应合法", p);
        }
        // 越界
        let err = validate_task_priority(-1).expect_err("priority=-1 应 Err");
        assert!(err.contains("非法 priority"), "Err 应含「非法 priority」: {}", err);
        assert!(err.contains("-1"), "Err 应含原值");
        assert!(validate_task_priority(4).is_err(), "priority=4 应 Err");
        assert!(validate_task_priority(100).is_err(), "priority=100 应 Err");
        assert!(validate_task_priority(i32::MIN).is_err(), "i32::MIN 应 Err");
        assert!(validate_task_priority(i32::MAX).is_err(), "i32::MAX 应 Err");
    }

    /// set_task_priority_inner 仍保留 clamp 防御（review 允许 inner 防御性 clamp）。
    /// 锁定行为：即便绕过命令壳传 priority=99，inner 也不 panic、不写越界 ⭐，按 clamp(0,3)=3 兜底。
    /// 这是 inner 的最后一道防线（命令壳已 Err 拦截，但 inner 自身仍要稳）。
    #[test]
    fn set_task_priority_inner_越界clamp防御() {
        let (_tmp, vault_dir, db, note_id) =
            setup_line_vault("# T\n\n## 今日待办\n- [ ] 任务\n");
        let line = source_line_of(&db, "任务");
        // priority=99 → inner clamp 到 3（防御性兜底，不 panic）
        let nc = set_task_priority_inner(&note_id, line, 99, &db).expect("inner 应 clamp 不 Err");
        assert!(
            nc.raw_content.matches('⭐').count() == 3,
            "priority=99 应 clamp 到 3 颗 ⭐，实际 raw: {}",
            nc.raw_content
        );
        let _ = std::fs::remove_dir_all(&vault_dir);
    }
}
