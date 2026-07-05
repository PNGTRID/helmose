// ============================================================
// 密钥存储(keyring)—— api_key 挪到系统钥匙串,不入 config.json 不入 vault
// 设计要点(B4):
//   1. 单一 entry(service="helmose", account="ai_api_key"),切 provider 直接覆盖
//   2. 跨平台:Mac Keychain / Win Credential Manager / Linux Secret Service
//   3. **keyring 不可用 / 未配 → None → build_client 走降级链**(业务不崩)
//   4. 老 config.json 明文 key 惰性迁移到 keyring(由 settings.rs migrate_legacy_key_if_needed 调用本模块)
// ============================================================

use crate::models::{AppError, AppResult};
use keyring::Entry;

const SERVICE: &str = "helmose";
const ACCOUNT: &str = "ai_api_key";

/// 取 api_key。None = 未配 / 空串 / keyring 不可用(都走降级链,业务不崩)。
/// keyring 调用失败时容错返 None 而非 Err——AI 命令降级链依赖此行为,不因 keyring 环境问题阻断。
pub fn get_api_key() -> AppResult<Option<String>> {
    let entry = match Entry::new(SERVICE, ACCOUNT) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("[secrets] Entry::new 失败(可能无 secret service):{}", e);
            return Ok(None);
        }
    };
    match entry.get_password() {
        Ok(p) if !p.is_empty() => Ok(Some(p)),
        Ok(_) => Ok(None), // 空串视为未配
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => {
            tracing::warn!("[secrets] get_password 失败:{}", e);
            Ok(None)
        }
    }
}

/// 写 api_key(覆盖)。set_api_key 命令调用。失败返 Err 给前端(不静默吞)。
pub fn set_api_key(key: &str) -> AppResult<()> {
    let entry =
        Entry::new(SERVICE, ACCOUNT).map_err(|e| AppError::Secrets(format!("keyring 不可用: {}", e)))?;
    entry
        .set_password(key)
        .map_err(|e| AppError::Secrets(format!("写 keyring 失败: {}", e)))
}

/// 删 api_key。NoEntry 视为成功(幂等)。供未来"清除 key"功能用。
/// 注:keyring v3 方法名是 delete_credential(非 delete_password,更通用命名)。
#[allow(dead_code)] // 密钥 CRUD 对称性;未来"清除 key"按钮调用
pub fn delete_api_key() -> AppResult<()> {
    let entry =
        Entry::new(SERVICE, ACCOUNT).map_err(|e| AppError::Secrets(format!("keyring 不可用: {}", e)))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // 幂等:本就没 key
        Err(e) => Err(AppError::Secrets(format!("删 keyring 失败: {}", e))),
    }
}

// ============================================================
// 老 key 迁移纯逻辑(不调 keyring,可单测)
// ============================================================

/// 迁移决策:keyring 当前状态 + config.json → 是否迁移。
#[derive(Debug, PartialEq)]
pub(crate) enum MigrationPlan {
    /// 无需迁移(keyring 已有 / config 无明文 key)
    Skip,
    /// 需迁移:把 config.json 明文 key 挪到 keyring
    Migrate { key: String },
}

/// 判定是否需要迁移。纯函数(不调 keyring,不读盘)。
/// - keyring_has_key=true → Skip(已迁移过或不需)
/// - 否则 config.json ai.api_key 明文非空 → Migrate;空 → Skip(新装用户)
pub(crate) fn plan_migration(keyring_has_key: bool, root: &serde_json::Value) -> MigrationPlan {
    if keyring_has_key {
        return MigrationPlan::Skip;
    }
    let legacy = root
        .get("ai")
        .and_then(|a| a.get("api_key"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if legacy.is_empty() {
        return MigrationPlan::Skip;
    }
    MigrationPlan::Migrate {
        key: legacy.to_string(),
    }
}

/// 从 config.json 的 ai 子对象中移除 api_key 字段(迁移后清明文)。
/// 保留 provider/enabled 及其他顶层字段。纯函数。
pub(crate) fn strip_api_key_from_json(root: &serde_json::Value) -> serde_json::Value {
    let mut new_root = root.clone();
    if let Some(obj) = new_root
        .as_object_mut()
        .and_then(|m| m.get_mut("ai"))
        .and_then(|a| a.as_object_mut())
    {
        obj.remove("api_key");
    }
    new_root
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plan_migration_明文有_keyring空_应迁移() {
        let root = json!({ "ai": { "provider": "claude", "api_key": "sk-xxx", "enabled": true } });
        let plan = plan_migration(false, &root);
        assert_eq!(plan, MigrationPlan::Migrate { key: "sk-xxx".to_string() });
    }

    #[test]
    fn plan_migration_keyring已有_不迁移() {
        let root = json!({ "ai": { "provider": "claude", "api_key": "sk-xxx", "enabled": true } });
        let plan = plan_migration(true, &root);
        assert_eq!(plan, MigrationPlan::Skip);
    }

    #[test]
    fn plan_migration_明文空_不迁移() {
        // 无 ai 字段
        assert_eq!(plan_migration(false, &json!({})), MigrationPlan::Skip);
        // ai 无 api_key
        assert_eq!(
            plan_migration(false, &json!({ "ai": { "provider": "claude", "enabled": false } })),
            MigrationPlan::Skip
        );
        // api_key 空串
        assert_eq!(
            plan_migration(false, &json!({ "ai": { "api_key": "" } })),
            MigrationPlan::Skip
        );
    }

    #[test]
    fn strip_api_key_清除明文_保留其他() {
        let root = json!({
            "other": 123,
            "ai": { "provider": "openai", "api_key": "sk-x", "enabled": true }
        });
        let stripped = strip_api_key_from_json(&root);
        // ai 只剩 provider/enabled
        let ai = stripped.get("ai").unwrap();
        assert_eq!(ai.get("provider").and_then(|v| v.as_str()), Some("openai"));
        assert_eq!(ai.get("enabled").and_then(|v| v.as_bool()), Some(true));
        assert!(ai.get("api_key").is_none(), "api_key 应被移除");
        // 其他顶层字段保留
        assert_eq!(stripped.get("other").and_then(|v| v.as_i64()), Some(123));
    }

    #[test]
    fn strip_api_key_无ai字段_不崩() {
        let root = json!({ "foo": 1 });
        let stripped = strip_api_key_from_json(&root);
        assert_eq!(stripped, json!({ "foo": 1 }));
    }

    #[test]
    fn strip_api_key_ai非object_不崩() {
        // ai 是字符串(异常配置),不应 panic
        let root = json!({ "ai": "garbage" });
        let stripped = strip_api_key_from_json(&root);
        assert_eq!(stripped, json!({ "ai": "garbage" }));
    }
}
