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

use crate::models::{AppError, AppResult, AiSettings, AiSettingsView};
use crate::services::{secrets, Database};
use rusqlite::params;
use std::fs;
use tauri::{AppHandle, Manager};

/// 配置文件名（app_data_dir/config.json）
const CONFIG_FILE: &str = "config.json";

/// 取 app_data_dir 路径（main.rs setup 已创建该目录）。
fn config_path(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    let app_data = app.path().app_data_dir()?;
    Ok(app_data.join(CONFIG_FILE))
}

/// 读 app_data_dir/config.json 全量配置（顶层 JSON 对象）。
/// 文件不存在 / 解析失败 → 空对象（不报错，让上层走默认）。
fn read_config_json(app: &AppHandle) -> AppResult<serde_json::Value> {
    let p = config_path(app)?;
    if !p.exists() {
        return Ok(serde_json::json!({}));
    }
    let s = fs::read_to_string(&p)?;
    serde_json::from_str(&s).map_err(AppError::Serde)
}

/// 写 app_data_dir/config.json 全量配置（覆盖）。
/// 安全：config.json 含 api_key 明文（见 #3 审查），Unix 下收紧到 0600（仅 owner 读写），
/// 防本机其他用户进程读取。Windows 无等效 chmod，依赖 app_data_dir ACL（用户私有目录）。
fn write_config_json(app: &AppHandle, v: &serde_json::Value) -> AppResult<()> {
    let p = config_path(app)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    let s = serde_json::to_string_pretty(v)?;
    // Unix 用 OpenOptions mode=0o600 在创建时即收紧权限，消除「先 fs::write 默认 0644 再
    // set_permissions」的权限窗口（窗口期内本机其他用户可读明文 api_key）。
    // Windows 无等效 chmod，依赖 app_data_dir ACL（用户私有目录）。
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&p)?;
        f.write_all(s.as_bytes())?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&p, s)?;
    }
    Ok(())
}

/// 从 JSON 对象取 ai 字段（嵌套在 "ai" key 下，与其他配置并列）→ AiSettings。
fn ai_settings_from_json(root: &serde_json::Value) -> AiSettings {
    let ai = root.get("ai").cloned().unwrap_or(serde_json::json!({}));
    let mut s = AiSettings::default();
    // B4：api_key 不再从 config.json 读（挪到 keyring），始终默认空串；
    // 调用方 read_ai_settings 负责从 keyring 填 api_key。
    if let Some(p) = ai.get("provider").and_then(|v| v.as_str()) {
        s.provider = p.to_string();
    }
    if let Some(e) = ai.get("enabled").and_then(|v| v.as_bool()) {
        s.enabled = e;
    }
    s
}

/// 读 AI 设置（对外不含 key）：返 AiSettingsView，has_key 由 api_key 是否为空推导。
/// key 永不回前端——防 XSS 窃取（webview 一旦被注入即可读 devtools/Form state 的明文 key）
/// + devtools 长时暴露。改 key 走 set_api_key 单独命令。
#[tauri::command]
pub fn get_ai_settings(app: AppHandle) -> AppResult<AiSettingsView> {
    let root = read_config_json(&app)?;
    // 老 key 惰性迁移（失败不阻断 has_key 读取，只 warn）
    if let Err(e) = migrate_legacy_key_if_needed(&app, &root) {
        tracing::warn!("[secrets] 老 key 迁移失败（不阻断）：{}", e);
    }
    let s = ai_settings_from_json(&root);
    // B4：has_key 由 keyring 是否有非空 key 推导（keyring 不可用 → false → 前端显示未配）
    let has_key = secrets::get_api_key()?.is_some();
    Ok(AiSettingsView {
        provider: s.provider,
        has_key,
        enabled: s.enabled,
    })
}

/// 老 api_key 惰性迁移：keyring 无 key 但 config.json ai.api_key 明文非空 →
/// 挪到 keyring + 清掉 config.json 明文（只留 provider/enabled）。幂等。
/// 触发点：get_ai_settings / read_ai_settings（首次 AI 调用或前端查 has_key 时，无启动钩子）。
/// 纯判定逻辑在 services::secrets::plan_migration / strip_api_key_from_json（可单测）。
fn migrate_legacy_key_if_needed(app: &AppHandle, root: &serde_json::Value) -> AppResult<()> {
    let keyring_has_key = secrets::get_api_key()?.is_some();
    match secrets::plan_migration(keyring_has_key, root) {
        secrets::MigrationPlan::Skip => Ok(()),
        secrets::MigrationPlan::Migrate { key } => {
            secrets::set_api_key(&key)?;
            let new_root = secrets::strip_api_key_from_json(root);
            write_config_json(app, &new_root)?;
            tracing::info!("[secrets] 老 api_key 已迁移到 keyring，config.json 明文已清");
            Ok(())
        }
    }
}

/// 读 AI 设置（容错版）：文件缺失 / 解析失败 → None（让上层走默认降级，不报错）。
/// 供 commands/ai.rs 三个 AI 命令壳复用——避免在 ai.rs 重写一份 config.json 解析逻辑
/// 导致两处漂移（审查 #8）。语义与 get_ai_settings 不同：本函数容错返回 Option。
/// B4：api_key 从 keyring 填（provider/enabled 仍读 config.json）→ 返完整 AiSettings 给 build_client。
pub fn read_ai_settings(app: &AppHandle) -> Option<AiSettings> {
    let root = read_config_json(app).ok()?;
    // 老 key 惰性迁移（失败不阻断：key 仍可从 keyring 读，迁移下次再试）
    if let Err(e) = migrate_legacy_key_if_needed(app, &root) {
        tracing::warn!("[secrets] 老 key 迁移失败（不阻断）：{}", e);
    }
    let mut s = ai_settings_from_json(&root);
    // api_key 从 keyring 填（keyring 不可用/未配 → 空 → build_client 走降级链）
    s.api_key = secrets::get_api_key().ok().flatten().unwrap_or_default();
    Some(s)
}

/// 写 AI 设置（provider/enabled）：**保留既有 api_key**，key 走 set_api_key 单独管理。
/// 命令壳：前端 SettingsPage 保存 provider/enabled 触发。
#[tauri::command]
pub fn set_ai_settings(
    settings: AiSettingsView,
    app: AppHandle,
) -> AppResult<AiSettingsView> {
    let mut root = read_config_json(&app)?;
    // 若 root 非 object（异常配置），重置为空对象（保护其他逻辑）
    if !root.is_object() {
        root = serde_json::json!({});
    }
    // B4：api_key 不再写入 config.json（挪到 keyring），ai 子对象只存 provider/enabled
    let ai = serde_json::json!({
        "provider": settings.provider,
        "enabled": settings.enabled,
    });
    if let serde_json::Value::Object(ref mut map) = root {
        map.insert("ai".to_string(), ai);
    }
    write_config_json(&app, &root)?;
    // has_key 从 keyring 读（不信任前端传的占位 has_key）
    let has_key = secrets::get_api_key()?.is_some();
    Ok(AiSettingsView {
        provider: settings.provider,
        has_key,
        enabled: settings.enabled,
    })
}

/// 单独写入 API key（与 provider/enabled 解耦，防 key 经 settings 对象在 IPC/state 暴露）。
/// 命令壳：前端 SettingsPage「输入新 key」时调用。
/// B4：写系统钥匙串（keyring），不碰 config.json（明文不再落盘）。
#[tauri::command]
pub fn set_api_key(api_key: String) -> AppResult<()> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input("API key 不能为空"));
    }
    if trimmed.len() > 256 {
        return Err(AppError::invalid_input("API key 过长（>256 字符，疑似误输入）"));
    }
    secrets::set_api_key(trimmed)
}

/// 写入 ai_generations 缓存行（UNIQUE(vault_id,date_iso,feature) upsert）。
/// 上层 ai_mainline/ai_coach/ai_tomorrow 调用成功后调此，省 token + 防重复。
pub fn upsert_ai_generation_inner(
    vault_id: &str,
    date_iso: &str,
    feature: &str,
    content: &str,
    db: &Database,
) -> AppResult<()> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::utils::dates::now_iso8601();
    db.sqlite()
        .execute(
            "INSERT INTO ai_generations (id, vault_id, date_iso, feature, content, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
             ON CONFLICT(vault_id, date_iso, feature) DO UPDATE SET \
               id = excluded.id, content = excluded.content, created_at = excluded.created_at",
            params![id, vault_id, date_iso, feature, content, now],
        )?;
    Ok(())
}

/// 读 ai_generations 上次缓存（按 vault+date+feature 精确查）。
/// LLM 失败时上层退此缓存兜底（降级链第 3 级）。
pub fn get_ai_generation_inner(
    vault_id: &str,
    date_iso: &str,
    feature: &str,
    db: &Database,
) -> AppResult<Option<String>> {
    let s = db
        .sqlite()
        .query_row(
            "SELECT content FROM ai_generations \
             WHERE vault_id = ?1 AND date_iso = ?2 AND feature = ?3 LIMIT 1",
            params![vault_id, date_iso, feature],
            |r| r.get::<_, String>(0),
        )
        ?;
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

    /// B4：api_key 不再从 JSON 读，即使 JSON 含 api_key 也忽略（始终空，由 keyring 填）。
    #[test]
    fn ai_settings_from_json_忽略json里的api_key() {
        let s = ai_settings_from_json(&serde_json::json!({
            "ai": { "provider": "claude", "api_key": "sk-应被忽略", "enabled": true }
        }));
        assert_eq!(s.provider, "claude");
        assert!(s.enabled);
        assert_eq!(s.api_key, "", "B4：api_key 不从 JSON 读，始终空（由 keyring 填）");
    }
}
