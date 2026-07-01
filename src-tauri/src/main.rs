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
            println!("[helmose] db: {}", db.path().display());
            app.manage(db);

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
            // 行级就地写入（inline-crud）
            commands::library::update_line,
            commands::library::delete_line,
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
            // 项目
            commands::projects::get_projects,
            // 事件（日历用）
            commands::events::list_events,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running helmose");
}

fn main() {
    run();
}
