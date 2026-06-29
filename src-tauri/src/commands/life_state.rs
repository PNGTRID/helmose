// ============================================================
// Agent 状态导出 —— 把 vault 当前状态聚合成「人读 + Agent 读」双产物
//   - LIFE-STATE.md：人读 markdown（主线/待办/统计）
//   - state.json：机器可读 JSON（外部智能体消费）
// 写到 app_data_dir/agent/（非 vault 原文，只读 vault 聚合后写出）
// 同时落 life_state_snapshots 表（按日期 upsert），供趋势回看。
//
// 注：projects/okrs 表由 indexer 尚未填充（v0.2 项目解析器），此处优雅降级。
// ============================================================

use crate::models::AgentExport;
use crate::services::Database;
use crate::utils::dates;
use rusqlite::params;
use serde_json::{json, Value};
use std::fs;
use tauri::{AppHandle, Manager, State};

/// 统计标量（COUNT），缺值回落 0
fn count(db: &Database, sql: &str, vault_id: &str) -> Result<i64, String> {
    db.sqlite()
        .query_row(sql, &[&vault_id as &dyn rusqlite::ToSql], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())
        .map(|o| o.unwrap_or(0))
}

/// 导出当前 vault 的 Agent 状态。返回写出路径 + 摘要。
#[tauri::command]
pub fn export_life_state(
    vault_id: String,
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<AgentExport, String> {
    // vault 基本信息
    let (vid, vname, vroot) = db
        .sqlite()
        .query_row(
            "SELECT id, name, root_path FROM vaults WHERE id = ?1",
            params![vault_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("vault {} not found", vault_id))?;

    // 聚合统计
    let total_notes = count(db.inner(), "SELECT COUNT(*) FROM notes WHERE vault_id = ?1", &vid)?;
    let pending =
        count(db.inner(), "SELECT COUNT(*) FROM tasks WHERE vault_id = ?1 AND done = 0", &vid)?;
    let total_tasks = count(db.inner(), "SELECT COUNT(*) FROM tasks WHERE vault_id = ?1", &vid)?;
    let wikilinks = count(db.inner(), "SELECT COUNT(*) FROM links WHERE vault_id = ?1", &vid)?;

    // top 10 待办（NULL due_date 排后）
    let top_tasks: Vec<Value> = db
        .sqlite()
        .query_map(
            "SELECT text, due_date, source FROM tasks WHERE vault_id = ?1 AND done = 0 \
             ORDER BY due_date IS NULL, due_date ASC LIMIT 10",
            params![vid],
            |r| {
                Ok(json!({
                    "text": r.get::<_, String>(0)?,
                    "due_date": r.get::<_, Option<String>>(1)?,
                    "source": r.get::<_, String>(2)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;

    // 项目（indexer 尚未填充 projects 表，可能为空）
    let mainline: Vec<Value> = db
        .sqlite()
        .query_map(
            "SELECT name, status FROM projects WHERE vault_id = ?1 AND is_mainline = 1",
            params![vid],
            |r| {
                Ok(json!({
                    "name": r.get::<_, String>(0)?,
                    "status": r.get::<_, Option<String>>(1)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;
    let sideline: Vec<Value> = db
        .sqlite()
        .query_map(
            "SELECT name, status FROM projects WHERE vault_id = ?1 AND is_mainline = 0",
            params![vid],
            |r| {
                Ok(json!({
                    "name": r.get::<_, String>(0)?,
                    "status": r.get::<_, Option<String>>(1)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;

    let now = dates::now_iso8601();
    let today = dates::today_iso();

    // state.json（机器可读）
    let state = json!({
        "generated_at": now,
        "vault": { "id": vid, "name": vname, "root_path": vroot },
        "date_iso": today,
        "stats": {
            "notes": total_notes,
            "tasks_total": total_tasks,
            "pending_tasks": pending,
            "wikilinks": wikilinks,
        },
        "mainline_projects": mainline,
        "sideline_projects": sideline,
        "top_tasks": top_tasks,
        "okrs": [],
    });

    // LIFE-STATE.md（人读）
    let mut md = String::new();
    md.push_str(&format!("# LIFE-STATE · {}\n\n", vname));
    md.push_str(&format!("> 生成时间：{}\n", now));
    md.push_str("> 由 Helmose 自动聚合；机器可读版本见同目录 `state.json`\n\n");

    md.push_str("## 今日聚焦\n\n");
    md.push_str(&format!("- 日期：{}\n", today));
    md.push_str(&format!("- 待办任务：{} 条未完成\n", pending));
    md.push_str(&format!("- 笔记总量：{}\n\n", total_notes));

    md.push_str("## 主线项目\n\n");
    if mainline.is_empty() {
        md.push_str("_（projects 表暂无数据：项目解析器待 v0.2 接入）_\n\n");
    } else {
        for p in &mainline {
            let name = p["name"].as_str().unwrap_or("?");
            let status = p["status"].as_str().unwrap_or("?");
            md.push_str(&format!("- **{}**（{}）\n", name, status));
        }
        md.push('\n');
    }

    md.push_str("## 待办任务（前 10）\n\n");
    if top_tasks.is_empty() {
        md.push_str("_暂无_\n\n");
    } else {
        for t in &top_tasks {
            let text = t["text"].as_str().unwrap_or("");
            let due = t["due_date"]
                .as_str()
                .map(|d| format!(" · due {}", d))
                .unwrap_or_default();
            md.push_str(&format!("- [ ] {}{}\n", text, due));
        }
        md.push('\n');
    }

    md.push_str("## 统计\n\n");
    md.push_str(&format!(
        "- 笔记：{}\n- 任务：未完成 {} / 共 {}\n- wikilink：{}\n",
        total_notes, pending, total_tasks, wikilinks
    ));

    // 写 app_data_dir/agent/（非 vault 原文）
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let agent_dir = app_data.join("agent");
    fs::create_dir_all(&agent_dir).map_err(|e| e.to_string())?;
    let md_path = agent_dir.join("LIFE-STATE.md");
    let json_path = agent_dir.join("state.json");
    fs::write(&md_path, &md).map_err(|e| e.to_string())?;
    let json_str = serde_json::to_string_pretty(&state)
        .map_err(|e| e.to_string())?;
    fs::write(&json_path, json_str).map_err(|e| e.to_string())?;

    // 落快照表（按日期 upsert，幂等）
    let top_json = serde_json::to_string(&top_tasks).unwrap_or_else(|_| "[]".into());
    let _ = db.sqlite().execute(
        "INSERT INTO life_state_snapshots \
         (date_iso, generated_at, pending_tasks_count, top_tasks, mainline_project) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(date_iso) DO UPDATE SET \
           generated_at = excluded.generated_at, \
           pending_tasks_count = excluded.pending_tasks_count, \
           top_tasks = excluded.top_tasks, \
           mainline_project = excluded.mainline_project",
        params![today, now, pending, top_json, mainline.first().and_then(|p| p["name"].as_str()).map(String::from)],
    );

    Ok(AgentExport {
        md_path: md_path.to_string_lossy().to_string(),
        json_path: json_path.to_string_lossy().to_string(),
        date_iso: today,
        pending_tasks: pending,
        total_notes: total_notes,
    })
}
