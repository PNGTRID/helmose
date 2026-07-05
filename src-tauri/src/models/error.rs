// ============================================================
// 应用统一错误类型（B1 错误码化）：替代旧 Result<T, String>。
// 设计：
//   1. thiserror 提供 Error/Display；自定义 Serialize 输出 {code, message}（前端 reject 按码分流）
//   2. Db/Io/Serde 用 #[from]，命令/服务内底层错误可裸 ? 自动转换，替代旧 .map_err(|e| e.to_string())?
//   3. From<String/&str> 兜底残留字符串；映射时优先具体 variant，避免 DB 错误误归 Internal
//   4. NotFound 与 Ok(None) 并存：查询型命令保留 Option 契约（前端 null 判断不变），
//      操作型失败用 Err(NotFound)
// ============================================================

use rusqlite::Error as RusqliteError;
use serde::ser::{SerializeStruct, Serializer};
use serde::Serialize;

/// 应用统一错误。前端 invoke reject 收到 {"code":"<Variant>","message":"<Display>"}。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("precondition failed: {0}")]
    PreconditionFailed(String),
    #[error("database error: {0}")]
    Db(#[from] RusqliteError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("secrets error: {0}")]
    Secrets(String),
    #[error("internal error: {0}")]
    Internal(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Internal(s)
    }
}

/// tauri::Error（app_data_dir / 管理器等）兜底为 Internal——前端按「系统异常」统一提示。
impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Internal(s.to_string())
    }
}

impl AppError {
    pub fn not_found(msg: impl Into<String>) -> Self {
        AppError::NotFound(msg.into())
    }
    pub fn invalid_input(msg: impl Into<String>) -> Self {
        AppError::InvalidInput(msg.into())
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        AppError::Conflict(msg.into())
    }
    pub fn precondition_failed(msg: impl Into<String>) -> Self {
        AppError::PreconditionFailed(msg.into())
    }

    /// 错误码（variant 名），前端 switch 用。
    fn code(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "NotFound",
            AppError::InvalidInput(_) => "InvalidInput",
            AppError::Conflict(_) => "Conflict",
            AppError::PreconditionFailed(_) => "PreconditionFailed",
            AppError::Db(_) => "Db",
            AppError::Io(_) => "Io",
            AppError::Serde(_) => "Serde",
            AppError::Secrets(_) => "Secrets",
            AppError::Internal(_) => "Internal",
        }
    }
}

/// 自定义序列化：前端 reject 收到 {code, message}，而非枚举默认 tag 形态。
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_rusqlite_error_maps_to_db() {
        let e: AppError = RusqliteError::QueryReturnedNoRows.into();
        assert!(matches!(e, AppError::Db(_)));
        assert_eq!(e.code(), "Db");
    }

    #[test]
    fn from_io_error_maps_to_io() {
        let e: AppError = std::io::Error::new(std::io::ErrorKind::NotFound, "x").into();
        assert!(matches!(e, AppError::Io(_)));
        assert_eq!(e.code(), "Io");
    }

    #[test]
    fn from_serde_error_maps_to_serde() {
        let e: AppError = serde_json::from_str::<()>("bad json")
            .unwrap_err()
            .into();
        assert!(matches!(e, AppError::Serde(_)));
        assert_eq!(e.code(), "Serde");
    }

    #[test]
    fn from_string_maps_to_internal() {
        let e: AppError = "残留字符串".to_string().into();
        assert!(matches!(e, AppError::Internal(_)));
        assert_eq!(e.code(), "Internal");
    }

    #[test]
    fn serialize_emits_code_and_message() {
        let e = AppError::NotFound("note abc".into());
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(
            json,
            r#"{"code":"NotFound","message":"not found: note abc"}"#
        );
    }

    #[test]
    fn variant_constructors_and_code() {
        assert_eq!(AppError::not_found("x").code(), "NotFound");
        assert_eq!(AppError::invalid_input("x").code(), "InvalidInput");
        assert_eq!(AppError::conflict("x").code(), "Conflict");
        assert_eq!(AppError::precondition_failed("x").code(), "PreconditionFailed");
        assert_eq!(AppError::Secrets("x".to_string()).code(), "Secrets");
        assert_eq!(AppError::Internal("x".to_string()).code(), "Internal");
    }

    #[test]
    fn display_keeps_business_message() {
        // 业务文案应原样保留在 message（前端阶段2 按码分流时直接显示）
        assert_eq!(
            AppError::invalid_input("非法 status 值: x").to_string(),
            "invalid input: 非法 status 值: x"
        );
    }
}
