// ============================================================
// AI 设置命令（M4）—— AiSettings 读写 app_data_dir/config.json
//
// 设计要点：
//   1. **key 不入 vault 不入 git** —— 写到 app_data_dir/config.json（OS 标准配置目录，
//      非 vault，非源码）。vault 是用户数据真相源，配置项不应混入。
//   2. **全应用单一配置**（非 per-vault）：provider/key/enabled 三字段，全局生效。
//      不同 vault 共用同一 AI 后端（用户视角合理）。
//   3. **未配置 → 默认 enabled=false + provider=claude + key 空** → build_client None → 走降级链。
// ============================================================

use crate::models::AiSettings;
use crate::services::Database;
use rusqlite::params;
use std::fs;
use tauri::{AppHandle, Manager};

/// 配置文件名（app_data_dir/config.json）
const CONFIG_FILE: &str = "config.json";

/// 取 app_data_dir 路径（main.rs setup 已创建该目录）。
fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data.join(CONFIG_FILE))
}

/// 读 app_data_dir/config.json 全量配置（顶层 JSON 对象）。
/// 文件不存在 / 解析失败 → 空对象（不报错，让上层走默认）。
fn read_config_json(app: &AppHandle) -> Result<serde_json::Value, String> {
    let p = config_path(app)?;
    if !p.exists() {
        return Ok(serde_json::json!({}));
    }
    let s = fs::read_to_string(&p).map_err(|e| format!("读 config.json 失败: {}", e))?;
    serde_json::from_str(&s).map_err(|e| format!("config.json 解析失败: {}", e))
}

/// 写 app_data_dir/config.json 全量配置（覆盖）。
/// 安全：config.json 含 api_key 明文（见 #3 审查），Unix 下收紧到 0600（仅 owner 读写），
/// 防本机其他用户进程读取。Windows 无等效 chmod，依赖 app_data_dir ACL（用户私有目录）。
fn write_config_json(app: &AppHandle, v: &serde_json::Value) -> Result<(), String> {
    let p = config_path(app)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let s = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    fs::write(&p, s).map_err(|e| format!("写 config.json 失败: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&p, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("收紧 config.json 权限失败: {}", e))?;
    }
    Ok(())
}

/// 从 JSON 对象取 ai 字段（嵌套在 "ai" key 下，与其他配置并列）→ AiSettings。
fn ai_settings_from_json(root: &serde_json::Value) -> AiSettings {
    let ai = root.get("ai").cloned().unwrap_or(serde_json::json!({}));
    let mut s = AiSettings::default();
    if let Some(p) = ai.get("provider").and_then(|v| v.as_str()) {
        s.provider = p.to_string();
    }
    if let Some(k) = ai.get("api_key").and_then(|v| v.as_str()) {
        s.api_key = k.to_string();
    }
    if let Some(e) = ai.get("enabled").and_then(|v| v.as_bool()) {
        s.enabled = e;
    }
    s
}

/// 读 AI 设置（敏感：key 在返回值里，仅前端设置页用；其他页面应判 enabled 而非读 key）。
/// 命令壳：前端 SettingsPage 加载时调用。
#[tauri::command]
pub fn get_ai_settings(app: AppHandle) -> Result<AiSettings, String> {
    let root = read_config_json(&app)?;
    Ok(ai_settings_from_json(&root))
}

/// 读 AI 设置（容错版）：文件缺失 / 解析失败 → None（让上层走默认降级，不报错）。
/// 供 commands/ai.rs 三个 AI 命令壳复用——避免在 ai.rs 重写一份 config.json 解析逻辑
/// 导致两处漂移（审查 #8）。语义与 get_ai_settings 不同：本函数容错返回 Option。
pub fn read_ai_settings(app: &AppHandle) -> Option<AiSettings> {
    let root = read_config_json(app).ok()?;
    Some(ai_settings_from_json(&root))
}

/// 写 AI 设置（合并到 config.json 的 ai 子对象，保留其他字段）。
/// 命令壳：前端 SettingsPage 保存触发。
#[tauri::command]
pub fn set_ai_settings(
    settings: AiSettings,
    app: AppHandle,
) -> Result<AiSettings, String> {
    let mut root = read_config_json(&app)?;
    // 若 root 非 object（异常配置），重置为空对象（保护其他逻辑）
    if !root.is_object() {
        root = serde_json::json!({});
    }
    let ai = serde_json::json!({
        "provider": settings.provider,
        "api_key": settings.api_key,
        "enabled": settings.enabled,
    });
    if let serde_json::Value::Object(ref mut map) = root {
        map.insert("ai".to_string(), ai);
    }
    write_config_json(&app, &root)?;
    Ok(settings)
}

/// 写入 ai_generations 缓存行（UNIQUE(vault_id,date_iso,feature) upsert）。
/// 上层 ai_mainline/ai_coach/ai_tomorrow 调用成功后调此，省 token + 防重复。
pub fn upsert_ai_generation_inner(
    vault_id: &str,
    date_iso: &str,
    feature: &str,
    content: &str,
    db: &Database,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::utils::dates::now_iso8601();
    db.sqlite()
        .execute(
            "INSERT INTO ai_generations (id, vault_id, date_iso, feature, content, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
             ON CONFLICT(vault_id, date_iso, feature) DO UPDATE SET \
               id = excluded.id, content = excluded.content, created_at = excluded.created_at",
            params![id, vault_id, date_iso, feature, content, now],
        )
        .map_err(|e| format!("upsert ai_generations 失败: {}", e))?;
    Ok(())
}

/// 读 ai_generations 上次缓存（按 vault+date+feature 精确查）。
/// LLM 失败时上层退此缓存兜底（降级链第 3 级）。
pub fn get_ai_generation_inner(
    vault_id: &str,
    date_iso: &str,
    feature: &str,
    db: &Database,
) -> Result<Option<String>, String> {
    let s = db
        .sqlite()
        .query_row(
            "SELECT content FROM ai_generations \
             WHERE vault_id = ?1 AND date_iso = ?2 AND feature = ?3 LIMIT 1",
            params![vault_id, date_iso, feature],
            |r| r.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 用 in-memory 风格临时 DB 验证 ai_generations upsert + 读取。
    /// 跳过 config.json（需 AppHandle，单测环境无法构造）。
    #[test]
    fn ai_generations_upsert幂等覆盖() {
        let tmp = tempfile::TempDir::new().unwrap();
        let db = Database::new(tmp.path().join("t.db")).unwrap();
        db.init_schema().unwrap();
        // 注册一个 vault（FK 不强约束 ai_generations，但保持真实链路）
        let vid = "v1";
        db.sqlite()
            .execute(
                "INSERT INTO vaults (id,name,root_path,created_at,indexing_state,is_obsidian_shared,exclude_patterns) \
                 VALUES (?1,'t','/tmp','2026-01-01T00:00:00Z','idle',0,'[]')",
                params![vid],
            )
            .unwrap();

        // 首次写
        upsert_ai_generation_inner(vid, "2026-07-02", "mainline", "项目A 是主线", &db).unwrap();
        let r = get_ai_generation_inner(vid, "2026-07-02", "mainline", &db).unwrap();
        assert_eq!(r.as_deref(), Some("项目A 是主线"));

        // 同 vault+date+feature 重复写 → 覆盖（UNIQUE upsert）
        upsert_ai_generation_inner(vid, "2026-07-02", "mainline", "改为项目B 是主线", &db).unwrap();
        let r2 = get_ai_generation_inner(vid, "2026-07-02", "mainline", &db).unwrap();
        assert_eq!(r2.as_deref(), Some("改为项目B 是主线"), "同 key 应被覆盖");

        // 不同 feature 不冲突
        upsert_ai_generation_inner(vid, "2026-07-02", "coach", "今日专注项目B", &db).unwrap();
        let r3 = get_ai_generation_inner(vid, "2026-07-02", "mainline", &db).unwrap();
        assert_eq!(r3.as_deref(), Some("改为项目B 是主线"), "mainline 不应被 coach 写覆盖");

        // 不同 date 不冲突
        upsert_ai_generation_inner(vid, "2026-07-03", "mainline", "明日项目C", &db).unwrap();
        let cnt: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM ai_generations WHERE vault_id = ?1",
                params![vid],
                |r| r.get(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert_eq!(cnt, 3, "应有 3 行（mainline 2 日 + coach 1 条）");
    }

    /// JSON 解析 ai_settings：缺失字段走默认值。
    #[test]
    fn ai_settings_from_json默认值兜底() {
        // 空 JSON
        let s = ai_settings_from_json(&serde_json::json!({}));
        assert_eq!(s.provider, "claude");
        assert_eq!(s.api_key, "");
        assert!(!s.enabled);

        // 部分字段
        let s2 = ai_settings_from_json(&serde_json::json!({
            "ai": { "provider": "openai", "enabled": true }
        }));
        assert_eq!(s2.provider, "openai");
        assert!(s2.enabled);
        assert_eq!(s2.api_key, "", "缺失 api_key 应回空串");
    }
}
