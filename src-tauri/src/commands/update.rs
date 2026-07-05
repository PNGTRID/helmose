// 自动更新命令（tauri-plugin-updater）。
// tauri.conf.json 的 updater pubkey/endpoints 用 "TODO_REPLACE_AT_RELEASE" 占位：
// 发布前用户需填真实值（见 backlog）。占位态下 fetch 会失败 → 降级为「未配置更新源」友好状态，绝不崩。

use crate::models::AppResult;
use serde::Serialize;
use tauri::AppHandle;

/// 更新检查结果（前端展示用）
#[derive(Debug, Clone, Serialize)]
pub struct UpdateStatus {
    /// 是否有可用更新
    pub available: bool,
    /// 新版本号（有更新时）
    pub version: Option<String>,
    /// 给用户看的说明（含未配置/已是最新/发现新版本 等情形）
    pub message: String,
}

/// 检查应用更新。占位 endpoint 态下返回「未配置更新源」；真实配置后返回是否有新版本。
/// 任何环节失败（占位 endpoint/pubkey、网络）都降级为友好状态，不返回 Err（前端无需 try/catch 崩溃）。
#[tauri::command]
pub async fn check_update(app: AppHandle) -> AppResult<UpdateStatus> {
    use tauri_plugin_updater::UpdaterExt;

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            return Ok(UpdateStatus {
                available: false,
                version: None,
                message: format!(
                    "更新源未配置或不可用：{e}（发布时在 tauri.conf.json 填真实 endpoint/pubkey）"
                ),
            });
        }
    };

    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateStatus {
            available: true,
            version: Some(update.version.clone()),
            message: format!("发现新版本 v{}，可在发布渠道下载", update.version),
        }),
        Ok(None) => Ok(UpdateStatus {
            available: false,
            version: None,
            message: "当前已是最新版本".into(),
        }),
        Err(e) => Ok(UpdateStatus {
            available: false,
            version: None,
            message: format!("当前已是最新版本，或更新源未配置（{e}）"),
        }),
    }
}
