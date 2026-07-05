// 任务提取双通道：
//   A. 全文 checkbox  `- [ ]` / `- [x]` / `- [/]`
//   B. TODO section 下的 bullet（主路径，日志里 checkbox 极少）
// 解析字段（独立存，从 text 清理，与 due_date 同模式）：
//   - due_date：📅 / due: / 截止: / deadline（原模式）
//   - status：  checkbox 前缀 `[x]`=done / `[/]`=doing / `[ ]`=todo；或 bullet 内 🔄=doing
//   - priority：读侧三格式兼容（⭐×N 老 / ⏫🔼🔽 Obsidian=3/2/1 / priority:N 文字，3=最高）
//   - urgency： 读侧二格式兼容（🔥 老 = high / urgency:high|low 文字）；mid 仅前端 due_date 派生，不入 bullet

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ExtractedTask {
    pub text: String,
    pub done: bool,
    /// 'checkbox' | 'section:明日待办'
    pub source: String,
    pub source_line: Option<i32>,
    /// 截止日期 YYYY-MM-DD（来自 bullet 内日期标记，无则 None）
    pub due_date: Option<String>,
    /// M3：任务状态（"todo" | "doing" | "done"）
    pub status: String,
    /// M3：优先级 0-3（⭐ 数）
    pub priority: i32,
    /// M3：紧急度（"low" | "mid" | "high"；🔥 = high）
    pub urgency: String,
    /// M2：重复规则（"day"/"week"/"month"/"Mon"-"Sun"）。None=非重复。
    pub repeat_rule: Option<String>,
    /// M2：相对本笔记的父任务 source_line（缩进子任务指向最近非缩进父）。
    /// 写库时由 commands 层翻译为父任务的 id（同样按 note_id+source_line 反查）。
    /// None=顶层任务（无父）。
    pub parent_source_line: Option<i32>,
}

/// 通道 A：checkbox 前缀捕获组（含 `/` 表示进行中：`- [/] 任务`）。
/// 第 1 组 = `( |x|X|/)`。
static RE_CHECKBOX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*[-*+]\s+\[( |x|X|/)\]\s+(.+)$").unwrap());

static RE_BULLET: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*[-*+]\s+(.+)").unwrap());

// 日期标记：📅 2026-07-01（Obsidian Tasks 插件常用 emoji 语法）
static RE_DUE_EMOJI: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\s*📅\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2})").unwrap());
// 日期标记：due: / 截止：/ deadline + 日期（中英文混用，全角半角冒号都收）
static RE_DUE_TEXT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\s*(?:due|截止|deadline)[：:=\s]+(\d{4}[-./]\d{1,2}[-./]\d{1,2})").unwrap()
});

// M3：状态/优先级/紧急度 emoji 标记
// 🔄 = doing（bullet 文本内独立标记，与 [/] 等价）
pub static RE_STATUS_DOING: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s*🔄").unwrap());
// ⭐ x N（连续多颗）= priority 1-3（clamp）。贪婪匹配任意正数颗 ⭐ 后整体清理，
// 避免 4+ 颗残留（priority 仍 clamp 到 3，与 set_task_priority 同口径）。
pub static RE_PRIORITY: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s*(⭐+)").unwrap());
// 🔥 = urgency high（独立标记）。匹配后整体清理。
pub static RE_URGENCY_HIGH: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s*🔥").unwrap());

// —— P1 读侧扩展：Obsidian Tasks emoji + Helmose 文字标记全兼容（Postel 法则：读宽容）——
// 写侧默认 Helmose 文字标准（P2 落地），Obsidian 兼容模式由前端 buildTaskBullet 标记风格开关控制。
//
// Obsidian Tasks 优先级 emoji：⏫=high(3) / 🔼=medium(2) / 🔽=low(1)
pub static RE_PRIORITY_OBSIDIAN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\s*(⏫|🔼|🔽)").unwrap());
// M1 单词边界：文字标记前缀要求「行首或空白」(?:^|\s+)，挡「讨论priority:2」无空格粘连误匹配；
// 「研究 priority:3 的方案」这类空格分隔正文仍会误匹配（正则固有限制，依赖用户不在正文写标记词）。
// Helmose 文字优先级：priority:1-3（大小写不敏感，数值大=高优，3=最高）
pub static RE_PRIORITY_TEXT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(?:^|\s+)priority\s*[:：]\s*([1-3])").unwrap());
// Helmose 文字紧急度：urgency:high/low（三态：显式 high/low + 未设空串；mid 仅前端 due_date 派生）
pub static RE_URGENCY_TEXT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(?:^|\s+)urgency\s*[:：]\s*(high|low)").unwrap());
// Helmose 文字重复：repeat:X（X 同 🔁 every 白名单：day/week/month/Mon-Sun，复用 normalize_repeat_rule）
pub static RE_REPEAT_TEXT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(?:^|\s+)repeat\s*[:：]\s*([A-Za-z]+)").unwrap());

// —— 写侧/剥离共用：priority 数值常量 + Obsidian emoji 双向转换（读侧 split + 写侧 set_task_* 共用，避免 magic number 漂移）——
pub const PRI_HIGH: i32 = 3;
pub const PRI_MED: i32 = 2;
pub const PRI_LOW: i32 = 1;

/// Obsidian Tasks emoji → priority 数值（⏫=3 / 🔼=2 / 🔽=1）。未知 emoji → PRI_LOW。
pub fn obsidian_emoji_to_pri(emoji: &str) -> i32 {
    match emoji {
        "⏫" => PRI_HIGH,
        "🔼" => PRI_MED,
        _ => PRI_LOW, // 🔽 或未知
    }
}

/// priority 数值 → Obsidian Tasks emoji（3=⏫ / 2=🔼 / 1=🔽）。越界 clamp 到 1-3。
pub fn pri_to_obsidian_emoji(p: i32) -> &'static str {
    match p.clamp(PRI_LOW, PRI_HIGH) {
        PRI_HIGH => "⏫",
        PRI_MED => "🔼",
        _ => "🔽",
    }
}

// 剥离专用宽正则：priority:N 数值不限范围（清越界脏值如 priority:0 / priority:5，解析侧 RE_PRIORITY_TEXT 仍只认 1-3）。
// 注：rust regex crate 不支持 look-behind，故剥离正则与解析正则分离——解析限 [1-3]，剥离收 \d+ 兜底。
// M1：前缀同步 (?:^|\s+) 与解析侧一致，保证「正文无空格粘连字样」不被误清（保留原文，与 PARSE 同口径）。
static RE_PRIORITY_TEXT_STRIP: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(?:^|\s+)priority\s*[:：]\s*\d+").unwrap());

/// 剥离所有 priority 标记（⭐×N / ⏫🔼🔽 / priority:N 三格式，含越界脏值），trim_end 保留 bullet 缩进。
/// 读侧 split_priority + 写侧 set_task_priority_inner 共用的单一源（避免三格式剥离逻辑两处漂移）。
pub fn strip_priority_marks(text: &str) -> String {
    let t = RE_PRIORITY.replace_all(text, "");
    let t = RE_PRIORITY_OBSIDIAN.replace_all(&t, "");
    let t = RE_PRIORITY_TEXT_STRIP.replace_all(&t, "");
    t.trim_end().to_string()
}

/// 剥离所有 urgency 标记（🔥 / urgency:high|low 两格式），trim_end 保留 bullet 缩进。
/// 读侧 split_urgency + 写侧 set_task_urgency_inner 共用的单一源。
pub fn strip_urgency_marks(text: &str) -> String {
    let t = RE_URGENCY_HIGH.replace_all(text, "");
    let t = RE_URGENCY_TEXT.replace_all(&t, "");
    t.trim_end().to_string()
}

/// 嗅探原 bullet 行已写的 priority 格式：含 ⏫🔼🔽 → "obsidian"；含 priority:N → "helmose"；其他（⭐ 老/无标记）→ None。
/// 写侧 set_task_priority_inner 用此优先保留单 bullet 风格稳定（不被全局快照风格覆盖）。
/// 注：⭐ 是老读侧格式（写侧不再产出），嗅探到 ⭐ 视为无明确风格 → 回落全局 marking_style（顺带引导迁移到文字契约）。
pub fn sniff_priority_style(line: &str) -> Option<&'static str> {
    if RE_PRIORITY_OBSIDIAN.is_match(line) {
        Some("obsidian")
    } else if RE_PRIORITY_TEXT.is_match(line) {
        Some("helmose")
    } else {
        None
    }
}

/// 从 bullet 文本拆出 due_date 并清理日期标记。
/// 支持 `📅 2026-07-01` / `due: 2026-07-01` / `截止：2026.07.01` / `deadline 2026-07-01`。
/// 返回 (去掉标记后的干净 text, 归一化为 YYYY-MM-DD 的 due_date)。无有效日期 → (原文, None)。
fn split_due(text: &str) -> (String, Option<String>) {
    for re in [&*RE_DUE_EMOJI, &*RE_DUE_TEXT] {
        if let Some(caps) = re.captures(text) {
            if let Some(d) = crate::utils::dates::normalize_date(&caps[1]) {
                let cleaned = re.replace_all(text, "").trim().to_string();
                return (cleaned, Some(d.to_string()));
            }
        }
    }
    (text.to_string(), None)
}

// ============================================================
// M2：toggle_task 重复推进用辅助（library.rs 调用，公开）
// ============================================================

/// 从一行 bullet 提取当前 due_date（NaiveDate）。
/// 识别 📅 / due: / 截止: / deadline 标记；无 → None。
/// 与 split_due 同口径，但不清理 text（toggle 推进只需读当前值）。
pub fn extract_due_from_line(line: &str) -> Option<chrono::NaiveDate> {
    for re in [&*RE_DUE_EMOJI, &*RE_DUE_TEXT] {
        if let Some(caps) = re.captures(line) {
            if let Some(d) = crate::utils::dates::normalize_date(&caps[1]) {
                return Some(d);
            }
        }
    }
    None
}

/// 把新 due_date 写回 bullet 行：已有 📅 / due: / 截止: / deadline 标记 → 替换；
/// 都无 → 行尾追加 ` 📅 YYYY-MM-DD`。
/// 用于 toggle_task 重复推进写回 bullet。
pub fn replace_or_append_due(line: &str, new_iso: &str) -> String {
    // 优先级：先 emoji 再文本（与 split_due 顺序一致）
    if RE_DUE_EMOJI.is_match(line) {
        return RE_DUE_EMOJI
            .replace_all(line, format!(" 📅 {}", new_iso))
            .trim_end()
            .to_string();
    }
    if RE_DUE_TEXT.is_match(line) {
        // 文本标记保留语义：due: 新日期
        let repl = format!(" due: {}", new_iso);
        return RE_DUE_TEXT
            .replace_all(line, repl.as_str())
            .trim_end()
            .to_string();
    }
    // 都没有 → 追加 📅
    format!("{} 📅 {}", line.trim_end(), new_iso)
}

/// 从 bullet 文本拆出 priority 并清理标记（读侧三格式兼容）：
///   1) `⭐×N`      Helmose 老格式（N=1-3，clamp）
///   2) `⏫🔼🔽`    Obsidian Tasks 标准（=3/2/1）
///   3) `priority:N` Helmose 文字标准（N=1-3，3=最高）
///
/// 算值：按格式优先级取首个命中（互斥）；剥离：全剥三格式（含越界脏值），保证混合格式不残留。
/// 返回 (去掉标记的干净 text, priority)。无任何标记 → (原文, 0)。
fn split_priority(text: &str) -> (String, i32) {
    // 算值：按格式优先级取首个命中（⭐ > ⏫🔼🔽 > priority:N）。同 bullet 多格式共存取首个，互斥。
    let pri = if let Some(caps) = RE_PRIORITY.captures(text) {
        caps[1].chars().filter(|&c| c == '⭐').count() as i32
    } else if let Some(caps) = RE_PRIORITY_OBSIDIAN.captures(text) {
        obsidian_emoji_to_pri(&caps[1])
    } else if let Some(caps) = RE_PRIORITY_TEXT.captures(text) {
        caps[1].parse::<i32>().unwrap_or(0)
    } else {
        0
    };
    // 全剥三格式（含越界脏值如 priority:5），单一源；保证混合格式 bullet 不残留（修 H5/S4）。
    let cleaned = strip_priority_marks(text);
    (cleaned, pri.clamp(0, PRI_HIGH))
}

/// 从 bullet 文本拆出 urgency 并清理标记（读侧二格式兼容）：
///   1) `🔥`            Helmose 老格式 = high
///   2) `urgency:high|low` Helmose 文字标准（手动二值；mid 仅前端派生，不入 bullet）
///
/// 算值后全剥两格式（单一源），保证不残留。返回 (干净 text, urgency)。
/// 三态语义（Blocker #1 方案 B）：无标记 → ""（未设，前端按 due_date 派生）；
/// `urgency:low` → "low"（显式不紧急，前端压制 due_date 派生）；🔥/urgency:high → "high"。
fn split_urgency(text: &str) -> (String, String) {
    let urg = if RE_URGENCY_HIGH.is_match(text) {
        "high".to_string()
    } else if let Some(caps) = RE_URGENCY_TEXT.captures(text) {
        caps[1].to_lowercase() // high|low（正则 (?i) 大小写不敏感，归一化为小写）
    } else {
        String::new() // 未设：无 urgency 标记（前端按 due_date 派生，区别于显式 "low"）
    };
    let cleaned = strip_urgency_marks(text);
    (cleaned, urg)
}

// M2：重复规则标记：🔁 every xxx（xxx = day/week/month 或 Mon/Tue/.../Sun，大小写不敏感）
// 语法不匹配（如 `🔁 abc` 缺 every）→ None 当普通任务，不清 🔁（保持原文）。
// 注：先匹配 every 形式；若只匹配到 🔁 但无 every 视为语法错，return None。
static RE_REPEAT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\s*🔁\s*every\s+([A-Za-z]+)").unwrap());

/// 从 bullet 文本拆出 repeat_rule 并清理标记（读侧二格式兼容）：
///   1) `🔁 every xxx` Helmose 老格式（语法错即缺 every / 词不在白名单 → 不清 🔁，保留原文）
///   2) `repeat:xxx`   Helmose 文字标准（xxx 同白名单，复用 normalize_repeat_rule）
///
/// 返回 (去掉标记的干净 text, repeat_rule)。无有效标记 → (原文, None)。
fn split_repeat(text: &str) -> (String, Option<String>) {
    // 1) 老：🔁 every xxx（normalize 失败时不清 🔁，保留原文给用户，fallthrough 试 repeat:）
    if let Some(caps) = RE_REPEAT.captures(text) {
        let raw = caps[1].to_lowercase();
        if let Some(rule) = normalize_repeat_rule(&raw) {
            let cleaned = RE_REPEAT.replace_all(text, "").trim().to_string();
            return (cleaned, Some(rule));
        }
    }
    // 2) Helmose 文字：repeat:xxx
    if let Some(caps) = RE_REPEAT_TEXT.captures(text) {
        let raw = caps[1].to_lowercase();
        if let Some(rule) = normalize_repeat_rule(&raw) {
            let cleaned = RE_REPEAT_TEXT.replace_all(text, "").trim().to_string();
            return (cleaned, Some(rule));
        }
    }
    (text.to_string(), None)
}

/// 把用户写的重复词归一化为标准规则。未知词 → None（当普通任务）。
/// day/daily → "day"；week/weekly → "week"；month/monthly → "month"；
/// Mon/Monday → "Mon"（保留星期三字母缩写，与 add_period 同口径）。
fn normalize_repeat_rule(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    match s.to_lowercase().as_str() {
        "day" | "daily" | "d" => Some("day".into()),
        "week" | "weekly" | "w" => Some("week".into()),
        "month" | "monthly" | "m" => Some("month".into()),
        "mon" | "monday" => Some("Mon".into()),
        "tue" | "tuesday" => Some("Tue".into()),
        "wed" | "wednesday" => Some("Wed".into()),
        "thu" | "thursday" => Some("Thu".into()),
        "fri" | "friday" => Some("Fri".into()),
        "sat" | "saturday" => Some("Sat".into()),
        "sun" | "sunday" => Some("Sun".into()),
        _ => None,
    }
}

/// 从 bullet 文本拆出 status 的 🔄 标记（doing）并清理。
/// 返回 (去掉 🔄 的干净 text, is_doing_emoji)。
/// 注：checkbox 前缀 `[x]/[/]` 的状态在 extract 阶段判定，本函数只清 bullet 内的 🔄。
fn split_doing_emoji(text: &str) -> (String, bool) {
    if RE_STATUS_DOING.is_match(text) {
        let cleaned = RE_STATUS_DOING.replace_all(text, "").trim().to_string();
        return (cleaned, true);
    }
    (text.to_string(), false)
}

/// 对 bullet 文本依次剥离所有标记 emoji（due_date / priority / urgency / 🔄 / 🔁），
/// 返回最终干净 text 与所有独立字段。统一所有提取通道的清理链路。
fn split_all_marks(
    text: &str,
) -> (String, Option<String>, i32, String, bool, Option<String>) {
    // 顺序无关紧要（每个 split 只匹配并清理自己的 emoji，互相不影响）；
    // 但要保证最终 text 不残留任何已知 emoji，故逐道处理。
    let (t, due) = split_due(text);
    let (t, pri) = split_priority(&t);
    let (t, urg) = split_urgency(&t);
    let (t, doing_emoji) = split_doing_emoji(&t);
    let (t, repeat) = split_repeat(&t);
    (t, due, pri, urg, doing_emoji, repeat)
}

const TODO_SECTION_KEYWORDS: &[&str] = &[
    "明日待办",
    "明日计划",
    "今日待办",
    "今日任务",
    "今日计划",
    "待办事项",
    "今日工作",
    "明日工作",
    "今日要做",
    "明日要做",
    "TODO",
];

/// 计算行首缩进的「等价空格数」（tab 按 4 空格折算，与 CommonMark 显示宽度近似）。
/// 用于 checkbox 通道 A 的子任务缩进层级判定。
fn indent_width(line: &str) -> usize {
    let mut n = 0usize;
    for c in line.chars() {
        match c {
            ' ' => n += 1,
            '\t' => n += 4,
            _ => break,
        }
    }
    n
}

/// 通道 A：全文 checkbox
/// M2：缩进层级追踪——缩进 >0 的 checkbox 视为子任务，parent_source_line 指向最近的
/// 非缩进（顶层）checkbox 任务的 source_line。栈式：每个非缩进任务成为后续缩进任务的父，
/// 直到出现下一个非缩进任务（替换栈顶）。
pub fn extract_checkbox(content: &str) -> Vec<ExtractedTask> {
    // 栈顶：最近一个非缩进（顶层）checkbox 任务的 source_line（1-based）。
    let mut top_parent_line: Option<i32> = None;
    content
        .lines()
        .enumerate()
        .filter_map(|(i, line)| {
            let caps = RE_CHECKBOX.captures(line)?;
            // checkbox 前缀决定 status：x/X → done，/ → doing，空格 → todo
            let (status, done) = match &caps[1] {
                "x" | "X" => ("done".to_string(), true),
                "/" => ("doing".to_string(), false),
                _ => ("todo".to_string(), false),
            };
            // 拆标记 emoji（🔄 不影响 checkbox 类的 status——前缀优先）
            let (text, due, pri, urg, _doing_emoji, repeat) = split_all_marks(caps[2].trim());
            let line_no = i as i32 + 1;
            let indent = indent_width(line);
            // 缩进 >0 且栈顶有父 → 子任务；否则为顶层任务（刷新栈顶）
            let parent_source_line = if indent > 0 {
                top_parent_line
            } else {
                top_parent_line = Some(line_no);
                None
            };
            Some(ExtractedTask {
                text,
                done,
                status,
                source: "checkbox".to_string(),
                source_line: Some(line_no),
                due_date: due,
                priority: pri,
                urgency: urg,
                repeat_rule: repeat,
                parent_source_line,
            })
        })
        .collect()
}

/// 通道 B：指定 section body 下的所有 bullet
pub fn extract_bullets(body: &str, source: &str) -> Vec<ExtractedTask> {
    body.lines()
        .filter_map(|line| {
            let caps = RE_BULLET.captures(line)?;
            let raw = caps[1].trim();
            if raw.is_empty() {
                return None;
            }
            // 跳过 checkbox 行（由 extract_checkbox 处理，避免重复提取）
            if RE_CHECKBOX.is_match(line) {
                return None;
            }
            // section 类无 checkbox → status 默认 todo；bullet 内 🔄 → doing
            let (text, due, pri, urg, doing_emoji, repeat) = split_all_marks(raw);
            let status = if doing_emoji { "doing" } else { "todo" };
            Some(ExtractedTask {
                text,
                done: false,
                status: status.to_string(),
                source: source.to_string(),
                source_line: None,
                due_date: due,
                priority: pri,
                urgency: urg,
                repeat_rule: repeat,
                // section 通道 B 不追踪缩进（多为平铺列表，子任务语义弱）
                parent_source_line: None,
            })
        })
        .collect()
}

/// 判断 section 名是否属于"待办类"
pub fn is_todo_section(name: &str) -> bool {
    let n = name.trim();
    TODO_SECTION_KEYWORDS.iter().any(|k| n.contains(k))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkbox_done_undone() {
        let v = extract_checkbox("- [x] 完成\n- [ ] 未完成\n普通行");
        assert_eq!(v.len(), 2);
        assert!(v[0].done);
        assert_eq!(v[0].status, "done");
        assert!(!v[1].done);
        assert_eq!(v[1].status, "todo");
    }

    #[test]
    fn bullets_from_body() {
        let v = extract_bullets("- 任务A\n- 任务B\n普通段落", "section:明日待办");
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].source, "section:明日待办");
    }

    #[test]
    fn todo_section_match() {
        assert!(is_todo_section("明日待办"));
        assert!(is_todo_section("今日任务"));
        assert!(!is_todo_section("关键事件"));
    }

    #[test]
    fn due_date_emoji_解析并清理() {
        // 📅 2026-07-01 → due_date 提取 + text 去掉标记
        let v = extract_checkbox("- [ ] 写设计文档 📅 2026-07-01");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].due_date.as_deref(), Some("2026-07-01"));
        assert_eq!(v[0].text, "写设计文档", "text 应去掉日期标记");
        assert!(!v[0].done);
    }

    #[test]
    fn due_date_文本标记_中英文() {
        // due: / 截止：/ deadline 三种文本标记都应解析
        assert_eq!(
            split_due("上线 due: 2026-07-01").1.as_deref(),
            Some("2026-07-01")
        );
        assert_eq!(
            split_due("提交截止：2026.07.01").1.as_deref(),
            Some("2026-07-01"),
            "点号日期应归一化为横杠"
        );
        assert_eq!(
            split_due("deadline 2026-07-01 发布").1.as_deref(),
            Some("2026-07-01")
        );
    }

    #[test]
    fn 无日期标记_due_none_text原样() {
        let (text, due) = split_due("普通任务无日期");
        assert_eq!(text, "普通任务无日期");
        assert!(due.is_none());
    }

    #[test]
    fn bullets_也带_due_date() {
        let v = extract_bullets("- 跟进客户 📅 2026-07-15\n", "section:今日待办");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].due_date.as_deref(), Some("2026-07-15"));
        assert_eq!(v[0].source, "section:今日待办");
    }

    // ============ M3 新增：status / priority / urgency ============

    #[test]
    fn status_斜杠前缀为doing() {
        // `- [/] 任务` = doing
        let v = extract_checkbox("- [/] 进行中任务");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].status, "doing");
        assert!(!v[0].done, "[/] 不应判定 done");
    }

    #[test]
    fn status_emoji_刷新_为doing_并清理text() {
        // `- [ ] 任务 🔄` = doing（emoji 标记）
        let v = extract_checkbox("- [ ] 进行中任务 🔄");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].status, "todo", "checkbox 类 status 由前缀决定（[ ]=todo）");
        assert_eq!(v[0].text, "进行中任务", "🔄 应从 text 清理");
    }

    #[test]
    fn status_emoji_刷新_section类提升doing() {
        // section 类 bullet：🔄 提升 status 为 doing
        let v = extract_bullets("- 跟进客户 🔄\n", "section:今日待办");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].status, "doing", "section 类 🔄 应提升 status 为 doing");
        assert_eq!(v[0].text, "跟进客户");
    }

    #[test]
    fn priority_星星数_解析并清理text() {
        // `- [ ] 任务 ⭐⭐` = priority 2
        let v = extract_checkbox("- [ ] 重要任务 ⭐⭐");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].priority, 2, "⭐⭐ → priority 2");
        assert_eq!(v[0].text, "重要任务", "⭐ 应从 text 清理");
    }

    #[test]
    fn priority_单星_三星() {
        assert_eq!(split_priority("任务 ⭐").1, 1);
        assert_eq!(split_priority("任务 ⭐⭐⭐").1, 3);
        assert_eq!(split_priority("任务").1, 0, "无 ⭐ → 0");
    }

    #[test]
    fn urgency_火_为high_并清理text() {
        // 🔥 = urgency high
        let v = extract_checkbox("- [ ] 紧急任务 🔥");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].urgency, "high");
        assert_eq!(v[0].text, "紧急任务", "🔥 应从 text 清理");
    }

    #[test]
    fn urgency_无火_为未设空串() {
        // 三态：无标记 → ""（未设，前端按 due_date 派生，区别于显式 "low"）
        assert_eq!(split_urgency("任务").1, "");
        assert_eq!(split_urgency("任务 🔥").1, "high");
    }

    #[test]
    fn 多标记共存_全部剥离_text干净() {
        // `- [/] 任务 🔄 ⭐⭐ 🔥 📅 2026-07-01` → status=doing（前缀优先）/ priority=2 / urgency=high / due=2026-07-01 / text=任务
        let v = extract_checkbox("- [/] 任务 🔄 ⭐⭐ 🔥 📅 2026-07-01");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].status, "doing", "[/] 前缀 → doing");
        assert_eq!(v[0].priority, 2);
        assert_eq!(v[0].urgency, "high");
        assert_eq!(v[0].due_date.as_deref(), Some("2026-07-01"));
        assert_eq!(
            v[0].text, "任务",
            "所有 emoji 标记应剥离干净，text 只剩「任务」"
        );
    }

    #[test]
    fn section类_多标记共存() {
        // section bullet：- 任务 ⭐ 🔥 📅 2026-08-01 → priority 1 / urgency high / due 2026-08-01 / text=任务
        let v = extract_bullets("- 任务 ⭐ 🔥 📅 2026-08-01\n", "section:今日待办");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].priority, 1);
        assert_eq!(v[0].urgency, "high");
        assert_eq!(v[0].due_date.as_deref(), Some("2026-08-01"));
        assert_eq!(v[0].text, "任务");
    }

    #[test]
    fn 多标记无空格边界_仍剥离() {
        // `- [ ] 任务⭐⭐🔥`（emoji 无空格分隔，边界场景）→ priority=2 / urgency=high / text=任务
        // 验证正则 `\s*` 前缀允许 0 空格，无空格边界也能剥离干净（不残留 emoji）
        let v = extract_checkbox("- [ ] 任务⭐⭐🔥");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].priority, 2, "⭐⭐ 无空格边界 → priority 2");
        assert_eq!(v[0].urgency, "high", "🔥 无空格边界 → urgency high");
        assert_eq!(v[0].text, "任务", "emoji 应剥离干净");
    }

    // ============ M2 新增：split_repeat / 子任务缩进 ============

    #[test]
    fn repeat_rule_解析并清理text() {
        // `- [ ] 周报 🔁 every week` → repeat_rule=Some("week"), text="周报"
        let v = extract_checkbox("- [ ] 周报 🔁 every week");
        assert_eq!(v.len(), 1);
        assert_eq!(
            v[0].repeat_rule.as_deref(),
            Some("week"),
            "🔁 every week → repeat_rule=week"
        );
        assert_eq!(v[0].text, "周报", "🔁 标记应从 text 清理");
    }

    #[test]
    fn repeat_rule_多种词归一化() {
        // daily/weekly/monthly 与缩写都归一化；星期全称 → 三字母
        assert_eq!(split_repeat("任务 🔁 every daily").1.as_deref(), Some("day"));
        assert_eq!(split_repeat("任务 🔁 every weekly").1.as_deref(), Some("week"));
        assert_eq!(
            split_repeat("任务 🔁 every monthly").1.as_deref(),
            Some("month")
        );
        assert_eq!(
            split_repeat("任务 🔁 every Monday").1.as_deref(),
            Some("Mon")
        );
        assert_eq!(
            split_repeat("任务 🔁 every fri").1.as_deref(),
            Some("Fri")
        );
    }

    #[test]
    fn repeat_rule_语法错_当普通任务() {
        // `🔁 abc`（缺 every）→ None，当普通任务（不清 🔁 也无所谓，提取不影响其它字段）
        let v = extract_checkbox("- [ ] 任务 🔁 abc");
        assert_eq!(v.len(), 1);
        assert!(v[0].repeat_rule.is_none(), "语法错应返回 None");
        // `🔁 every xyz`（词不在白名单）→ None
        let (text, rule) = split_repeat("任务 🔁 every xyz");
        assert!(rule.is_none(), "未知词应返回 None");
        // 语法错时 text 不变（保持原文，不强制清理未识别的 🔁）
        assert!(!text.is_empty());
    }

    #[test]
    fn extract_due_from_line_三格式与无标记() {
        use chrono::NaiveDate;
        let d = |y, m, d| NaiveDate::from_ymd_opt(y, m, d).unwrap();
        // 📅 emoji
        assert_eq!(extract_due_from_line("- [ ] 任务 📅 2026-07-01"), Some(d(2026, 7, 1)));
        // due: 文本
        assert_eq!(extract_due_from_line("- [ ] 任务 due: 2026-07-01"), Some(d(2026, 7, 1)));
        // 截止: 中文
        assert_eq!(extract_due_from_line("- [ ] 任务 截止: 2026-07-01"), Some(d(2026, 7, 1)));
        // 无标记 → None
        assert_eq!(extract_due_from_line("- [ ] 任务"), None);
    }

    #[test]
    fn replace_or_append_due_替换与追加() {
        // 已有 📅 → 替换，旧日期不残留
        let r = replace_or_append_due("- [ ] 任务 📅 2026-06-01", "2026-07-15");
        assert!(r.contains("📅 2026-07-15"));
        assert!(!r.contains("2026-06-01"), "旧日期应被替换不残留");
        // 已有 due: → 替换，保留 due: 语义（不退化为 📅）
        let r = replace_or_append_due("- [ ] 任务 due: 2026-06-01", "2026-07-15");
        assert!(r.contains("due: 2026-07-15"));
        assert!(!r.contains("📅"), "due: 文本标记不应退化为 📅");
        assert!(!r.contains("2026-06-01"));
        // 无标记 → 追加 📅，保留原文
        let r = replace_or_append_due("- [ ] 任务", "2026-07-15");
        assert!(r.contains("📅 2026-07-15"));
        assert!(r.contains("任务"));
    }

    #[test]
    fn repeat_rule_无标记_none() {
        let v = extract_checkbox("- [ ] 普通任务");
        assert_eq!(v.len(), 1);
        assert!(v[0].repeat_rule.is_none());
    }

    #[test]
    fn 子任务缩进_parent指向最近非缩进父() {
        // 顶层任务 + 缩进子任务（2 空格缩进）→ 子 parent_source_line 指向父的 1-based 行号
        let content = "- [ ] 父任务\n  - [ ] 子任务A\n  - [ ] 子任务B\n- [ ] 另一个父\n  - [ ] 子C";
        let v = extract_checkbox(content);
        assert_eq!(v.len(), 5);
        // 父1（line 1）无父
        assert_eq!(v[0].source_line, Some(1));
        assert!(v[0].parent_source_line.is_none(), "顶层任务无父");
        // 子A（line 2）父=父1（line 1）
        assert_eq!(v[1].source_line, Some(2));
        assert_eq!(v[1].parent_source_line, Some(1), "子A 父=父1");
        // 子B（line 3）父=父1（line 1）
        assert_eq!(v[2].source_line, Some(3));
        assert_eq!(v[2].parent_source_line, Some(1), "子B 父=父1");
        // 父2（line 4）无父
        assert_eq!(v[3].source_line, Some(4));
        assert!(v[3].parent_source_line.is_none());
        // 子C（line 5）父=父2（line 4）
        assert_eq!(v[4].source_line, Some(5));
        assert_eq!(v[4].parent_source_line, Some(4), "子C 父=父2");
    }

    #[test]
    fn 子任务多层缩进_取最近非缩进() {
        // 多层缩进：父(0) → 子(2) → 孙(4)；本实现按「最近非缩进」语义，
        // 子指向父，孙也指向父（不追踪中间层，简化语义：缩进 >0 都归最近顶层）
        let content = "- [ ] 父\n  - [ ] 子\n    - [ ] 孙";
        let v = extract_checkbox(content);
        assert_eq!(v.len(), 3);
        assert!(v[0].parent_source_line.is_none());
        assert_eq!(v[1].parent_source_line, Some(1), "子 → 父");
        assert_eq!(v[2].parent_source_line, Some(1), "孙 → 最近顶层（父）");
    }

    // ============ P1：读侧三格式兼容（Obsidian Tasks emoji + Helmose 文字） ============

    #[test]
    fn priority_obsidian_箭头_解析为3_2_1() {
        // Obsidian Tasks 标准：⏫=high(3) / 🔼=medium(2) / 🔽=low(1)
        assert_eq!(split_priority("任务 ⏫").1, 3);
        assert_eq!(split_priority("任务 🔼").1, 2);
        assert_eq!(split_priority("任务 🔽").1, 1);
        assert_eq!(split_priority("任务 ⏫").0, "任务", "text 清理");
    }

    #[test]
    fn priority_文字标记_解析() {
        // Helmose 文字标准：priority:N（1-3，3=最高）
        assert_eq!(split_priority("任务 priority:1").1, 1);
        assert_eq!(split_priority("任务 priority:3").1, 3);
        assert_eq!(split_priority("任务 PRIORITY:2").1, 2, "大小写不敏感");
        assert_eq!(split_priority("任务 priority：2").1, 2, "全角冒号也收");
        assert_eq!(split_priority("任务 priority:2").0, "任务", "text 清理");
        // M1 单词边界：无空格粘连（中文/拉丁紧贴 priority）不识别为标记，保留原文（PARSE/STRIP 一致）
        assert_eq!(split_priority("讨论priority:2").1, 0, "中文紧贴不识别");
        assert_eq!(split_priority("讨论priority:2").0, "讨论priority:2", "原文保留不清洗");
        assert_eq!(split_priority("xpriority:2").1, 0, "拉丁粘连不识别");
    }

    #[test]
    fn urgency_文字标记_解析() {
        assert_eq!(split_urgency("任务 urgency:high").1, "high");
        assert_eq!(split_urgency("任务 urgency:low").1, "low");
        assert_eq!(split_urgency("任务 URGENCY:HIGH").1, "high", "大小写不敏感");
        assert_eq!(split_urgency("任务 urgency:high").0, "任务", "text 清理");
        // M1 单词边界：无空格粘连不识别为标记，保留原文
        assert_eq!(split_urgency("讨论urgency:high").1, "", "中文紧贴不识别");
        assert_eq!(split_urgency("讨论urgency:high").0, "讨论urgency:high", "原文保留不清洗");
    }

    #[test]
    fn repeat_文字标记_解析() {
        assert_eq!(split_repeat("任务 repeat:week").1.as_deref(), Some("week"));
        assert_eq!(split_repeat("任务 repeat:Mon").1.as_deref(), Some("Mon"));
        assert_eq!(
            split_repeat("任务 REPEAT:monthly").1.as_deref(),
            Some("month"),
            "大小写不敏感 + 全称归一化"
        );
        assert_eq!(split_repeat("任务 repeat:week").0, "任务", "text 清理");
    }

    #[test]
    fn obsidian_用户_bullet_全兼容() {
        // Obsidian Tasks 标准子弹：📅 due + ⏫ priority → Helmose 应识别（用户零摩擦切入）
        let v = extract_checkbox("- [ ] 季度评审 📅 2026-09-30 ⏫");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].due_date.as_deref(), Some("2026-09-30"));
        assert_eq!(v[0].priority, 3, "⏫ → priority 3");
        assert_eq!(v[0].text, "季度评审");
    }

    #[test]
    fn helmose_文字_bullet_全字段() {
        // Helmose 写侧标准（P2 默认输出）：文字 key:value 全字段，#project 标签保留
        let v = extract_checkbox(
            "- [ ] 写周报 due:2026-07-01 priority:3 urgency:high repeat:week #project:Helmose",
        );
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].due_date.as_deref(), Some("2026-07-01"));
        assert_eq!(v[0].priority, 3);
        assert_eq!(v[0].urgency, "high");
        assert_eq!(v[0].repeat_rule.as_deref(), Some("week"));
        assert_eq!(v[0].text, "写周报 #project:Helmose");
    }

    // ============ 回归：混合格式全剥 + 越界值剥离（H5/S4/H6）============

    #[test]
    fn 混合格式priority_全部剥离不残留() {
        // 脏数据：⭐ 与 priority:N 共存 → 算值取 ⭐（格式优先级首个命中），全剥两种格式不残留
        let (text, pri) = split_priority("任务 ⭐⭐ priority:3");
        assert_eq!(pri, 2, "⭐ 命中优先 → priority 2");
        assert_eq!(text, "任务", "priority:3 也应剥离，不残留");
        // ⏫ 与 priority:N 共存
        let (text, pri) = split_priority("任务 ⏫ priority:1");
        assert_eq!(pri, 3, "⏫ 命中优先 → priority 3");
        assert_eq!(text, "任务", "priority:1 也应剥离");
    }

    #[test]
    fn 越界priority文字值_剥离不残留() {
        // priority:5 / priority:0 不在解析范围 [1-3]，但剥离必须清掉（否则 set_task_priority(0) 清空会残留）
        let (text, pri) = split_priority("任务 priority:5");
        assert_eq!(pri, 0, "越界值不解析 → 0");
        assert_eq!(text, "任务", "越界 priority:5 仍应剥离");
        assert_eq!(strip_priority_marks("任务 priority:0"), "任务");
    }

    #[test]
    fn sniff_priority风格_嗅探原行格式() {
        // obsidian emoji 行 → "obsidian"；priority:N 行 → "helmose"；⭐/无标记 → None
        assert_eq!(sniff_priority_style("任务 ⏫"), Some("obsidian"));
        assert_eq!(sniff_priority_style("任务 priority:2"), Some("helmose"));
        assert_eq!(sniff_priority_style("任务 ⭐⭐"), None, "⭐ 老格式不嗅探");
        assert_eq!(sniff_priority_style("任务"), None);
    }
}
