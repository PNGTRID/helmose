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
use regex::Regex;
use rusqlite::params;
use std::path::PathBuf;
use tauri::State;

/// 路径安全校验：任一段为 `..` 即拒。返回 true 表示安全。
fn is_safe_rel(rel: &str) -> bool {
    !rel.split(|c| c == '/' || c == '\\').any(|c| c == "..")
}

/// 行内是否含「路径型引用」的链接形式。覆盖三种写法：
///   ① markdown inline link：`[text](old)` / `[text](old "title")`
///   ② wikilink：`[[old]]` / `[[old|alias]]` / `[[old#heading]]`
///   ③ reference-style 定义：行首 `[ref]: old`（destination 是 old；使用方 `[text][ref]` 不含路径，无需改）
///
/// 用正则锚定链接语法边界，替代裸 `line.contains(old)`——后者会把 old 当子串误判，
/// 例如 old=`源.md` 时 `[x](my源.md)` 行也 contains 命中，但它是无关链接（指向 my源.md 文件），
/// 不应进 refs_to_update。本函数只承认 old 出现在链接语法位置才算真引用。
///
/// 不覆盖（已知限制，记 backlog）：autolink `<old>`（Obsidian vault 几乎不用）。
fn line_has_path_ref(line: &str, old: &str) -> bool {
    let esc = regex::escape(old);
    // ① markdown inline：](old) 或 ](old "title")——路径后紧跟 ) 或空白
    let md_ok = Regex::new(&format!(r"\]\({}[)\s]", esc))
        .map(|re| re.is_match(line))
        .unwrap_or(false);
    // ② wikilink：[[old]] / [[old|alias]] / [[old#heading]]——路径后紧跟 ] 或 | 或 #
    let wk_ok = Regex::new(&format!(r"\[\[{}[\]\|#]", esc))
        .map(|re| re.is_match(line))
        .unwrap_or(false);
    // ③ reference-style 定义：行首（至多 3 空格缩进）[ref]: old，old 后是空白（接 title）或行尾
    let ref_ok = Regex::new(&format!(r"^\s{{0,3}}\[[^\]]+\]:\s*{}(\s|$)", esc))
        .map(|re| re.is_match(line))
        .unwrap_or(false);
    md_ok || wk_ok || ref_ok
}

/// 把行内的路径型引用 old → new（仅链接形式，不动子串误匹配）。
///
/// 与 line_has_path_ref 同源 3 正则；不匹配则原样返回。
/// 用捕获组保留链接后置字符，避免吞掉 wikilink 的 alias/heading 或 reference 的 title/行尾。
///
/// 不变量（detect 与 apply 的关系）：
///   - detect 报的是**行数**（每个 RefLoc = 1 行），同一行多种链接形式合并为 1 个 RefLoc；
///   - apply 改的是**该行内所有指向 old 的链接形式**——一行可能有多个链接，apply 全改。
///   - 故「detect 命中的行 apply 必改」成立，但「RefLoc 条数 = 实际替换次数」不一定（一行多链接时替换数 > RefLoc 数）。
fn replace_path_refs(line: &str, old: &str, new: &str) -> String {
    let esc = regex::escape(old);
    let md_re = match Regex::new(&format!(r"\]\({}([)\s])", esc)) {
        Ok(re) => re,
        Err(_) => return line.to_string(),
    };
    let wk_re = match Regex::new(&format!(r"\[\[{}([\]\|#])", esc)) {
        Ok(re) => re,
        Err(_) => return line.to_string(),
    };
    let ref_re = match Regex::new(&format!(r"^(\s{{0,3}}\[[^\]]+\]:\s*){}(\s|$)", esc)) {
        Ok(re) => re,
        Err(_) => return line.to_string(),
    };
    // ① markdown inline：](old<post>) → ](new<post>)
    let after_md = md_re.replace_all(line, |c: &regex::Captures| {
        format!("]({}{}", new, &c[1])
    });
    // ② wikilink：[[old<post> → [[new<post>
    let after_wk = wk_re.replace_all(&after_md, |c: &regex::Captures| {
        format!("[[{}{}", new, &c[1])
    });
    // ③ reference-style 定义：<前缀>old<后置> → <前缀>new<后置>（闭包返回值是字面 String，不被当反向引用模板）
    let after_ref = ref_re.replace_all(&after_wk, |c: &regex::Captures| {
        format!("{}{}{}", &c[1], new, &c[2])
    });
    after_ref.into_owned()
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

/// 扫描所有其他笔记 raw_content，找含 `old_path` **链接形式**的行。
/// 匹配（line_has_path_ref 三种形式）：① markdown inline `[t](old)`；② wikilink `[[old]]`/`[[old|...]]`/`[[old#...]]`；
/// ③ reference-style 定义 `[ref]: old`。按文件名匹配的反链（`[[文件名]]`）由 links 表自动维护，不进此列表。
///
/// 三级过滤：① SQL `LIKE %old%` 全表扫找候选笔记（走不了索引，单次 move 可接受）；
///          ② 逐行 `contains` 快速剔除绝大多数无关行（避免每行都编译正则）；
///          ③ `line_has_path_ref` 正则锚定链接边界，剔除「old 是子串」的误报
///            （如 old=`源.md` 时 `[x](my源.md)` 行 contains 命中但不是真引用，不报）。
///
/// 返回 RefLoc 按**行**计（同一行多种链接形式合并为 1 个 RefLoc）；apply 会改该行内全部指向 old 的链接。
fn detect_path_refs(
    vault_id: &str,
    note_id: &str,
    old_path: &str,
    new_path: &str,
    db: &Database,
) -> Result<Vec<RefLoc>, String> {
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
            // contains 先过滤（剔除绝大多数不含 old 的行），再 line_has_path_ref 精确判断链接形式
            if line.contains(old_path) && line_has_path_ref(line, old_path) {
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
    let r = move_note_inner(&note_id, &target_dir, db.inner())?;
    // 审计：vault 写操作留轨迹（old→new + 检测到的路径型引用数，便于排障/回溯）
    tracing::info!(
        note_id = %note_id,
        old_rel = %r.old_rel_path,
        new_rel = %r.new_rel_path,
        refs = r.refs_to_update.len(),
        "move_note 完成"
    );
    Ok(r)
}

/// 重命名笔记（命令壳）。
#[tauri::command]
pub fn rename_note(
    note_id: String,
    new_file_name: String,
    db: State<'_, Database>,
) -> Result<MoveResult, String> {
    let r = rename_note_inner(&note_id, &new_file_name, db.inner())?;
    tracing::info!(
        note_id = %note_id,
        old_rel = %r.old_rel_path,
        new_rel = %r.new_rel_path,
        refs = r.refs_to_update.len(),
        "rename_note 完成"
    );
    Ok(r)
}

/// 移笔记到回收站（vault/.trash/，不直接删，可恢复）。
///
/// 行为：
///   1. fetch note loc（rel_path + root + vault_id）
///   2. 算 .trash 目标：保留原 rel 结构便于还原；已存在则文件名加 epoch 秒后缀防覆盖
///   3. fs::rename 移到 .trash/
///   4. incremental::remove_rel 从索引移除（外键级联派生 tasks/links/okrs/events）
///
/// 不处理路径型引用：删除无「新路径」，引用清理属另一动作（不同于 move）。
/// .trash 被排除目录契约保护（隐藏目录 `.` 开头，见 utils/exclude.rs），
/// watcher 不会把移过去的文件重新索引回来——否则删除会失效。
/// 返回 .trash 内的相对路径（前端提示用）。
pub fn move_to_trash_inner(note_id: &str, db: &Database) -> Result<String, String> {
    use crate::services::indexer::incremental;
    use std::time::{SystemTime, UNIX_EPOCH};

    let (old_rel, _file_name, root_path, vault_id) = fetch_note_loc(note_id, db)?;
    if !is_safe_rel(&old_rel) {
        return Err(format!("非法路径（含 ..）：{}", old_rel));
    }
    let root = PathBuf::from(&root_path);
    let old_abs = root.join(&old_rel);
    if !old_abs.exists() {
        return Err(format!(
            "源文件不存在（可能已被外部移动/删除）：{}",
            old_rel
        ));
    }

    // .trash 目标：保留原 rel 结构便于用户从回收站还原到原位置。
    let mut trash_rel = format!(".trash/{}", old_rel);
    let mut trash_abs = root.join(&trash_rel);
    if trash_abs.exists() {
        // 冲突（同名的两次删除都保留）：文件名加 epoch 秒后缀，目录结构与扩展名不变。
        let p = std::path::Path::new(&old_rel);
        let parent_rel = p.parent().and_then(|x| x.to_str()).filter(|s| !s.is_empty());
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("md");
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let new_name = format!("{}_{}.{}", stem, secs, ext);
        trash_rel = match parent_rel {
            Some(d) => format!(".trash/{}/{}", d, new_name),
            None => format!(".trash/{}", new_name),
        };
        trash_abs = root.join(&trash_rel);
    }

    if let Some(parent) = trash_abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&old_abs, &trash_abs).map_err(|e| e.to_string())?;

    // 从索引移除（外键级联清派生表）。.trash 已被排除契约挡在索引之外。
    incremental::remove_rel(db, &vault_id, &old_rel).map_err(|e| e.to_string())?;

    Ok(trash_rel)
}

/// 移笔记到回收站（命令壳）。
#[tauri::command]
pub fn move_to_trash(note_id: String, db: State<'_, Database>) -> Result<String, String> {
    let trash_rel = move_to_trash_inner(&note_id, db.inner())?;
    tracing::info!(note_id = %note_id, trash_rel = %trash_rel, "move_to_trash 完成");
    Ok(trash_rel)
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

        // 按行替换：定位 line（1-based），仅该行内把 old_path 的链接形式 → new_path。
        // 多条引用可能命中同一行（一次 replace_path_refs 全改）或不同行（逐行 replace）。
        let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
        for r in refs {
            let idx = (r.line as usize).saturating_sub(1);
            if idx < lines.len() {
                // 审查 #11：r.line 是 move 时的快照行号；apply 与 move 之间若用户编辑了该笔记，
                // 行号会漂移 → 盲替换会误伤无关行。replace_path_refs 只改链接形式，不匹配则原样返回；
                // 对比 before/after 判断是否真改，未改 = 行已不含旧路径链接（编辑/行漂移/子串误报）→ 跳过并告警。
                let before = lines[idx].clone();
                let after = replace_path_refs(&before, &r.old_path, &r.new_path);
                if after != before {
                    lines[idx] = after;
                } else {
                    tracing::warn!(
                        note_id = %r.note_id,
                        line = r.line,
                        old_path = %r.old_path,
                        "apply_ref_updates: 该行已不含旧路径的链接形式（笔记被编辑/行漂移/子串误报），跳过"
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
    use crate::commands::library::migrate_task_markers_inner;
    use crate::models::MigratePlan;

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

    /// detect 不应把「old 是子串」的无关链接报为路径型引用。
    /// old=`源.md`，他篇只含 `[x](my源.md)`（指向另一文件 my源.md，非真引用）→ refs_to_update 为空。
    /// 防的是：裸 `line.contains(old)` 会把 `my源.md` 当命中，apply 时误改成 `my归档/源.md` 破坏无关链接。
    #[test]
    fn move_note_子串不误报路径引用() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("源.md"), "# 源\n").unwrap();
        // 他篇含 my源.md（old 的超串），但不是指向「源.md」的真链接
        std::fs::write(vault_dir.join("other.md"), "# 其它\n\n- [x](my源.md) 文件\n").unwrap();
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
        assert_eq!(
            result.refs_to_update.len(),
            0,
            "my源.md 是另一文件，不应被误报为「源.md」的路径引用：{:?}",
            result.refs_to_update
        );
        let _ = &_tmp;
    }

    /// apply 只改链接形式的 old_path，不动子串出现（防误伤无关链接）。
    /// 行同时含 `[my源.md](my源.md)`（无关）和 `[详情](源.md)`（真引用），apply 后只改后者。
    #[test]
    fn apply_ref_updates_子串误伤_只改链接形式() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("源.md"), "# 源\n").unwrap();
        // 同一行：无关子串链接 + 真引用
        std::fs::write(
            vault_dir.join("ref.md"),
            "# 引用\n\n[my源.md](my源.md) 和 [详情](源.md)。\n",
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

        // apply：把第 3 行的 `源.md` 链接换成 `归档/源.md`
        let refs = vec![RefLoc {
            note_id: ref_id.clone(),
            line: 3,
            old_path: "源.md".to_string(),
            new_path: "归档/源.md".to_string(),
        }];
        let n = apply_ref_updates_inner(&refs, &db).expect("apply 应成功");
        assert_eq!(n, 1, "应更新 1 篇笔记");

        let content = std::fs::read_to_string(vault_dir.join("ref.md")).unwrap();
        // 真引用已更新
        assert!(
            content.contains("[详情](归档/源.md)"),
            "真引用应替换为新路径：{}",
            content
        );
        // 无关子串链接未被误伤（关键：my源.md 不应变 my归档/源.md）
        assert!(
            content.contains("[my源.md](my源.md)"),
            "子串误伤防护：my源.md 不应被误改为归档/源.md：{}",
            content
        );
        let _ = &_tmp;
    }

    /// apply 支持 reference-style link 定义：行 `[ref]: old` 的 destination 更新，
    /// 使用方 `[text][ref]` 不含路径不动。
    #[test]
    fn apply_ref_updates_支持_reference_style_link定义() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("源.md"), "# 源\n").unwrap();
        // 使用方 [详情][r] + 定义 [r]: 源.md（定义在第 5 行）
        std::fs::write(
            vault_dir.join("ref.md"),
            "# 引用\n\n[详情][r]\n\n[r]: 源.md\n",
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

        // apply：第 5 行的 `[r]: 源.md` 定义 → `[r]: 归档/源.md`
        let refs = vec![RefLoc {
            note_id: ref_id.clone(),
            line: 5,
            old_path: "源.md".to_string(),
            new_path: "归档/源.md".to_string(),
        }];
        let n = apply_ref_updates_inner(&refs, &db).expect("apply 应成功");
        assert_eq!(n, 1, "应更新 1 篇笔记");

        let content = std::fs::read_to_string(vault_dir.join("ref.md")).unwrap();
        // reference 定义已更新
        assert!(
            content.contains("[r]: 归档/源.md"),
            "reference 定义 destination 应更新：{}",
            content
        );
        // 使用方 [详情][r] 不含路径，不动
        assert!(
            content.contains("[详情][r]\n"),
            "使用方不含路径不应被改动：{}",
            content
        );
        let _ = &_tmp;
    }

    /// apply 的 new_path 含 `$1` 字面字符时，闭包返回值不应被 regex 当反向引用解析。
    /// 锁死「replace_all 闭包返回 String 是字面值」不变量（防 `$N` 把 new_path 当模板误解析）。
    #[test]
    fn apply_ref_updates_new_path含美元符_字面保留() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("a.md"), "# A\n").unwrap();
        // 同一行两个 inline link 都指向 a.md
        std::fs::write(
            vault_dir.join("ref.md"),
            "# 引用\n\n[x](a.md) 和 [y](a.md)\n",
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

        // new_path 含 `$1`（regex 模板的反向引用语法），应字面保留不被解析
        let refs = vec![RefLoc {
            note_id: ref_id.clone(),
            line: 3,
            old_path: "a.md".to_string(),
            new_path: "$1/sub.md".to_string(),
        }];
        apply_ref_updates_inner(&refs, &db).expect("apply 应成功");

        let content = std::fs::read_to_string(vault_dir.join("ref.md")).unwrap();
        // 两个链接都应替换为字面 $1/sub.md（若被当反向引用会变 /sub.md 或空）
        assert_eq!(
            content.matches("$1/sub.md").count(),
            2,
            "new_path 的 $1 应字面保留（两处都替换），不应当反向引用：{}",
            content
        );
        let _ = &_tmp;
    }

    /// 删除笔记：移到 .trash/ + 从索引移除 + .trash 被排除契约挡住（重索引不捞回）。
    #[test]
    fn move_to_trash_移到回收站并清索引() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("待删.md"), "# 删\n内容\n").unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let id: String = db
            .sqlite()
            .query_row(
                "SELECT id FROM notes WHERE file_name='待删.md'",
                &[],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap();

        let trash_rel = move_to_trash_inner(&id, &db).expect("trash 应成功");
        assert_eq!(trash_rel, ".trash/待删.md");
        // 原位置文件已移走，回收站有文件
        assert!(!vault_dir.join("待删.md").exists());
        assert!(vault_dir.join(".trash").join("待删.md").exists());

        // 索引已移除（原 rel_path 查不到）
        let count: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE vault_id=?1 AND rel_path='待删.md'",
                params![&vid],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap();
        assert_eq!(count, 0, "原 rel_path 应已从索引移除");

        // .trash 被排除契约保护：全量重索引也不会把回收站文件捞回
        index_vault_inner(&vid, &db).unwrap();
        let trash_count: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE vault_id=?1 AND rel_path LIKE '.trash/%'",
                params![&vid],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap();
        assert_eq!(trash_count, 0, ".trash 下的文件不应被索引");
        let _ = &_tmp;
    }

    /// 删除同名笔记：.trash/ 已有同名文件时，文件名加 epoch 秒后缀防覆盖，目录结构与扩展名不变。
    #[test]
    fn move_to_trash_同名冲突_epoch后缀防覆盖() {
        let (_tmp, vid, vault_dir, db) = setup();
        // 先在 .trash/ 放一个同名文件（模拟之前删过同路径笔记）
        std::fs::create_dir_all(vault_dir.join(".trash")).unwrap();
        std::fs::write(vault_dir.join(".trash").join("待删.md"), "# 旧的已删\n").unwrap();
        // 当前 vault 有同名「待删.md」
        std::fs::write(vault_dir.join("待删.md"), "# 新的待删\n内容\n").unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let id: String = db
            .sqlite()
            .query_row(
                "SELECT id FROM notes WHERE file_name='待删.md' AND rel_path='待删.md'",
                &[],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap();

        let trash_rel = move_to_trash_inner(&id, &db).expect("trash 应成功");
        // 应加 epoch 后缀（待删_<secs>.md），不复用旧路径
        assert!(
            trash_rel.starts_with(".trash/待删_"),
            "应加 epoch 后缀防覆盖：{}",
            trash_rel
        );
        assert!(trash_rel.ends_with(".md"), "扩展名应保留：{}", trash_rel);
        // 两个文件都在（旧的 待删.md + 新的 待删_<secs>.md），未覆盖
        assert!(
            vault_dir.join(".trash").join("待删.md").exists(),
            "旧的 .trash/待删.md 应保留未被覆盖"
        );
        let trash_files: Vec<_> = std::fs::read_dir(vault_dir.join(".trash"))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().to_string_lossy().contains("待删"))
            .collect();
        assert_eq!(
            trash_files.len(),
            2,
            ".trash 下应有 2 个待删文件（旧的 + epoch 后缀的新的）：{:?}",
            trash_files.iter().map(|e| e.path().to_string_lossy().to_string()).collect::<Vec<_>>()
        );
        // 原位置文件已移走
        assert!(
            !vault_dir.join("待删.md").exists(),
            "原位置文件应已移走"
        );
        let _ = &_tmp;
    }

    /// migrate dry-run：返回 before/after 预览，但不写盘（vault 原文不变 + 无备份）。
    #[test]
    fn migrate_dryrun_不写盘且预览正确() {
        let (_tmp, vid, vault_dir, db) = setup();
        // 含 due 但无 priority/urgency 标记的任务（温和版下在象限，需迁移固化）
        std::fs::write(vault_dir.join("t.md"), "- [ ] 买牛奶 📅 2026-07-10\n").unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let (id, line): (String, i64) = db
            .sqlite()
            .query_row(
                "SELECT note_id, source_line FROM tasks WHERE vault_id=?1",
                params![&vid],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
            )
            .map_err(|e| e.to_string())
            .unwrap()
            .unwrap();

        let plans = vec![MigratePlan {
            note_id: id,
            source_line: line,
            priority: 1,
            urgency: "low".into(),
        }];
        let preview = migrate_task_markers_inner(&plans, "helmose", true, &db).expect("dry-run 应成功");
        assert!(!preview.applied, "dry-run applied 应为 false");
        assert_eq!(preview.item_count, 1);
        assert_eq!(preview.items.len(), 1);
        // after 应含 priority:1 + urgency:low，且 due 标记保留（strip_* 只剥 priority/urgency 段）
        assert!(preview.items[0].after.contains("priority:1"), "after 应含 priority:1");
        assert!(preview.items[0].after.contains("urgency:low"), "after 应含 urgency:low");
        assert!(preview.items[0].after.contains("📅 2026-07-10"), "due 标记应保留");

        // vault 原文未变（dry-run 不写盘）
        let content = std::fs::read_to_string(vault_dir.join("t.md")).unwrap();
        assert!(!content.contains("priority:1"), "dry-run 不应写入 vault：{}", content);
        // 无备份（dry-run 不 save）
        let backup_dir = vault_dir.join(".helmose").join("backup");
        let backup_count = std::fs::read_dir(&backup_dir).map(|d| d.count()).unwrap_or(0);
        assert_eq!(backup_count, 0, "dry-run 不应生成备份");
        let _ = &_tmp;
    }

    /// migrate 真迁移：固化 priority/urgency + 保留 due + 生成备份 + 索引更新。
    #[test]
    fn migrate_真迁移固化象限并备份() {
        let (_tmp, vid, vault_dir, db) = setup();
        std::fs::write(vault_dir.join("t.md"), "- [ ] 写报告 📅 2026-07-10\n").unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let (id, line): (String, i64) = db
            .sqlite()
            .query_row(
                "SELECT note_id, source_line FROM tasks WHERE vault_id=?1",
                params![&vid],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
            )
            .map_err(|e| e.to_string())
            .unwrap()
            .unwrap();

        let plans = vec![MigratePlan {
            note_id: id,
            source_line: line,
            priority: 2,
            urgency: "high".into(),
        }];
        let preview = migrate_task_markers_inner(&plans, "helmose", false, &db).expect("迁移应成功");
        assert!(preview.applied, "实际写 applied 应为 true");

        // vault 原文已固化（priority:2 + urgency:high + due 保留）
        let content = std::fs::read_to_string(vault_dir.join("t.md")).unwrap();
        assert!(content.contains("priority:2"), "应写入 priority:2：{}", content);
        assert!(content.contains("urgency:high"), "应写入 urgency:high：{}", content);
        assert!(content.contains("📅 2026-07-10"), "due 标记应保留");

        // .helmose/backup 生成备份
        let backup_dir = vault_dir.join(".helmose").join("backup");
        let backups: Vec<_> = std::fs::read_dir(&backup_dir).unwrap().filter_map(|e| e.ok()).collect();
        assert!(!backups.is_empty(), "应生成备份");

        // 索引更新：tasks 表 priority=2, urgency=high（tasks 无 rel_path，join notes 按 rel_path 查；
        // 重索引后 note_id 随 content_hash 变，但 rel_path 稳定）
        let (pri, urg): (i32, String) = db
            .sqlite()
            .query_row(
                "SELECT t.priority, t.urgency FROM tasks t JOIN notes n ON t.note_id=n.id \
                 WHERE t.vault_id=?1 AND n.rel_path='t.md'",
                params![&vid],
                |r| Ok((r.get::<_, i32>(0)?, r.get::<_, String>(1)?)),
            )
            .map_err(|e| e.to_string())
            .unwrap()
            .unwrap();
        assert_eq!(pri, 2);
        assert_eq!(urg, "high");
        let _ = &_tmp;
    }

    /// migrate 保留缩进 + checkbox + 多 plan 同 note 合并一次 save。
    #[test]
    fn migrate_保留缩进与checkbox_多plan合并() {
        let (_tmp, vid, vault_dir, db) = setup();
        // 缩进子任务（2 空格）+ checkbox
        std::fs::write(vault_dir.join("t.md"), "- [ ] 父任务\n  - [ ] 子任务\n").unwrap();
        index_vault_inner(&vid, &db).unwrap();

        // 取父+子两个任务（按 source_line 排序）。query_map 返回 Vec（闭包 Ok 已解包，非 Result）
        let rows: Vec<(String, i64)> = db
            .sqlite()
            .query_map(
                "SELECT note_id, source_line FROM tasks WHERE vault_id=?1 ORDER BY source_line",
                params![&vid],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
            )
            .map_err(|e| e.to_string())
            .unwrap();
        assert_eq!(rows.len(), 2, "应有父+子两个任务");

        let plans: Vec<MigratePlan> = rows
            .iter()
            .map(|(id, line)| MigratePlan {
                note_id: id.clone(),
                source_line: *line,
                priority: 1,
                urgency: "low".into(),
            })
            .collect();
        let preview = migrate_task_markers_inner(&plans, "helmose", false, &db).expect("迁移应成功");
        // 两个 plan 同 note → 合并 1 次 read/save
        assert_eq!(preview.note_count, 1, "同 note 多 plan 应合并成 1 次");
        assert_eq!(preview.item_count, 2);

        // 原文：父行 + 子行都固化（priority:1 出现 2 次），缩进 + checkbox 保留
        let content = std::fs::read_to_string(vault_dir.join("t.md")).unwrap();
        assert_eq!(
            content.matches("priority:1").count(),
            2,
            "父+子两行都应含 priority:1：{}",
            content
        );
        assert!(content.contains("  - [ ] 子任务"), "子行缩进 + checkbox 应保留：{}", content);
        let _ = &_tmp;
    }
}
