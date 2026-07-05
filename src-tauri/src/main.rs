// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod models;
mod services;
mod utils;

use services::Database;
use tauri::Manager;

/// 前后端连通性探针
#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            utils::logging::init();

            // 初始化数据库（app_data_dir/helmose.db）
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");
            let db_path = app_data_dir.join("helmose.db");
            let db = Database::new(db_path).expect("failed to init database");
            db.init_schema().expect("failed to init schema");
            tracing::debug!("[helmose] db: {}", db.path().display());
            app.manage(db);

            // watcher 管理器（B3 生命周期）：start_watcher / reset_app / delete_vault 共用，
            // 防 reset/delete 后旧 watcher 把删除事件往已清空 DB 写回（数据回潮）。
            app.manage(services::watcher::WatcherManager::new());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            // vault
            commands::vault::add_vault,
            commands::vault::list_vaults,
            commands::vault::get_default_vault,
            commands::vault::delete_vault,
            commands::vault::reset_app,
            // 索引
            commands::index::index_vault,
            // 笔记
            commands::notes::get_notes,
            commands::notes::get_notes_stats,
            commands::notes::get_tags_stats,
            // 文档库（Obsidian 式浏览：目录树 + 列表 + 预览 + 编辑）
            commands::library::list_dirs,
            commands::library::list_notes_meta,
            commands::library::list_all_notes_meta,
            commands::library::list_notes_by_tag,
            commands::library::get_note_content,
            commands::library::save_note_content,
            commands::library::save_note_body,
            commands::library::toggle_task,
            // M3：任务字段就地写入（status / priority / urgency）
            commands::library::set_task_status,
            commands::library::set_task_priority,
            commands::library::set_task_urgency,
            // 阶段四：批量迁移任务标记（GTD 存量固化 / 风格互转；碰 vault 原文，前端 dry-run 预览 + 手动触发）
            commands::library::migrate_task_markers,
            // 行级就地写入（inline-crud）
            commands::library::update_line,
            commands::library::delete_line,
            commands::library::insert_line_after,
            commands::library::append_bullet,
            commands::library::patch_frontmatter,
            commands::library::set_tag,
            commands::library::delete_note,
            commands::library::create_note,
            commands::library::create_today_note,
            commands::library::get_backlinks,
            commands::library::get_forward_links,
            commands::library::list_backups,
            commands::library::delete_backup,
            commands::library::list_trash,
            commands::library::clear_trash,
            commands::library::get_tomorrow_sentence,
            commands::library::get_graph_data,
            // 任务
            commands::tasks::get_tasks,
            // M2：到期提醒（ensure 扫 due 任务生成 + fire 到期发桌面通知）
            commands::reminders::ensure_reminders,
            commands::reminders::fire_due_reminders,
            // 项目
            commands::projects::get_projects,
            // M5：项目进度聚合（运行时聚合，不入 frontmatter）
            commands::projects::get_project_progress,
            // 事件（日历用）
            commands::events::list_events,
            // M1：OKR 查询（strategy/project 文档的 KR section 提取）
            commands::okrs::list_okrs,
            // M1：移动/重命名笔记（索引层同步 + 路径型引用检测）
            commands::note_move::move_note,
            commands::note_move::rename_note,
            // M1：路径型引用授权更新（move 后用户授权改其他笔记原文）
            commands::note_move::apply_ref_updates,
            // 删除笔记（移 vault/.trash/ 可恢复 + 从索引移除）
            commands::note_move::move_to_trash,
            // 脚手架（新建知识库骨架）
            commands::scaffold::scaffold_vault,
            // 全库搜索（FTS5）
            commands::search::search_notes,
            // Agent 状态导出（写 app_data_dir/agent）
            commands::life_state::export_life_state,
            // 增量索引（文件监听）
            commands::index::start_watcher,
            // 启动时检测是否需要重新索引
            commands::index::should_reindex,
            // 自动更新检查（占位 endpoint，发布时配真实值）
            commands::update::check_update,
            // M4：AI 设置（provider/key/enabled，存 app_data_dir/config.json，不入 vault）
            commands::settings::get_ai_settings,
            commands::settings::set_ai_settings,
            commands::settings::set_api_key,
            // M4：AI 教练（主线判定 + 每日建议 + 明日一句；未配 key 自动降级本地启发式）
            commands::ai::ai_mainline,
            commands::ai::ai_coach,
            commands::ai::ai_tomorrow,
            // M4：明日一句编辑保存（前端 saveTomorrowEdit 复用同一收口逻辑）
            commands::ai::update_tomorrow_sentence,
        ])
        .run(tauri::generate_context!())
        .expect("error while running helmose");
}

fn main() {
    run();
}
