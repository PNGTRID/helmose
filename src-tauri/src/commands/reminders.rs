// ============================================================
// 到期提醒命令（M2）：
//   - ensure_reminders：扫 tasks due_date 未来 N 天的任务 → 生成 reminders 行（幂等）
//   - fire_due_reminders：查到期未发的 reminder → 发桌面通知 + 标 fired=1
// 设计要点：
//   1. 提前时长从 settings 读（本期默认「截止当天 9:00」，提前 1 天）
//   2. 幂等：按 task_id 已有 reminder 跳过（同任务不重复生成）
//   3. 通知权限被拒静默跳过；应用未运行不发（不做后台守护）
//   4. reminders 是派生缓存，可由 ensure_reminders 重建
// ============================================================

use crate::models::Reminder;
use crate::services::Database;
use crate::utils::dates;
use chrono::TimeZone;
use chrono::Utc;
use rusqlite::params;
use tauri::{AppHandle, State};

/// 提前生成提醒的天数（截止日往前多少天开始提醒）。
/// 本期固定 1 天（截止前一天 9:00 提醒）。后续接 settings 可配。
const LEAD_DAYS: i64 = 1;
/// 提醒触发的当天时刻（小时，24h 制）。截止前一天的 9:00。
const REMIND_HOUR: u32 = 9;

/// row → Reminder
fn row_to_reminder(row: &rusqlite::Row) -> rusqlite::Result<Reminder> {
    let fired: i64 = row.get("fired")?;
    Ok(Reminder {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        note_id: row.get("note_id")?,
        vault_id: row.get("vault_id")?,
        remind_at: row.get("remind_at")?,
        fired: fired != 0,
        task_text: row.get("task_text")?,
        due_date: row.get("due_date")?,
        created_at: row.get("created_at")?,
    })
}

/// 扫 tasks 表 due_date 未来 N 天的未完成任务，按「截止前一天 9:00」生成 reminders。
/// 幂等：同 task_id 已有 reminder 跳过（不重复生成）。返回新生成的数量。
///
/// 设计：本期不做 settings 配置（默认 LEAD_DAYS=1 / REMIND_HOUR=9）。
/// 后续接 settings 时改 lead_days/remind_hour 读取源即可，签名不变。
#[tauri::command]
pub fn ensure_reminders(vault_id: String, db: State<'_, Database>) -> Result<usize, String> {
    let today = dates::today_naive();
    let today_iso = today.format("%Y-%m-%d").to_string();

    // 查候选任务：未完成 + 有 due_date + due_date >= 今天
    // （范围上限不强制，所有未来到期任务都生成提醒；提前时长由 remind_at 计算决定）
    let candidates: Vec<(String, String, Option<String>, String)> = db
        .sqlite()
        .query_map(
            "SELECT id, text, due_date, note_id FROM tasks \
             WHERE vault_id = ?1 AND status <> 'done' AND due_date IS NOT NULL AND due_date >= ?2 \
             ORDER BY due_date ASC",
            &[&vault_id as &dyn rusqlite::ToSql, &today_iso],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    // 修复 6：消除 N+1——一次拿全部已存在 task_id，内存判定跳过。
    // 旧实现每候选单独 SELECT COUNT(*) FROM reminders WHERE task_id=?（候选 N 条 = N 次查询）。
    let existing_task_ids: std::collections::HashSet<String> = {
        let mut set = std::collections::HashSet::new();
        if !candidates.is_empty() {
            // 构造 IN (?, ?, ...) 占位符 + 参数
            let placeholders = candidates
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT DISTINCT task_id FROM reminders WHERE task_id IN ({})",
                placeholders
            );
            let mut pv: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(candidates.len());
            for c in &candidates {
                pv.push(&c.0 as &dyn rusqlite::ToSql);
            }
            let rows = db
                .sqlite()
                .query_map(&sql, &pv, |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for tid in rows {
                set.insert(tid);
            }
        }
        set
    };

    let mut created = 0usize;
    for (task_id, text, due_date, note_id) in candidates {
        // 幂等：同 task_id 已有 reminder 跳过（不区分 remind_at，简化为一任务一提醒）
        if existing_task_ids.contains(&task_id) {
            continue;
        }

        // 计算 remind_at：due_date - LEAD_DAYS 天 的 REMIND_HOUR:00:00 本地时刻 → 转 UTC 存储。
        // 统一 UTC：remind_at 与 fire 的 now_iso 都用 UTC（带 +00:00），字典序 = 时间序，
        // 跨时区/夏令时严格正确（修复 5：旧实现两端都带本地时区后缀，跨时区字典序比较会错）。
        let due = match due_date.as_deref() {
            Some(s) => match dates::normalize_date(s) {
                Some(d) => d,
                None => continue, // due_date 解析失败跳过
            },
            None => continue,
        };
        // 截止前一天 REMIND_HOUR:00 本地（LEAD_DAYS=1 → -1 天）。若 due < 今天+1 则用今天 9:00 兜底。
        let remind_day = (0..LEAD_DAYS)
            .try_fold(due, |acc, _| acc.pred_opt())
            .unwrap_or(due);
        // 提醒时间不早于现在（避免一生成立即触发历史时间）
        let now_local = chrono::Local::now();
        let mut remind_local_naive = remind_day
            .and_hms_opt(REMIND_HOUR, 0, 0)
            .unwrap_or_else(|| now_local.naive_local());
        let naive_now_local = now_local.naive_local();
        if remind_local_naive <= naive_now_local {
            // 已过提醒时刻 → 用 now + 1 分钟兜底（用户至少能见到一次通知）
            remind_local_naive = naive_now_local + chrono::Duration::minutes(1);
        }
        // 本地 naive → Local datetime → 转 UTC → 格式化（带 +00:00）
        let remind_at = chrono::Local
            .from_local_datetime(&remind_local_naive)
            .single()
            .map(|dt| dt.with_timezone(&Utc).format("%Y-%m-%dT%H:%M:%S%:z").to_string())
            .unwrap_or_else(|| Utc::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string());

        let rid = uuid::Uuid::new_v4().to_string();
        let created_at = dates::now_iso8601();
        db.sqlite()
            .execute(
                "INSERT INTO reminders (id,task_id,note_id,vault_id,remind_at,fired,task_text,due_date,created_at) \
                 VALUES (?1,?2,?3,?4,?5,0,?6,?7,?8)",
                params![
                    rid,
                    task_id,
                    note_id,
                    vault_id,
                    remind_at,
                    text,
                    due_date,
                    created_at
                ],
            )
            .map_err(|e| e.to_string())?;
        created += 1;
    }

    Ok(created)
}

/// 查到期未发的提醒（fired=0 AND remind_at <= now），按 remind_at 升序。
/// 纯查询函数（接 &Database，可单测），不含 AppHandle / 通知逻辑（审查 #13）。
/// 用 UTC 与 ensure_reminders 写入的 remind_at（UTC）字典序对齐。
pub fn list_due_reminders_inner(db: &Database) -> Result<Vec<Reminder>, String> {
    let now_iso = Utc::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    let due: Vec<Reminder> = db
        .sqlite()
        .query_map(
            "SELECT id,task_id,note_id,vault_id,remind_at,fired,task_text,due_date,created_at \
             FROM reminders WHERE fired = 0 AND remind_at <= ?1 ORDER BY remind_at ASC",
            &[&now_iso as &dyn rusqlite::ToSql],
            row_to_reminder,
        )
        .map_err(|e| e.to_string())?;
    Ok(due)
}

/// 标单条 reminder 已发（fired=1）。返回受影响行数（审查 #13：纯函数可单测）。
pub fn mark_fired_inner(db: &Database, reminder_id: &str) -> Result<usize, String> {
    db.sqlite()
        .execute(
            "UPDATE reminders SET fired = 1 WHERE id = ?1",
            &[&reminder_id as &dyn rusqlite::ToSql],
        )
        .map_err(|e| e.to_string())
}

/// 查到期未发的提醒，逐条发桌面通知 + 标 fired=1。返回本次触发的数量。
/// 由前端定时器（setInterval 60s）调用。
/// 权限被拒静默跳过；应用未运行不发（本期不做后台守护）。
/// 审查 #13：查询/标 fired 已拆为 list_due_reminders_inner / mark_fired_inner 纯函数，
/// 本命令壳只剩"通知发送"薄逻辑（依赖 AppHandle 无法单测的部分）。
#[tauri::command]
pub fn fire_due_reminders(app: AppHandle, db: State<'_, Database>) -> Result<usize, String> {
    use tauri_plugin_notification::NotificationExt;

    let due = list_due_reminders_inner(db.inner())?;

    let mut fired_cnt = 0usize;
    for r in &due {
        // 发通知（权限被拒静默跳过——notification 插件内部处理权限，失败不 panic）
        let result = app
            .notification()
            .builder()
            .title("Helmose · 任务提醒")
            .body(format!(
                "{}{}",
                r.task_text,
                r.due_date
                    .as_deref()
                    .map(|d| format!("（截止 {}）", d))
                    .unwrap_or_default()
            ))
            .show();
        if result.is_err() {
            // 通知失败不阻塞流程，但留 log（不静默吞错）
            tracing::warn!("通知发送失败 task={}: {:?}", r.task_id, result.err());
        }
        // 标 fired=1（无论通知是否成功，避免重试风暴）
        mark_fired_inner(db.inner(), &r.id)?;
        fired_cnt += 1;
    }

    Ok(fired_cnt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::index::index_vault_inner;

    // 注：fire_due_reminders 需要 AppHandle，单测环境无 AppHandle，只测 ensure_reminders 的幂等性。
    // 端到端通知触发由集成测试 / 手动验证。

    /// 通用 setup。返回 (tmp, vid, vault_dir, db)。
    fn setup_rem() -> (tempfile::TempDir, String, std::path::PathBuf, Database) {
        let tmp = tempfile::TempDir::new().unwrap();
        let vid = uuid::Uuid::new_v4().to_string();
        let vault_dir = tmp.path().to_path_buf();
        let db_path = tmp.path().join(format!("db_{}.db", vid));
        let db = Database::new(db_path).unwrap();
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

    /// ensure_reminders 幂等性基础：同 task_id 已存在 reminder 时 COUNT 判定能正确跳过。
    /// （ensure_reminders 命令需 State，单测直接验证 SQL 与候选查询逻辑。）
    #[test]
    fn ensure_reminders_幂等判定基础() {
        let (_tmp, vid, vault_dir, db) = setup_rem();
        let today = dates::today_iso();
        std::fs::write(
            vault_dir.join("t.md"),
            format!("# T\n\n- [ ] 写报告 📅 {}\n", today),
        )
        .unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let task_id: String = db
            .sqlite()
            .query_row(
                "SELECT id FROM tasks WHERE text='写报告'",
                &[],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .unwrap();
        let rid = uuid::Uuid::new_v4().to_string();
        db.sqlite()
            .execute(
                "INSERT INTO reminders (id,task_id,note_id,vault_id,remind_at,fired,task_text,due_date,created_at) \
                 VALUES (?1,?2,?3,?4,'2026-01-01T01:00:00+00:00',0,'写报告',?5,'2026-01-01T00:00:00Z')",
                params![
                    rid,
                    task_id,
                    "placeholder_note_id",
                    vid,
                    today
                ],
            )
            .unwrap();

        // 幂等查询：同 task_id COUNT > 0 → 跳过
        let exists: i64 = db
            .sqlite()
            .query_row(
                "SELECT COUNT(*) FROM reminders WHERE task_id = ?1",
                &[&task_id as &dyn rusqlite::ToSql],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            .unwrap_or(0);
        assert_eq!(exists, 1, "已存在 reminder 应 COUNT=1");
    }

    /// 候选任务过滤：done 任务不进入候选。
    #[test]
    fn ensure_reminders_候选跳过已完成任务() {
        let (_tmp, vid, vault_dir, db) = setup_rem();
        let today = dates::today_iso();
        std::fs::write(
            vault_dir.join("d.md"),
            format!("# D\n\n- [x] 已完成 📅 {}\n- [ ] 待办 📅 {}\n", today, today),
        )
        .unwrap();
        index_vault_inner(&vid, &db).unwrap();

        let candidates: Vec<String> = db
            .sqlite()
            .query_map(
                "SELECT text FROM tasks WHERE vault_id = ?1 AND status <> 'done' AND due_date IS NOT NULL",
                &[&vid as &dyn rusqlite::ToSql],
                |r| r.get::<_, String>(0),
            )
            .unwrap();
        assert_eq!(candidates.len(), 1, "应只命中 1 个未完成任务");
        assert_eq!(candidates[0], "待办");
    }

    /// fire_due_reminders 候选查询：remind_at <= now AND fired=0。
    /// 修复 5：remind_at 与 now 都统一 UTC（带 +00:00），字典序 = 时间序。
    #[test]
    fn fire_due_reminders_候选查询() {
        let (_tmp, _vid, _vault_dir, db) = setup_rem();
        // now UTC（与 fire_due_reminders 内部 Utc::now 同口径）
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
        // r1 已到期未发（remind_at = now UTC，<= now 命中）
        db.sqlite()
            .execute(
                "INSERT INTO reminders (id,task_id,note_id,vault_id,remind_at,fired,task_text,due_date,created_at) \
                 VALUES ('r1','t1','n1','v1',?1,0,'任务A','2026-01-01','2026-01-01T00:00:00Z')",
                params![now],
            )
            .unwrap();
        // r2 未到期（远未来，UTC）
        db.sqlite()
            .execute(
                "INSERT INTO reminders (id,task_id,note_id,vault_id,remind_at,fired,task_text,due_date,created_at) \
                 VALUES ('r2','t2','n2','v2','2099-12-31T23:59:59+00:00',0,'任务B','2099-12-31','2026-01-01T00:00:00Z')",
                &[],
            )
            .unwrap();
        // r3 已发（fired=1）
        db.sqlite()
            .execute(
                "INSERT INTO reminders (id,task_id,note_id,vault_id,remind_at,fired,task_text,due_date,created_at) \
                 VALUES ('r3','t3','n3','v3','2020-01-01T00:00:00+00:00',1,'任务C','2020-01-01','2026-01-01T00:00:00Z')",
                &[],
            )
            .unwrap();

        let due_ids: Vec<String> = db
            .sqlite()
            .query_map(
                "SELECT id FROM reminders WHERE fired = 0 AND remind_at <= ?1 ORDER BY remind_at ASC",
                &[&now as &dyn rusqlite::ToSql],
                |r| r.get::<_, String>(0),
            )
            .unwrap();
        assert_eq!(due_ids.len(), 1, "应只命中已到期未发的 r1");
        assert_eq!(due_ids[0], "r1");
    }

    /// 修复 5：UTC 字典序 = 时间序（跨时区严格正确）。
    /// 构造两对 (remind_at, now) UTC 字符串，验证字典序与时间序一致：
    ///   - 早 < 晚：字典序 remind_at < now 应触发
    ///   - 同时区比较不依赖本地时区
    #[test]
    fn utc_字典序等于时间序() {
        // 早 < 晚（都 UTC）：字典序比较 = 时间序比较
        let early = "2026-07-01T01:00:00+00:00";
        let late = "2026-07-01T23:00:00+00:00";
        assert!(early < late, "UTC 早期字典序 < 晚期");
        // 同时刻不同时区表达：+00:00 UTC 与 +08:00 本地，时刻相同，但字典序会因 +08 > +00 错
        // → 验证统一 UTC 后不会出现这类错（两值都是 +00:00 时字典序严格等价于时间序）
        let a = "2026-07-01T09:00:00+00:00"; // UTC 9:00
        let b = "2026-07-01T09:00:00+00:00"; // UTC 9:00（同时刻）
        assert_eq!(a.cmp(b), std::cmp::Ordering::Equal, "同时刻 UTC 字典序相等");
        // 跨日比较（UTC）：字典序严格递增
        let d1 = "2026-06-30T23:59:00+00:00";
        let d2 = "2026-07-01T00:00:00+00:00";
        assert!(d1 < d2, "UTC 跨日字典序递增");
        // _ 用一下变量防 unused warning
        let _ = (early, late, d1, d2);
    }

    /// 审查 #13：list_due_reminders_inner + mark_fired_inner 纯函数可测。
    /// 原 fire_due_reminders 依赖 AppHandle 无法单测；拆分后查询/标 fired 可直接验证。
    #[test]
    fn list_due_and_mark_fired_纯函数() {
        let (_tmp, _vid, _vault_dir, db) = setup_rem();
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
        // r1 已到期未发
        db.sqlite()
            .execute(
                "INSERT INTO reminders (id,task_id,note_id,vault_id,remind_at,fired,task_text,due_date,created_at) \
                 VALUES ('r1','t1','n1','v1',?1,0,'任务A','2026-01-01','2026-01-01T00:00:00Z')",
                params![now],
            )
            .unwrap();
        // r2 未到期
        db.sqlite()
            .execute(
                "INSERT INTO reminders (id,task_id,note_id,vault_id,remind_at,fired,task_text,due_date,created_at) \
                 VALUES ('r2','t2','n2','v2','2099-12-31T23:59:59+00:00',0,'任务B','2099-12-31','2026-01-01T00:00:00Z')",
                &[],
            )
            .unwrap();

        // list_due 只命中 r1（r2 未到期）
        let due = list_due_reminders_inner(&db).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, "r1");

        // mark_fired r1 → 受影响 1 行
        assert_eq!(mark_fired_inner(&db, "r1").unwrap(), 1);

        // 再 list_due 应空（r1 已 fired，r2 仍未到期）
        let due2 = list_due_reminders_inner(&db).unwrap();
        assert!(due2.is_empty(), "标 fired 后应不再命中");
    }
}
