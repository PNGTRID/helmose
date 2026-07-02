// ============================================================
// 日期归一：三格式 → NaiveDate
//   ISO 横杠 2026-04-01（文件名/frontmatter）
//   点号     2026.04.01（业务里程碑）
//   ISO 周   2026-W17（周复盘 → 该周一）
// ============================================================

use chrono::{Datelike, Local, NaiveDate, Weekday};
use once_cell::sync::Lazy;
use regex::Regex;

static RE_WEEK: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(\d{4})-W(\d{2})$").unwrap());

pub fn normalize_date(s: &str) -> Option<NaiveDate> {
    let s = s.trim();

    // 1. ISO 横杠
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d);
    }
    // 2. 点号 → 横杠
    if s.contains('.') {
        if let Ok(d) = NaiveDate::parse_from_str(&s.replace('.', "-"), "%Y-%m-%d") {
            return Some(d);
        }
    }
    // 3. ISO 周 → 该周周一
    if let Some(caps) = RE_WEEK.captures(s) {
        let year: i32 = caps[1].parse().ok()?;
        let week: u32 = caps[2].parse().ok()?;
        return NaiveDate::from_isoywd_opt(year, week, chrono::Weekday::Mon);
    }
    None
}

/// 今天日期（本地时区，YYYY-MM-DD）
pub fn today_iso() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// 现在 ISO8601 时间戳
pub fn now_iso8601() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string()
}

/// unix 秒 → ISO8601（UTC rfc3339）。供 projects.last_activity 存库，前端 dayjs 解析做相对时间。
/// 非法秒（负数溢出等）返回空串（极罕见，上游默认 mtime=0 也能转）。
pub fn secs_to_iso8601(secs: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0)
        .map(|t| t.to_rfc3339())
        .unwrap_or_default()
}

// ============================================================
// M2：重复任务周期推进（toggle_task 重复推进语义）
//   day   → +1 天
//   week  → +7 天
//   month → +1 月（同日，月末溢出 chrono 自动夹到月末）
//   Mon..Sun → 下一个该 weekday（不超过 7 天，最早 = 下周该日）
// ============================================================

/// 按 repeat_rule 把日期推进到下一周期。非法 rule 或溢出 → None。
/// rule 取自 indexer::tasks::normalize_repeat_rule 的归一化值。
pub fn add_period(date: NaiveDate, rule: &str) -> Option<NaiveDate> {
    match rule {
        "day" => date.checked_add_days(chrono::Days::new(1)),
        "week" => date.checked_add_days(chrono::Days::new(7)),
        "month" => {
            // +1 月：年/月进位，日 clamp 到该月末日（2026-01-31 → 2026-02-28）
            let y = date.year();
            let m = date.month();
            let (ny, nm) = if m == 12 { (y + 1, 1u32) } else { (y, m + 1) };
            // from_ymd_opt 严格：目标月无该日 → 取该月最后一天
            NaiveDate::from_ymd_opt(ny, nm, date.day())
                .or_else(|| {
                    // 该月无此日（如 2 月 30/31 日）→ clamp 到月末
                    let last = if nm == 12 {
                        NaiveDate::from_ymd_opt(ny + 1, 1, 1)?
                    } else {
                        NaiveDate::from_ymd_opt(ny, nm + 1, 1)?
                    };
                    Some(last.pred_opt()?)
                })
        }
        wd @ ("Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun") => {
            let target = parse_weekday(wd)?;
            let cur = date.weekday();
            // chrono num_days_from_sunday(): Sun=0..Sat=6；下面用 Mon=0..Sun=6 统一
            let cur_idx = (cur.num_days_from_sunday() + 6) % 7; // Mon=0..Sun=6
            let tgt_idx = (target.num_days_from_sunday() + 6) % 7;
            // 推进天数：1..7（同 weekday 推到下周，不取 0）
            let delta = if tgt_idx > cur_idx {
                tgt_idx - cur_idx
            } else {
                7 - (cur_idx - tgt_idx)
            };
            date.checked_add_days(chrono::Days::new(delta as u64))
        }
        _ => None,
    }
}

/// 三字母星期 → chrono Weekday。未知 → None。
fn parse_weekday(s: &str) -> Option<Weekday> {
    match s {
        "Mon" => Some(Weekday::Mon),
        "Tue" => Some(Weekday::Tue),
        "Wed" => Some(Weekday::Wed),
        "Thu" => Some(Weekday::Thu),
        "Fri" => Some(Weekday::Fri),
        "Sat" => Some(Weekday::Sat),
        "Sun" => Some(Weekday::Sun),
        _ => None,
    }
}

/// 今天 NaiveDate（本地时区）。供 toggle_task 重复推进无 due_date 时取基准。
pub fn today_naive() -> NaiveDate {
    Local::now().date_naive()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_dash() {
        assert_eq!(
            normalize_date("2026-04-01"),
            Some(NaiveDate::from_ymd_opt(2026, 4, 1).unwrap())
        );
    }

    #[test]
    fn normalize_dot() {
        assert_eq!(
            normalize_date("2026.04.01"),
            Some(NaiveDate::from_ymd_opt(2026, 4, 1).unwrap())
        );
    }

    #[test]
    fn normalize_iso_week() {
        // 2026-W17 的周一是 2026-04-20
        assert_eq!(
            normalize_date("2026-W17"),
            Some(NaiveDate::from_ymd_opt(2026, 4, 20).unwrap())
        );
    }

    #[test]
    fn normalize_invalid() {
        assert_eq!(normalize_date("not a date"), None);
    }

    // ============ M2：add_period 重复推进 ============

    #[test]
    fn add_period_day_week_month() {
        let d = NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();
        assert_eq!(add_period(d, "day"), Some(NaiveDate::from_ymd_opt(2026, 7, 2).unwrap()));
        assert_eq!(add_period(d, "week"), Some(NaiveDate::from_ymd_opt(2026, 7, 8).unwrap()));
        assert_eq!(add_period(d, "month"), Some(NaiveDate::from_ymd_opt(2026, 8, 1).unwrap()));
    }

    #[test]
    fn add_period_月末夹到月末() {
        // 2026-01-31 + 1 月 → 2026-02-28（2 月无 31 日，clamp 月末）
        let d = NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
        assert_eq!(add_period(d, "month"), Some(NaiveDate::from_ymd_opt(2026, 2, 28).unwrap()));
    }

    #[test]
    fn add_period_weekday_下周该日() {
        // 2026-07-01 是周三；推进到下周一 → 2026-07-06（差 5 天）
        let wed = NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();
        assert_eq!(add_period(wed, "Mon"), Some(NaiveDate::from_ymd_opt(2026, 7, 6).unwrap()));
        // 推进到周三（同 weekday）→ 下周三（+7，不取 0）
        assert_eq!(add_period(wed, "Wed"), Some(NaiveDate::from_ymd_opt(2026, 7, 8).unwrap()));
        // 推进到周五 → 2026-07-03（差 2 天）
        assert_eq!(add_period(wed, "Fri"), Some(NaiveDate::from_ymd_opt(2026, 7, 3).unwrap()));
    }

    #[test]
    fn add_period_非法rule_none() {
        let d = NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();
        assert_eq!(add_period(d, "xyz"), None);
        assert_eq!(add_period(d, ""), None);
    }
}
