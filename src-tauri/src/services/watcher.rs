// ============================================================
// 文件监听(notify-debouncer-mini):vault 内 md 增删改 → 增量索引 + emit 事件
// 设计要点(B3 生命周期改造):
//   1. **WatcherManager** 管理 single active watcher(可 start/stop),取代旧 static AtomicBool 单向守护
//   2. 独立线程跑 debouncer;变化事件 debounce 600ms 后批量处理
//   3. 逐路径调 incremental::upsert_file / remove_file(含 FTS 单行同步)
//   4. 有变更则 emit "vault-changed",前端 store 自增 watcherTick 触发刷新
//   5. **stop 机制**:stop_flag + rx.recv_timeout(200ms) 轮询;join 带超时(辅助线程 + recv_timeout),
//      超时放弃线程不拖死调用方(reset_app/delete_vault 绝不被 watcher 卡住)
//   6. **reset_app / delete_vallet 调 stop / stop_if_watching**,防 reset 后旧 watcher 把删除事件
//      往已清空的 DB 写回(数据回潮 bug)
// ============================================================

use crate::models::AppResult;
use crate::services::indexer::incremental;
use crate::services::Database;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEvent};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// watcher 轮询周期:rx.recv_timeout 用。stop_flag 检查粒度 = 该周期。
/// 取 200ms 平衡:够快(stop 响应 < 200ms + 一次事件处理时长),够慢(不空转 CPU)。
const POLL_INTERVAL: Duration = Duration::from_millis(200);

/// join 超时:stop 时等线程退出的最长时间。超时则放弃线程(它会在下次 stop_flag 检查或进程退出时终止)。
/// 不返回 Err——避免 reset_app / delete_vault 被 watcher 卡死。
const JOIN_TIMEOUT: Duration = Duration::from_secs(2);

/// watcher 事件 debounce(沿用旧值)。
const DEBOUNCE: Duration = Duration::from_millis(600);

/// watcher 管理器:同一时刻最多一个 active watcher(v0.1 单 vault)。
/// 注册到 Tauri State,start_watcher / reset_app / delete_vault 共用。
/// 必须 Send+Sync(Mutex<Option<Handle>> 满足:JoinHandle 是 Send,AtomicBool 是 Send+Sync)。
pub struct WatcherManager {
    inner: Mutex<Option<Handle>>,
}

struct Handle {
    /// 线程轮询的退出标志。stop 时 store(true),线程下次 recv_timeout 超时检查到即退出。
    stop_flag: Arc<AtomicBool>,
    /// 监听线程句柄。stop 时 join(带超时)。
    join: JoinHandle<()>,
    /// 当前监听的 vault_id。stop_if_watching 用它精确匹配(delete_vault 删非当前 vault 不停 watcher)。
    vault_id: String,
}

impl WatcherManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// 启动监听。若已有 watcher → 先 stop(停旧)→ 起新线程 → 存 Handle。
    /// 同 vault 重复 start 也走「停旧 + 起新」(幂等重启,不报错)。
    pub fn start(
        &self,
        app: AppHandle,
        db: Database,
        vault_id: String,
        root: PathBuf,
    ) -> AppResult<()> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        // 已有 watcher → 先停(无论是否同 vault;v0.1 单 vault 语义下重启即停旧)
        if let Some(old) = guard.take() {
            stop_handle(old);
        }

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_clone = stop_flag.clone();
        let vault_id_for_thread = vault_id.clone();
        let app_clone = app.clone();
        let join = std::thread::spawn(move || {
            let (tx, rx) = mpsc::channel();
            let mut debouncer = match new_debouncer(DEBOUNCE, tx) {
                Ok(d) => d,
                Err(e) => {
                    tracing::warn!("[watcher] init 失败：{:?}", e);
                    return;
                }
            };
            if let Err(e) = debouncer.watcher().watch(&root, RecursiveMode::Recursive) {
                tracing::debug!("[watcher] watch 失败：{:?}", e);
                return;
            }
            tracing::debug!("[watcher] 监听启动");

            // 可停止循环:recv_timeout 轮询,每 POLL_INTERVAL 检查一次 stop_flag。
            // Timeout → continue(再查 stop_flag);Disconnected → 应用退出,break。
            while !stop_flag_clone.load(Ordering::SeqCst) {
                match rx.recv_timeout(POLL_INTERVAL) {
                    Ok(Ok(events)) => {
                        if process_events(&db, &vault_id_for_thread, &root, &events) {
                            let _ = app_clone.emit("vault-changed", ());
                        }
                    }
                    Ok(Err(e)) => tracing::warn!("[watcher] event error：{:?}", e),
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            // stop_flag 置位 → 退出循环 → debouncer 析构自动停止监听(Rust drop 语义)
            tracing::debug!("[watcher] 已停止");
        });

        *guard = Some(Handle {
            stop_flag,
            join,
            vault_id,
        });
        Ok(())
    }

    /// 停止当前监听(无论 vault_id)。reset_app 用。
    pub fn stop(&self) -> AppResult<()> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(handle) = guard.take() {
            stop_handle(handle);
        }
        Ok(())
    }

    /// 仅当当前监听的 vault_id == 入参时停。delete_vault 用(删非当前 vault 不动 watcher)。
    pub fn stop_if_watching(&self, vault_id: &str) -> AppResult<()> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(handle) = guard.take() {
            if handle.vault_id == vault_id {
                stop_handle(handle);
            } else {
                // 不匹配 → 放回去,watcher 继续
                *guard = Some(handle);
            }
        }
        Ok(())
    }
}

/// 停掉一个 Handle:置 stop_flag → join(带超时)。
/// join 超时则放弃线程(drop Handle),不返回 Err——避免 reset_app 等调用方被拖死。
fn stop_handle(handle: Handle) {
    handle.stop_flag.store(true, Ordering::SeqCst);
    // std JoinHandle 无 join_timeout:辅助线程调 join,主线程用 channel + recv_timeout 等结果。
    // 这是不引入新依赖做 join 超时的标准技巧。
    let (tx, rx) = mpsc::channel::<()>();
    let j = handle.join;
    std::thread::spawn(move || {
        let _ = j.join();
        let _ = tx.send(());
    });
    if rx.recv_timeout(JOIN_TIMEOUT).is_err() {
        tracing::error!(
            "[watcher] join 超时 {}s,放弃线程(下次 stop_flag 检查或进程退出时终止)",
            JOIN_TIMEOUT.as_secs()
        );
    }
}

/// 处理一批 debounced 事件。返回是否确实改了索引库(决定是否 emit vault-changed)。
/// 抽成纯函数:单测可直接构造 events 调它,绕过 AppHandle / 线程 / notify。
fn process_events(db: &Database, vault_id: &str, root: &Path, events: &[DebouncedEvent]) -> bool {
    let mut changed = false;
    for ev in events {
        if handle(db, vault_id, root, &ev.path) {
            changed = true;
        }
    }
    changed
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
            tracing::debug!("[watcher] index 失败：{}", e);
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify_debouncer_mini::DebouncedEventKind;
    use rusqlite::params;
    use std::fs;

    /// 临时 vault + DB(同 index.rs / ai.rs setup 模式)
    fn setup() -> (tempfile::TempDir, String, std::path::PathBuf, Database) {
        let tmp = tempfile::TempDir::new().unwrap();
        let vid = uuid::Uuid::new_v4().to_string();
        let vault_dir = tmp.path().join(format!("vault_{}", vid));
        fs::create_dir_all(&vault_dir).unwrap();
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

    fn notes_count(db: &Database, vid: &str) -> i64 {
        db.sqlite()
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE vault_id = ?1",
                params![vid],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(0)
    }

    fn event(path: std::path::PathBuf) -> DebouncedEvent {
        DebouncedEvent {
            path,
            kind: DebouncedEventKind::Any,
        }
    }

    // ========== process_events 纯逻辑(不依赖线程 / AppHandle / notify)==========

    /// 新 md → upsert,返回 true + notes +1
    #[test]
    fn process_events_新增md_upsert() {
        let (_tmp, vid, vault_dir, db) = setup();
        let md = vault_dir.join("a.md");
        fs::write(&md, "# A\n").unwrap();
        let changed = process_events(&db, &vid, &vault_dir, &[event(md.clone())]);
        assert!(changed, "新 md 应 changed=true");
        assert_eq!(notes_count(&db, &vid), 1, "notes 应 +1");
    }

    /// 非 md → 跳过,false,DB 不变
    #[test]
    fn process_events_非md_跳过() {
        let (_tmp, vid, vault_dir, db) = setup();
        let txt = vault_dir.join("a.txt");
        fs::write(&txt, "not md").unwrap();
        let changed = process_events(&db, &vid, &vault_dir, &[event(txt)]);
        assert!(!changed, "非 md 应 changed=false");
        assert_eq!(notes_count(&db, &vid), 0);
    }

    /// 删除 md → remove_file,返回 true + notes 清空
    #[test]
    fn process_events_删除md_remove() {
        let (_tmp, vid, vault_dir, db) = setup();
        let md = vault_dir.join("a.md");
        fs::write(&md, "# A\n").unwrap();
        // 先 upsert 进库
        incremental::upsert_file(&db, &vid, &vault_dir, &md).unwrap();
        assert_eq!(notes_count(&db, &vid), 1);
        // 删盘 + 发删除事件(path.exists() == false → remove_file 分支)
        fs::remove_file(&md).unwrap();
        let changed = process_events(&db, &vid, &vault_dir, &[event(md.clone())]);
        assert!(changed, "删 md 应 changed=true");
        assert_eq!(notes_count(&db, &vid), 0, "notes 应清空");
    }

    // ========== 状态机 / stop 机制 ==========
    // 注:AppHandle 无法在单测构造,无法测真实 start→emit→stop 端到端。
    // 用 dummy Handle(真实线程 + 轮询 stop_flag,瞬时退出)验证 WatcherManager 状态机 +
    // stop_handle 的 join 超时不卡死。真实「stop 后写 md 不再增长」留手动验证。

    /// 构造 dummy Handle:真实线程轮询 stop_flag(置位即退出),join 不阻塞。
    fn make_dummy_handle(vault_id: &str) -> Handle {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_clone = stop_flag.clone();
        let join = std::thread::spawn(move || {
            while !stop_clone.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        Handle {
            stop_flag,
            join,
            vault_id: vault_id.to_string(),
        }
    }

    /// stop_handle 让 dummy 线程退出且不卡死(若 join 超时逻辑失效,测试会超时失败)。
    #[test]
    fn stop_handle_让线程退出() {
        let handle = make_dummy_handle("v");
        stop_handle(handle); // 线程检测到 stop_flag 即退出,join 在 JOIN_TIMEOUT 内返回
    }

    /// 空 manager.stop() → no-op,不 panic
    #[test]
    fn stop_空manager_noop() {
        let wm = WatcherManager::new();
        wm.stop().unwrap(); // 不 panic
    }

    /// stop_if_watching 不匹配 → Handle 放回,watcher 仍 active
    #[test]
    fn stop_if_watching_不匹配_放回handle() {
        let wm = WatcherManager::new();
        {
            let mut guard = wm.inner.lock().unwrap();
            *guard = Some(make_dummy_handle("vaultX"));
        }
        wm.stop_if_watching("vaultY").unwrap();
        let guard = wm.inner.lock().unwrap();
        assert!(guard.is_some(), "不匹配时 Handle 应放回");
        assert_eq!(guard.as_ref().unwrap().vault_id, "vaultX");
    }

    /// stop_if_watching 匹配 → 停 + Handle 清空
    #[test]
    fn stop_if_watching_匹配_停掉() {
        let wm = WatcherManager::new();
        {
            let mut guard = wm.inner.lock().unwrap();
            *guard = Some(make_dummy_handle("vaultX"));
        }
        wm.stop_if_watching("vaultX").unwrap();
        let guard = wm.inner.lock().unwrap();
        assert!(guard.is_none(), "匹配时 Handle 应被 take");
    }

    /// start 两次 → 第二次先停第一次的(内部 Handle 被替换,旧的 dummy 线程退出)。
    /// 用 dummy Handle 模拟「已有」,验证 start 不泄漏(旧的被 stop_handle)。
    #[test]
    fn start_已有则先停旧() {
        let wm = WatcherManager::new();
        // 先塞一个 dummy(vaultX)
        let dummy_flag;
        {
            let mut guard = wm.inner.lock().unwrap();
            let h = make_dummy_handle("vaultX");
            dummy_flag = h.stop_flag.clone();
            *guard = Some(h);
        }
        // start 走「停旧」分支需要真实 AppHandle + 起真实线程,单测无法直接调 wm.start()。
        // 改为间接验证:stop_if_watching 匹配 vaultX 后,dummy 的 stop_flag 被置 true。
        wm.stop_if_watching("vaultX").unwrap();
        assert!(
            dummy_flag.load(Ordering::SeqCst),
            "stop 应把旧 Handle 的 stop_flag 置 true"
        );
    }
}
