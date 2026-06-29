// ============================================================
// 日期归一：三格式 → NaiveDate
//   ISO 横杠 2026-04-01（文件名/frontmatter）
//   点号     2026.04.01（业务里程碑）
//   ISO 周   2026-W17（周复盘 → 该周一）
// ============================================================

use chrono::NaiveDate;
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

/// ISO 周编号（如 2026-W17）→ 返回该周一的 NaiveDate
pub fn iso_week_to_monday(iso_week: &str) -> Option<NaiveDate> {
    let caps = RE_WEEK.captures(iso_week.trim())?;
    let year: i32 = caps[1].parse().ok()?;
    let week: u32 = caps[2].parse().ok()?;
    NaiveDate::from_isoywd_opt(year, week, chrono::Weekday::Mon)
}

/// 今天日期（本地时区，YYYY-MM-DD）
pub fn today_iso() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// 现在 ISO8601 时间戳
pub fn now_iso8601() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string()
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
}
