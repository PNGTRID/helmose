// ============================================================
// 文件监听（notify-debouncer-mini）：vault 内 md 增删改 → 增量索引 + emit 事件
// 设计要点：
//   1. 独立线程跑 debouncer；变化事件 debounce 600ms 后批量处理
//   2. 逐路径调 incremental::upsert_file / remove_file（含 FTS 单行同步）
//   3. 有变更则 emit "vault-changed"，前端 store 自增 watcherTick 触发刷新
//   4. AtomicBool 幂等守护（v0.1 单 vault；切换 vault 需重启应用）
// ============================================================

use crate::services::indexer::incremental;
use crate::services::Database;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEvent};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static STARTED: AtomicBool = AtomicBool::new(false);

/// 启动 vault 文件监听（幂等：已启动则 no-op）。
pub fn start(app: AppHandle, db: Database, vault_id: String, root: PathBuf) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return; // 已有 watcher 在跑（v0.1 单 vault）
    }
    std::thread::spawn(move || {
        let (tx, rx): (
            mpsc::Sender<Result<Vec<DebouncedEvent>, notify::Error>>,
            mpsc::Receiver<Result<Vec<DebouncedEvent>, notify::Error>>,
        ) = mpsc::channel();
        let mut debouncer = match new_debouncer(Duration::from_millis(600), tx) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[watcher] init failed: {:?}", e);
                STARTED.store(false, Ordering::SeqCst);
                return;
            }
        };
        if let Err(e) = debouncer.watcher().watch(&root, RecursiveMode::Recursive) {
            eprintln!("[watcher] watch {} failed: {:?}", root.display(), e);
            STARTED.store(false, Ordering::SeqCst);
            return;
        }
        println!("[watcher] 监听中: {}", root.display());

        while let Ok(result) = rx.recv() {
            let events = match result {
                Ok(ev) => ev,
                Err(e) => {
                    eprintln!("[watcher] event error: {:?}", e);
                    continue;
                }
            };
            let mut changed = false;
            for ev in events {
                if handle(&db, &vault_id, &root, &ev.path) {
                    changed = true;
                }
            }
            if changed {
                let _ = app.emit("vault-changed", ());
            }
        }
        // rx 关闭（应用退出）→ 线程退出，debouncer 析构停止监听
    });
}

/// 处理单个变化路径。返回是否确实改了索引库。
fn handle(db: &Database, vault_id: &str, root: &Path, path: &Path) -> bool {
    if path.extension().and_then(|s| s.to_str()) != Some("md") {
        return false;
    }
    let result = if path.exists() {
        incremental::upsert_file(db, vault_id, root, path)
    } else {
        incremental::remove_file(db, vault_id, root, path)
    };
    match result {
        Ok(changed) => changed,
        Err(e) => {
            eprintln!("[watcher] index {} failed: {}", path.display(), e);
            false
        }
    }
}
