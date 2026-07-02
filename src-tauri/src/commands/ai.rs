// ============================================================
// AI 教练命令（M4）—— ai_mainline / ai_coach / ai_tomorrow
//
// 设计要点（设计文档 M4.2/M4.3 + 错误处理 2/3）：
//   1. **数据最小化**：gather_state 只发聚合摘要（项目名 + priority + status + 进度数字），
//      绝不发 vault 原文。LLM 拿不到敏感细节，只用于全局决策。
//   2. **降级链**：未配 key / build_client None → 本地启发式（projects top-3）
//      → ai_generations 上次缓存 → 空态。每级标注 source。
//   3. **LLM 失败不 panic**：捕获 AiError → 走降级（成功 source=ai / 兜底 source=heuristic）。
//   4. **写回 vault 经 append_bullet/update_line 收口**（task 21 明日寄语），
//      不自写 fs::write（备份 + 重索引统一）。
// ============================================================

use crate::commands::settings::{get_ai_generation_inner, upsert_ai_generation_inner};
use crate::models::{AiCoachResult, AiMainline, AiTomorrowResult};
use crate::services::ai::{build_client, complete_with_budget, AiClient};
use crate::services::Database;
use crate::utils::dates;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

// ============================================================
// 聚合状态（gather_state）—— 所有 AI 命令共用的输入构造器
// ============================================================

/// 单个项目的聚合摘要（发给 LLM 的最小数据单元）。
/// 不含 vault 原文 / 详细任务列表，只发 name + priority + status + 进度数字。
#[derive(Debug, Clone)]
struct ProjectDigest {
    name: String,
    priority: Option<f64>,
    status: Option<String>,
    is_mainline: bool,
    last_activity: Option<String>,
    total: i64,
    done: i64,
    due_overdue: i64,
}

/// 聚合 vault 当前状态为摘要（projects + 全局统计）。
/// 输出 serde_json::Value，调方把它序列化进 LLM 的 user 字段。
fn gather_state(vault_id: &str, db: &Database) -> Result<Value, String> {
    let today = dates::today_iso();

    // 项目列表（按 priority 降序 + 主线置顶）
    let projects = gather_projects(vault_id, db, &today)?;

    // 全局统计
    let pending = count_db(
        db,
        "SELECT COUNT(*) FROM tasks WHERE vault_id = ?1 AND status <> 'done'",
        params![vault_id],
    )?;
    let today_done = count_db(
        db,
        "SELECT COUNT(*) FROM tasks WHERE vault_id = ?1 AND status = 'done' AND completed_at LIKE ?2",
        params![vault_id, format!("{}%", today)],
    )?;
    let overdue = count_db(
        db,
        "SELECT COUNT(*) FROM tasks WHERE vault_id = ?1 AND status <> 'done' AND due_date IS NOT NULL AND due_date < ?2",
        params![vault_id, &today],
    )?;

    Ok(json!({
        "date_iso": today,
        "stats": {
            "pending_tasks": pending,
            "today_done": today_done,
            "overdue": overdue,
        },
        "projects": projects,
    }))
}

/// 聚合所有项目的 digest（name + priority + status + 进度）。
/// 按 priority 降序、主线置顶排序（与启发式降级排序一致）。
fn gather_projects(vault_id: &str, db: &Database, today: &str) -> Result<Vec<Value>, String> {
    let rows = db.sqlite().query_map(
        "SELECT p.id, p.name, p.priority, p.status, p.is_mainline, p.last_activity, \
                COUNT(t.id) AS total, \
                SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS done_cnt, \
                SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date < ?2 AND t.status<>'done' THEN 1 ELSE 0 END) AS overdue \
         FROM projects p \
         LEFT JOIN tasks t ON t.project_id = p.id \
         WHERE p.vault_id = ?1 \
         GROUP BY p.id, p.name, p.priority, p.status, p.is_mainline, p.last_activity \
         ORDER BY p.is_mainline DESC, p.priority DESC, p.last_activity DESC",
        params![vault_id, today],
        |r| {
            let is_main: i64 = r.get("is_mainline")?;
            Ok(ProjectDigest {
                name: r.get::<_, String>("name")?,
                priority: r.get::<_, Option<f64>>("priority")?,
                status: r.get::<_, Option<String>>("status")?,
                is_mainline: is_main != 0,
                last_activity: r.get::<_, Option<String>>("last_activity")?,
                total: r.get::<_, i64>("total")?,
                done: r.get::<_, i64>("done_cnt")?,
                due_overdue: r.get::<_, i64>("overdue")?,
            })
        },
    ).map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|d| {
            json!({
                "name": d.name,
                "priority": d.priority.unwrap_or(0.0),
                "status": d.status,
                "is_mainline": d.is_mainline,
                "last_activity": d.last_activity,
                "tasks_total": d.total,
                "tasks_done": d.done,
                "tasks_overdue": d.due_overdue,
            })
        })
        .collect())
}

/// 统计标量（COUNT），缺值回落 0
fn count_db(db: &Database, sql: &str, args: &[&dyn rusqlite::ToSql]) -> Result<i64, String> {
    db.sqlite()
        .query_row(sql, args, |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())
        .map(|o| o.unwrap_or(0))
}

// 注：count_db 接收 &[&dyn ToSql]，调用方用 rusqlite::params![] 构造（自动协变到 &dyn）。

// ============================================================
// 启发式降级兜底 —— LLM 失败 / key 空时用 projects top-3 算主线
// ============================================================

/// 本地启发式算主线（projects top-1 by priority + activity）。
/// 复用 indexer/projects.rs apply_global_passes 的 top-3 排序口径（priority desc → activity desc），
/// 但独立实现（不依赖 ParsedNote 全集，直接用 DB projects 表）。
fn heuristic_mainline(vault_id: &str, db: &Database) -> Result<AiMainline, String> {
    // 优先 is_mainline=1 的（indexer 已判定的主线）
    let mainline_first: Option<(String,)> = db
        .sqlite()
        .query_row(
            "SELECT name FROM projects WHERE vault_id = ?1 AND is_mainline = 1 \
             ORDER BY priority DESC, last_activity DESC LIMIT 1",
            params![vault_id],
            |r| Ok((r.get::<_, String>(0)?,)),
        )
        .map_err(|e| e.to_string())?;

    let name = if let Some((n,)) = mainline_first {
        n
    } else {
        // 无主线标记 → top-1 by priority + activity
        let fallback: Option<(String,)> = db
            .sqlite()
            .query_row(
                "SELECT name FROM projects WHERE vault_id = ?1 \
                 ORDER BY priority DESC NULLS LAST, last_activity DESC NULLS LAST LIMIT 1",
                params![vault_id],
                |r| Ok((r.get::<_, String>(0)?,)),
            )
            .map_err(|e| e.to_string())?;
        match fallback {
            Some((n,)) => n,
            None => {
                return Ok(AiMainline {
                    project_name: String::new(),
                    reason: "无活跃项目，暂无主线".to_string(),
                    source: "heuristic".to_string(),
                });
            }
        }
    };

    Ok(AiMainline {
        project_name: name.clone(),
        reason: format!("本地推断：{} 是优先级最高的活跃项目", name),
        source: "heuristic".to_string(),
    })
}

// ============================================================
// ai_mainline 命令 —— 主线判定（LLM + 降级链）
// ============================================================

/// 写 life_state_snapshots.mainline_project（按 date upsert）。
fn write_mainline_snapshot(
    db: &Database,
    date_iso: &str,
    mainline_project: &str,
) -> Result<(), String> {
    let now = dates::now_iso8601();
    db.sqlite()
        .execute(
            "INSERT INTO life_state_snapshots (date_iso, generated_at, mainline_project, sideline_projects, top_tasks) \
             VALUES (?1, ?2, ?3, '[]', '[]') \
             ON CONFLICT(date_iso) DO UPDATE SET \
               generated_at = excluded.generated_at, \
               mainline_project = excluded.mainline_project",
            params![date_iso, now, mainline_project],
        )
        .map_err(|e| format!("写 life_state_snapshots 失败: {}", e))?;
    Ok(())
}

/// AI 主线判定核心逻辑（可被集成测试直接调用，绕过 Tauri State / AppHandle）。
/// 降级链：client None/LLM 失败 → 启发式 → ai_generations 缓存 → 空态。
/// 审查 #15：删去无用的 settings 参数（client 已在外层 build_client 构造，settings 不再需要）。
pub async fn ai_mainline_inner(
    vault_id: &str,
    ai_client: Option<&dyn AiClient>,
    db: &Database,
) -> Result<AiMainline, String> {
    let date_iso = dates::today_iso();

    // 1. AI 分支（client 提供时）
    if let Some(client) = ai_client {
        let state = gather_state(vault_id, db)?;
        let state_str = serde_json::to_string_pretty(&state).unwrap_or_default();
        let system = "你是人生教练，从项目状态判断当前最重要的主线项目。只回答项目名+一句话理由，格式：项目名|理由";
        let user = format!("项目状态：\n{}", state_str);

        match complete_with_budget(client, system, &user).await {
            Ok(text) => {
                // 解析「项目名|理由」
                let (name, reason) = parse_mainline_response(&text);
                let result = AiMainline {
                    project_name: name,
                    reason,
                    source: "ai".to_string(),
                };
                // 写 ai_generations 缓存（失败记日志，审查 #6——原 let _ = 全吞）
                let cached = serde_json::to_string(&result).unwrap_or_default();
                log_err(
                    upsert_ai_generation_inner(vault_id, &date_iso, "mainline", &cached, db),
                    "写 ai_generations 缓存(mainline)",
                );
                log_err(
                    write_mainline_snapshot(db, &date_iso, &result.project_name),
                    "写 life_state 快照(mainline)",
                );
                return Ok(result);
            }
            Err(e) => {
                tracing::warn!("ai_mainline LLM 失败，走降级: {}", e);
                // 落到下面启发式
            }
        }
    }

    // 2. 启发式降级
    let mut result = heuristic_mainline(vault_id, db)?;
    // 3. 启发式也空（无项目）→ 读 ai_generations 上次缓存
    if result.project_name.is_empty() {
        if let Some(cached) = get_ai_generation_inner(vault_id, &date_iso, "mainline", db)? {
            if let Ok(prev) = serde_json::from_str::<AiMainline>(&cached) {
                // 缓存也标 source=cached 表示来自上次结果
                let mut prev_cached = prev;
                prev_cached.source = "cached".to_string();
                result = prev_cached;
            }
        }
    } else {
        // 启发式有结果 → 也写 ai_generations 缓存（下次 AI 失败时可读）
        let cached = serde_json::to_string(&result).unwrap_or_default();
        log_err(
            upsert_ai_generation_inner(vault_id, &date_iso, "mainline", &cached, db),
            "写 ai_generations 缓存(mainline)",
        );
        log_err(
            write_mainline_snapshot(db, &date_iso, &result.project_name),
            "写 life_state 快照(mainline)",
        );
    }
    Ok(result)
}

/// 解析 LLM 「项目名|理由」 格式响应。失败时退整段为 reason + 空项目名。
fn parse_mainline_response(text: &str) -> (String, String) {
    let t = text.trim();
    if let Some(idx) = t.find('|') {
        let name = t[..idx].trim().to_string();
        let reason = t[idx + 1..].trim().to_string();
        if !name.is_empty() {
            return (name, reason);
        }
    }
    (String::new(), t.to_string())
}

/// AI 主线判定命令壳。前端 TodayPage / 主线卡片触发。
#[tauri::command]
pub async fn ai_mainline(
    vault_id: String,
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<AiMainline, String> {
    let client = client_from_app(&app);
    ai_mainline_inner(&vault_id, client.as_deref(), db.inner()).await
}

/// 从 AppHandle 读 settings 并构造 client（三个 AI 命令壳共用，审查 #8/#16）。
/// 复用 commands::settings::read_ai_settings——避免在 ai.rs 重写一份 config.json 解析逻辑
/// 与 settings.rs 漂移（原 read_settings_for_command 与 ai_settings_from_json 是同逻辑双拷贝）。
fn client_from_app(app: &AppHandle) -> Option<Box<dyn AiClient>> {
    let settings = crate::commands::settings::read_ai_settings(app)?;
    build_client(&settings)
}

/// 记 Result 错误到 warn（AI 缓存/快照写入失败统一处理，审查 #6——原 14 处 `let _ =` 全吞无日志）。
fn log_err<T, E: std::fmt::Display>(r: Result<T, E>, ctx: &str) {
    if let Err(e) = r {
        tracing::warn!("{} 失败: {}", ctx, e);
    }
}

// ============================================================
// ai_coach 命令 —— 每日教练建议（LLM + 降级链）
// ============================================================

/// 写 life_state_snapshots.today_focus（按 date upsert）。
fn write_today_focus_snapshot(
    db: &Database,
    date_iso: &str,
    today_focus: &str,
) -> Result<(), String> {
    let now = dates::now_iso8601();
    db.sqlite()
        .execute(
            "INSERT INTO life_state_snapshots (date_iso, generated_at, today_focus, sideline_projects, top_tasks) \
             VALUES (?1, ?2, ?3, '[]', '[]') \
             ON CONFLICT(date_iso) DO UPDATE SET \
               generated_at = excluded.generated_at, \
               today_focus = excluded.today_focus",
            params![date_iso, now, today_focus],
        )
        .map_err(|e| format!("写 life_state_snapshots.today_focus 失败: {}", e))?;
    Ok(())
}

/// 聚合今日待办列表（top 5 due_date ASC，仅元数据，无正文）。
fn gather_today_todos(vault_id: &str, db: &Database) -> Result<Vec<Value>, String> {
    let today = dates::today_iso();
    let rows = db
        .sqlite()
        .query_map(
            "SELECT text, due_date FROM tasks \
             WHERE vault_id = ?1 AND status <> 'done' AND due_date = ?2 \
             ORDER BY source_line LIMIT 5",
            params![vault_id, today],
            |r| {
                Ok(json!({
                    "text": r.get::<_, String>(0)?,
                    "due_date": r.get::<_, Option<String>>(1)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 启发式教练建议：基于今日完成数 / 待办 / 逾期数 / 主题线生成模板化建议。
fn heuristic_coach(vault_id: &str, db: &Database) -> Result<AiCoachResult, String> {
    let state = gather_state(vault_id, db)?;
    let stats = &state["stats"];
    let pending = stats["pending_tasks"].as_i64().unwrap_or(0);
    let today_done = stats["today_done"].as_i64().unwrap_or(0);
    let overdue = stats["overdue"].as_i64().unwrap_or(0);

    // 启发式主线（同 ai_mainline 启发式）作为建议主题
    let mainline = heuristic_mainline(vault_id, db)?;
    let main_proj = if mainline.project_name.is_empty() {
        "当前主项目".to_string()
    } else {
        mainline.project_name
    };

    let text = if overdue > 0 {
        format!(
            "你有 {} 项逾期未完成——优先清理逾期项，再推进 {}。",
            overdue, main_proj
        )
    } else if today_done >= 3 {
        format!(
            "今天已完成 {} 项，节奏不错——保持专注 {}。",
            today_done, main_proj
        )
    } else if pending > 0 {
        format!(
            "今日还有 {} 项待办——先聚焦 {} 的关键一步。",
            pending, main_proj
        )
    } else {
        format!("今天暂无紧迫任务——可以静下来梳理 {} 的下一步。", main_proj)
    };

    Ok(AiCoachResult {
        text,
        source: "heuristic".to_string(),
    })
}

/// AI 教练建议核心逻辑。降级链：client None/LLM 失败 → 启发式。
/// 审查 #10：删去 cached 死分支——heuristic_coach 的 4 个分支均 format! 出非空 text，
/// `if result.text.is_empty()` 永假，cached 兜底永远走不到（cached 降级仅对 ai_mainline
/// 的"无项目空态"有意义，那里 heuristic_mainline 会返回空 project_name）。
pub async fn ai_coach_inner(
    vault_id: &str,
    ai_client: Option<&dyn AiClient>,
    db: &Database,
) -> Result<AiCoachResult, String> {
    let date_iso = dates::today_iso();

    if let Some(client) = ai_client {
        let mut state = gather_state(vault_id, db)?;
        // 附今日待办（让建议更聚焦）
        if let Ok(todos) = gather_today_todos(vault_id, db) {
            state["today_todos"] = Value::Array(todos);
        }
        let state_str = serde_json::to_string_pretty(&state).unwrap_or_default();
        let system = "你是人生教练兼秘书。基于用户当前状态给 1-3 句具体可执行的建议（用中文，简洁有力，落到具体项目/任务上，避免空泛）。只回建议文本，不要前缀。";
        let user = format!("当前状态：\n{}", state_str);

        match complete_with_budget(client, system, &user).await {
            Ok(text) => {
                let result = AiCoachResult {
                    text: text.trim().to_string(),
                    source: "ai".to_string(),
                };
                let cached = serde_json::to_string(&result).unwrap_or_default();
                log_err(
                    upsert_ai_generation_inner(vault_id, &date_iso, "coach", &cached, db),
                    "写 ai_generations 缓存(coach)",
                );
                log_err(
                    write_today_focus_snapshot(db, &date_iso, &result.text),
                    "写 today_focus 快照(coach)",
                );
                return Ok(result);
            }
            Err(e) => {
                tracing::warn!("ai_coach LLM 失败，走降级: {}", e);
            }
        }
    }

    // 启发式降级（text 恒非空，无需 cached 兜底）
    let result = heuristic_coach(vault_id, db)?;
    let cached = serde_json::to_string(&result).unwrap_or_default();
    log_err(
        upsert_ai_generation_inner(vault_id, &date_iso, "coach", &cached, db),
        "写 ai_generations 缓存(coach)",
    );
    log_err(
        write_today_focus_snapshot(db, &date_iso, &result.text),
        "写 today_focus 快照(coach)",
    );
    Ok(result)
}

/// AI 教练建议命令壳。前端 TodayPage 教练卡片触发。
#[tauri::command]
pub async fn ai_coach(
    vault_id: String,
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<AiCoachResult, String> {
    let client = client_from_app(&app);
    ai_coach_inner(&vault_id, client.as_deref(), db.inner()).await
}

// ============================================================
// ai_tomorrow 命令 —— 明日一句写回 vault「明日一句」section（M4 task 21）
// ============================================================

/// 启发式明日一句：基于明日待办数生成模板。
fn heuristic_tomorrow(vault_id: &str, db: &Database, tomorrow_iso: &str) -> Result<String, String> {
    let cnt = count_db(
        db,
        "SELECT COUNT(*) FROM tasks WHERE vault_id = ?1 AND status <> 'done' AND due_date = ?2",
        params![vault_id, tomorrow_iso],
    )?;
    let mainline = heuristic_mainline(vault_id, db)?;
    let main_proj = if mainline.project_name.is_empty() {
        "主线项目".to_string()
    } else {
        mainline.project_name
    };
    Ok(if cnt > 0 {
        format!("明日推进 {} 的关键一步（{} 项待办在途）", main_proj, cnt)
    } else {
        format!("明日聚焦 {} 的下一里程碑", main_proj)
    })
}

/// 取或创建当日笔记（今日寄语写在当日，给次日看）。
/// 复用 library::create_today_note_inner（已存在则返回，无则按模板创建）。
fn ensure_today_note(vault_id: &str, db: &Database) -> Result<(String, String), String> {
    let nc = crate::commands::library::create_today_note_inner(vault_id, db)?;
    Ok((nc.id, nc.raw_content))
}

/// 取标题行 `^#{1,6}` 的层级（1-6）；非标题或空标题 → None。
/// 与 library.rs heading_level_of 同口径（section 边界判定共用）。
fn heading_level(line: &str) -> Option<usize> {
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

/// 在「明日一句 / 每日一句 / 今日一句」section 写入第一条 bullet：
/// - section 存在且有内容 → 替换该 section 下第一条非空行（update_line 收口）
/// - section 存在但空 → append_bullet（保留 section 名避免大小写漂移）
/// - section 不存在 → 文末补 `## {default_section}` + bullet（save_note_body 收口）
///
/// 公共收口：ai_tomorrow（AI 生成写新）与 update_tomorrow_sentence（前端编辑保存）共用，
/// 避免前端自写 body.replace 误伤其他文本。section 名匹配用 tomorrow::is_sentence_section
/// （兼容「明日一句 / 每日一句 / 今日一句」三种命名）；新建 section 时用 default_section。
pub fn replace_section_first_bullet_inner(
    note_id: &str,
    sentence: &str,
    default_section: &str,
    db: &Database,
) -> Result<(), String> {
    use crate::commands::library::{append_bullet_inner, update_line_inner};

    // 读盘 → 取正文（去 frontmatter，与 indexer frontmatter::parse 同源）
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
    let abs = std::path::PathBuf::from(&row.1).join(&row.0);
    let full = std::fs::read_to_string(&abs).map_err(|e| format!("读取文件失败：{}", e))?;
    let body = crate::services::indexer::frontmatter::parse(&full).content;
    let lines: Vec<&str> = body.lines().collect();

    // 找「明日一句 / 每日一句 / 今日一句」section 的标题行 + 首条非空内容行
    let mut i = 0usize;
    while i < lines.len() {
        let cur = lines[i];
        let cur_lvl = heading_level(cur);
        let heading_text = cur.trim_start_matches('#').trim();
        if cur_lvl.is_some() && crate::services::indexer::tomorrow::is_sentence_section(heading_text) {
            // 记录 section 标题层级（与 library.rs section_insert_index 同口径）：
            // 扫描时遇到同级或更浅标题（lvl <= section_lvl）才退出，更深标题（如 ### 在 ## 下）继续扫。
            let section_lvl = cur_lvl.unwrap();
            // 找该 section 下第一条非空内容行（可能是已存在的句子，也可能是空行）
            let mut content_line: Option<(usize, String)> = None;
            let mut j = i + 1;
            while j < lines.len() {
                let next_line = lines[j];
                if let Some(lvl) = heading_level(next_line) {
                    // 同级或更浅 → 退出（section 结束）；更深 → 继续（子标题内的内容也算本 section），
                    // 但子标题行本身不算 content（要找的是子标题下或本节首段的 bullet/文本）。
                    if lvl <= section_lvl {
                        break;
                    } else {
                        j += 1;
                        continue;
                    }
                }
                let t = next_line.trim_start();
                if !t.is_empty() {
                    content_line = Some((j, next_line.to_string()));
                    break;
                }
                j += 1;
            }
            if let Some((line_idx, _existing)) = content_line {
                // 已有句子 → 替换该行（1-based source_line = line_idx + 1）
                let new_text = format!("- {}", sentence);
                let _ = update_line_inner(note_id, (line_idx as i64) + 1, &new_text, db)?;
            } else {
                // section 存在但空 → 追加 bullet（用原文 section 名，避免大小写漂移）
                let section_name = heading_text.to_string();
                let _ = append_bullet_inner(note_id, &section_name, sentence, false, db)?;
            }
            return Ok(());
        }
        i += 1;
    }

    // 无 section → 末尾补「## {default_section}」section + bullet（save_note_body_inner 收口）
    let new_body = format!("{}\n\n## {}\n- {}\n", body.trim_end(), default_section, sentence);
    let _ = crate::commands::library::save_note_body_inner(note_id, &new_body, db)?;
    Ok(())
}

/// AI 明日一句核心逻辑。
/// 写回 vault「明日一句」section（append_bullet/update_line 收口，备份 + 重索引）
/// + tomorrow_sentences 表（与 indexer/tomorrow.rs 解析约定一致）。
pub async fn ai_tomorrow_inner(
    vault_id: &str,
    ai_client: Option<&dyn AiClient>,
    db: &Database,
) -> Result<AiTomorrowResult, String> {
    use chrono::Duration;
    let today = dates::today_naive();
    let tomorrow = today + Duration::days(1);
    let tomorrow_iso = tomorrow.format("%Y-%m-%d").to_string();

    // 聚合明日待办数 + 明日事件
    let tomorrow_todos = count_db(
        db,
        "SELECT COUNT(*) FROM tasks WHERE vault_id = ?1 AND status <> 'done' AND due_date = ?2",
        params![vault_id, &tomorrow_iso],
    )?;
    let tomorrow_events = count_db(
        db,
        "SELECT COUNT(*) FROM events WHERE vault_id = ?1 AND event_date = ?2",
        params![vault_id, &tomorrow_iso],
    )?;

    // 审查 #4：追踪真实来源——LLM 成功才算 "ai"，失败退启发式是 "heuristic"。
    // 原 `if ai_client.is_some() { "ai" }` 在 LLM 失败时仍标 ai，误导前端显示蓝色 AI 标签。
    let (sentence, used_ai) = if let Some(client) = ai_client {
        let mainline = heuristic_mainline(vault_id, db).ok().map(|m| m.project_name).unwrap_or_default();
        let state = json!({
            "tomorrow_date": tomorrow_iso,
            "tomorrow_todos": tomorrow_todos,
            "tomorrow_events": tomorrow_events,
            "mainline": mainline,
        });
        let system = "你是人生教练。基于用户明日待办和事件，给一句聚焦明日核心的寄语（用中文，10-20 字，落到具体行动上，简洁有力）。只回句子本身，不要前缀或解释。";
        let user = format!("明日状态：\n{}", serde_json::to_string_pretty(&state).unwrap_or_default());

        match complete_with_budget(client, system, &user).await {
            Ok(text) => {
                let s = text.trim().trim_matches('"').to_string();
                let cached = serde_json::to_string(&s).unwrap_or_default();
                log_err(
                    upsert_ai_generation_inner(vault_id, &dates::today_iso(), "tomorrow", &cached, db),
                    "写 ai_generations 缓存(tomorrow)",
                );
                (s, true)
            }
            Err(e) => {
                tracing::warn!("ai_tomorrow LLM 失败，走启发式: {}", e);
                (heuristic_tomorrow(vault_id, db, &tomorrow_iso)?, false)
            }
        }
    } else {
        (heuristic_tomorrow(vault_id, db, &tomorrow_iso)?, false)
    };

    // 写回当日笔记「明日一句」section（备份 + 重索引统一收口）
    let (note_id, _raw) = ensure_today_note(vault_id, db)?;
    replace_section_first_bullet_inner(&note_id, &sentence, "明日一句", db)?;

    // 写 tomorrow_sentences 表（date_iso = 明日，被 indexer/tomorrow.rs 约定消费：当日笔记写下的，给次日看）。
    // 审查 #2：原 ON CONFLICT(id) 用随机 uuid 永不命中 → 每次生成都插新行（表无限增长 +
    // get_tomorrow_sentence 无 ORDER BY 读到旧值）。改为先删同 vault+date（一日一句语义）再插，
    // 与 indexer 增量步骤8 的 DELETE-INSERT 同模式，不依赖 schema UNIQUE（避老库去重风险）。
    log_err(
        db.sqlite().execute(
            "DELETE FROM tomorrow_sentences WHERE vault_id = ?1 AND date_iso = ?2",
            params![vault_id, &tomorrow_iso],
        ),
        "清旧 tomorrow_sentences",
    );
    log_err(
        db.sqlite().execute(
            "INSERT INTO tomorrow_sentences (id, note_id, vault_id, date_iso, sentence) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![uuid::Uuid::new_v4().to_string(), note_id, vault_id, &tomorrow_iso, sentence],
        ),
        "写 tomorrow_sentences",
    );

    Ok(AiTomorrowResult {
        sentence,
        source: if used_ai { "ai" } else { "heuristic" }.to_string(),
        note_id,
    })
}

/// AI 明日一句命令壳。前端 TodayPage「生成明日寄语」按钮触发。
#[tauri::command]
pub async fn ai_tomorrow(
    vault_id: String,
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<AiTomorrowResult, String> {
    let client = client_from_app(&app);
    ai_tomorrow_inner(&vault_id, client.as_deref(), db.inner()).await
}

/// 用户编辑「明日一句」保存（前端 saveTomorrowEdit 调）。
/// 复用 replace_section_first_bullet_inner（与 AI 写新同 section 定位 + update_line/append 收口，
/// 避免前端自写 body.replace 误伤）。section 不存在则创建「## 明日一句」。
#[tauri::command]
pub fn update_tomorrow_sentence(
    note_id: String,
    new_sentence: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    replace_section_first_bullet_inner(&note_id, &new_sentence, "明日一句", db.inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use crate::services::ai::AiError;

    /// mock client：可注入预期返回字符串（或 Err）
    struct MockClient {
        reply: Result<String, AiError>,
    }
    #[async_trait]
    impl AiClient for MockClient {
        async fn complete(&self, _system: &str, _user: &str) -> Result<String, AiError> {
            // reply 是 owned Result，AiError derive Clone，直接 clone 返回即可
            self.reply.clone()
        }
    }

    /// 临时 vault + DB（与 library.rs setup_lib 同模式）
    fn setup() -> (tempfile::TempDir, String, std::path::PathBuf, Database) {
        let tmp = tempfile::TempDir::new().unwrap();
        let vid = uuid::Uuid::new_v4().to_string();
        let vault_dir = tmp.path().join(format!("v_{}", vid));
        std::fs::create_dir_all(&vault_dir).unwrap();
        let db = Database::new(tmp.path().join("t.db")).unwrap();
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

    /// 注入一个 project 行
    fn add_project(db: &Database, vault_id: &str, name: &str, priority: Option<f64>, is_mainline: bool, note_id: &str) {
        let id = uuid::Uuid::new_v4().to_string();
        let im: i64 = if is_mainline { 1 } else { 0 };
        db.sqlite()
            .execute(
                "INSERT INTO projects (id, vault_id, note_id, name, status, priority, is_mainline, okr_priority, home_rel_path) \
                 VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, NULL, ?4)",
                params![id, vault_id, note_id, name, priority, im],
            )
            .unwrap();
    }

    fn add_note(db: &Database, vault_id: &str, note_id: &str) {
        db.sqlite()
            .execute(
                "INSERT INTO notes (id, vault_id, rel_path, file_name, title, layer, tags, frontmatter, mtime, content_hash) \
                 VALUES (?1, ?2, 'x.md', 'x.md', 'X', 2, '[]', '{}', 0, 'h')",
                params![note_id, vault_id],
            )
            .unwrap();
    }

    #[tokio::test]
    async fn ai_mainline_mock成功_source_为_ai() {
        let (_tmp, vid, _vd, db) = setup();
        add_note(&db, &vid, "n1");
        add_project(&db, &vid, "项目A", Some(150.0), true, "n1");
        add_project(&db, &vid, "项目B", Some(50.0), false, "n1");

        let mock = MockClient {
            reply: Ok("项目A|它有最高优先级且已主线标记".to_string()),
        };
        let r = ai_mainline_inner(&vid, Some(&mock), &db).await.unwrap();
        assert_eq!(r.source, "ai");
        assert_eq!(r.project_name, "项目A");
        assert!(r.reason.contains("最高优先级"));

        // 验证 ai_generations 已缓存
        let cached = get_ai_generation_inner(&vid, &dates::today_iso(), "mainline", &db).unwrap();
        assert!(cached.is_some(), "应已写 ai_generations");
        assert!(cached.unwrap().contains("项目A"));

        // 验证 life_state_snapshots 已写
        let snap: Option<String> = db
            .sqlite()
            .query_row(
                "SELECT mainline_project FROM life_state_snapshots WHERE date_iso = ?1",
                params![dates::today_iso()],
                |r| r.get::<_, Option<String>>(0),
            )
            .unwrap()
            .flatten();
        assert_eq!(snap.as_deref(), Some("项目A"));
    }

    #[tokio::test]
    async fn ai_mainline_mock失败_退启发式_source_为_heuristic() {
        let (_tmp, vid, _vd, db) = setup();
        add_note(&db, &vid, "n1");
        // 项目B 优先级更高 → 启发式应选它
        add_project(&db, &vid, "项目A", Some(50.0), false, "n1");
        add_project(&db, &vid, "项目B", Some(150.0), false, "n1");

        let mock = MockClient {
            reply: Err(AiError::Network("timeout".into())),
        };
        let r = ai_mainline_inner(&vid, Some(&mock), &db).await.unwrap();
        assert_eq!(r.source, "heuristic", "LLM 失败应走启发式");
        assert_eq!(r.project_name, "项目B", "应选 priority 最高的");
    }

    #[tokio::test]
    async fn ai_mainline_无client_直接启发式() {
        let (_tmp, vid, _vd, db) = setup();
        add_note(&db, &vid, "n1");
        add_project(&db, &vid, "项目X", Some(100.0), true, "n1");

        let r = ai_mainline_inner(&vid, None, &db).await.unwrap();
        assert_eq!(r.source, "heuristic");
        assert_eq!(r.project_name, "项目X", "is_mainline=1 优先选");
    }

    #[tokio::test]
    async fn ai_mainline_空vault_降级缓存或空态() {
        let (_tmp, vid, _vd, db) = setup();
        // 无项目，无 client → 启发式空 → 读缓存（也无）→ 空态
        let r = ai_mainline_inner(&vid, None, &db).await.unwrap();
        assert!(r.project_name.is_empty(), "空 vault 应返回空 project_name");
        assert_eq!(r.source, "heuristic");
    }

    #[test]
    fn parse_主线响应_标准格式() {
        let (n, r) = parse_mainline_response("项目A|因为优先级最高");
        assert_eq!(n, "项目A");
        assert_eq!(r, "因为优先级最高");
    }

    #[test]
    fn parse_主线响应_无分隔符退整段() {
        let (n, r) = parse_mainline_response("这是一段自由文本");
        assert!(n.is_empty());
        assert_eq!(r, "这是一段自由文本");
    }

    // ========== ai_coach 测试 ==========

    #[tokio::test]
    async fn ai_coach_mock成功() {
        let (_tmp, vid, _vd, db) = setup();
        add_note(&db, &vid, "n1");
        add_project(&db, &vid, "项目A", Some(150.0), true, "n1");

        let mock = MockClient {
            reply: Ok("今日聚焦项目A，先完成核心一步".to_string()),
        };
        let r = ai_coach_inner(&vid, Some(&mock), &db).await.unwrap();
        assert_eq!(r.source, "ai");
        assert!(r.text.contains("项目A"));

        // 验证 life_state_snapshots.today_focus 已写
        let focus: Option<String> = db
            .sqlite()
            .query_row(
                "SELECT today_focus FROM life_state_snapshots WHERE date_iso = ?1",
                params![dates::today_iso()],
                |r| r.get::<_, Option<String>>(0),
            )
            .unwrap()
            .flatten();
        assert!(focus.unwrap_or_default().contains("项目A"));
    }

    #[tokio::test]
    async fn ai_coach_mock失败_退启发式() {
        let (_tmp, vid, _vd, db) = setup();
        add_note(&db, &vid, "n1");
        add_project(&db, &vid, "项目X", Some(100.0), true, "n1");

        let mock = MockClient {
            reply: Err(AiError::Network("timeout".into())),
        };
        let r = ai_coach_inner(&vid, Some(&mock), &db).await.unwrap();
        assert_eq!(r.source, "heuristic");
        assert!(r.text.contains("项目X"), "启发式建议应含项目名");
    }

    #[tokio::test]
    async fn ai_coach_无client_直接启发式() {
        let (_tmp, vid, _vd, db) = setup();
        add_note(&db, &vid, "n1");
        add_project(&db, &vid, "项目Y", Some(100.0), true, "n1");

        let r = ai_coach_inner(&vid, None, &db).await.unwrap();
        assert_eq!(r.source, "heuristic");
    }

    // ========== ai_tomorrow 测试 ==========

    #[tokio::test]
    async fn ai_tomorrow_section不存在_创建并写入() {
        let (_tmp, vid, vault_dir, db) = setup();
        // create_today_note_inner 用的路径：07_决策与复盘/日志/YYYY-MM/YYYY-MM-DD.md
        // setup 的 vault_dir 是空目录，create 会建子目录
        let mock = MockClient {
            reply: Ok("明日推进核心一步".to_string()),
        };
        let r = ai_tomorrow_inner(&vid, Some(&mock), &db).await.unwrap();
        assert_eq!(r.source, "ai");
        assert_eq!(r.sentence, "明日推进核心一步", "句子应是 LLM 回的原文");

        // 验证当日笔记已写 + 含「明日一句」section
        let today = dates::today_iso();
        let month = &today[..7];
        let note_path = vault_dir.join(format!("07_决策与复盘/日志/{}/{}.md", month, today));
        assert!(note_path.exists(), "当日笔记应已创建");
        let on_disk = std::fs::read_to_string(&note_path).unwrap();
        assert!(
            on_disk.contains("## 明日一句"),
            "应已写入「明日一句」section，实际：{}",
            on_disk
        );
        assert!(on_disk.contains("明日推进核心一步"), "应含句子");

        // tomorrow_sentences 表应有一行
        let cnt: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM tomorrow_sentences WHERE vault_id = ?1",
                params![vid],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert_eq!(cnt, 1, "tomorrow_sentences 应有 1 行");
    }

    #[tokio::test]
    async fn ai_tomorrow_section已存在_替换不重复() {
        let (_tmp, vid, vault_dir, db) = setup();
        let today = dates::today_iso();
        let month = &today[..7];
        let note_path = vault_dir.join(format!("07_决策与复盘/日志/{}/{}.md", month, today));
        std::fs::create_dir_all(note_path.parent().unwrap()).unwrap();
        // 预置带「明日一句」section 的当日笔记（已有旧句子）
        std::fs::write(
            &note_path,
            format!(
                "---\ntitle: {} 日志\ncreated: {}\n---\n# {}\n\n## 明日一句\n- 旧句子\n",
                today, today, today
            ),
        ).unwrap();
        // 索引该笔记（让它进 notes 表）
        crate::commands::index::index_vault_inner(&vid, &db).unwrap();

        let mock = MockClient {
            reply: Ok("新句子聚焦项目B".to_string()),
        };
        let r = ai_tomorrow_inner(&vid, Some(&mock), &db).await.unwrap();
        assert_eq!(r.sentence, "新句子聚焦项目B");

        // 验证：旧句子被替换，不重复
        let on_disk = std::fs::read_to_string(&note_path).unwrap();
        assert!(!on_disk.contains("旧句子"), "旧句子应被替换");
        assert!(on_disk.contains("新句子聚焦项目B"), "应含新句子");
        // 只有一个「明日一句」section（不被新增第二个）
        assert_eq!(
            on_disk.matches("## 明日一句").count(),
            1,
            "section 不应重复，实际：{}",
            on_disk
        );
    }

    #[tokio::test]
    async fn ai_tomorrow_无client_启发式_含项目名() {
        let (_tmp, vid, vault_dir, db) = setup();
        add_note(&db, &vid, "n1");
        add_project(&db, &vid, "项目Z", Some(100.0), true, "n1");

        let r = ai_tomorrow_inner(&vid, None, &db).await.unwrap();
        assert_eq!(r.source, "heuristic");
        assert!(r.sentence.contains("项目Z"), "启发式明日一句应含项目名");

        // 验证 vault 文件已写
        let today = dates::today_iso();
        let month = &today[..7];
        let note_path = vault_dir.join(format!("07_决策与复盘/日志/{}/{}.md", month, today));
        assert!(note_path.exists());
    }

    /// 修复 3：section 扫描遇更深 # 标题不应 break。
    /// 「## 明日一句」下若有 ### 备选 子标题，子标题里的旧句应被正确替换
    /// （旧实现 t.starts_with('#') 无层级判定，遇到 ### 会错误 break 后 append）。
    #[tokio::test]
    async fn ai_tomorrow_更深子标题不break_正确替换旧句() {
        let (_tmp, vid, vault_dir, db) = setup();
        let today = dates::today_iso();
        let month = &today[..7];
        let note_path = vault_dir.join(format!("07_决策与复盘/日志/{}/{}.md", month, today));
        std::fs::create_dir_all(note_path.parent().unwrap()).unwrap();
        // 预置：## 明日一句 下含 ### 备选 子标题，旧句在子标题里
        std::fs::write(
            &note_path,
            format!(
                "---\ntitle: {} 日志\ncreated: {}\n---\n# {}\n\n## 明日一句\n\n### 备选\n- 旧句\n",
                today, today, today
            ),
        ).unwrap();
        crate::commands::index::index_vault_inner(&vid, &db).unwrap();

        let mock = MockClient {
            reply: Ok("新句子聚焦核心一步".to_string()),
        };
        let r = ai_tomorrow_inner(&vid, Some(&mock), &db).await.unwrap();
        assert_eq!(r.sentence, "新句子聚焦核心一步");

        // 验证：旧句被替换为新句，不重复 append
        let on_disk = std::fs::read_to_string(&note_path).unwrap();
        assert!(!on_disk.contains("旧句"), "旧句应被替换");
        assert!(on_disk.contains("新句子聚焦核心一步"), "应含新句");
        // section 不重复
        assert_eq!(
            on_disk.matches("## 明日一句").count(),
            1,
            "section 不应重复"
        );
    }

    /// 修复 4：update_tomorrow_sentence 命令复用 inner 收口逻辑
    /// （前端编辑保存时不需自写 body.replace，调命令即可，与 AI 写新同源）。
    /// 测试 inner：section 不存在时创建；section 存在时替换不重复。
    #[test]
    fn replace_section_first_bullet_inner_section不存在时创建() {
        let (_tmp, vid, vault_dir, db) = setup();
        let today = dates::today_iso();
        let month = &today[..7];
        let note_path = vault_dir.join(format!("07_决策与复盘/日志/{}/{}.md", month, today));
        std::fs::create_dir_all(note_path.parent().unwrap()).unwrap();
        // 预置：无「明日一句」section 的笔记
        std::fs::write(
            &note_path,
            format!("---\ntitle: {} 日志\ncreated: {}\n---\n# {}\n\n## 今日待办\n- [ ] x\n", today, today, today),
        ).unwrap();
        crate::commands::index::index_vault_inner(&vid, &db).unwrap();

        let note_id: String = db
            .sqlite()
            .query_row(
                "SELECT id FROM notes WHERE file_name = ?1",
                params![format!("{}.md", today)],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .unwrap();

        // 调 inner：section 不存在 → 末尾补「## 明日一句」+ bullet
        replace_section_first_bullet_inner(&note_id, "编辑后的句子", "明日一句", &db).unwrap();

        let on_disk = std::fs::read_to_string(&note_path).unwrap();
        assert!(on_disk.contains("## 明日一句"), "应已创建 section");
        assert!(on_disk.contains("编辑后的句子"), "应含新句子");
        assert_eq!(on_disk.matches("## 明日一句").count(), 1, "section 不应重复");
    }

    #[test]
    fn replace_section_first_bullet_inner_section已存在时替换() {
        let (_tmp, vid, vault_dir, db) = setup();
        let today = dates::today_iso();
        let month = &today[..7];
        let note_path = vault_dir.join(format!("07_决策与复盘/日志/{}/{}.md", month, today));
        std::fs::create_dir_all(note_path.parent().unwrap()).unwrap();
        std::fs::write(
            &note_path,
            format!(
                "---\ntitle: {} 日志\ncreated: {}\n---\n# {}\n\n## 明日一句\n- 旧句\n",
                today, today, today
            ),
        ).unwrap();
        crate::commands::index::index_vault_inner(&vid, &db).unwrap();

        let note_id: String = db
            .sqlite()
            .query_row(
                "SELECT id FROM notes WHERE file_name = ?1",
                params![format!("{}.md", today)],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .unwrap();

        replace_section_first_bullet_inner(&note_id, "编辑后的新句", "明日一句", &db).unwrap();

        let on_disk = std::fs::read_to_string(&note_path).unwrap();
        assert!(!on_disk.contains("旧句"), "旧句应被替换");
        assert!(on_disk.contains("编辑后的新句"), "应含新句");
        assert_eq!(on_disk.matches("## 明日一句").count(), 1, "section 不应重复");
    }
}
