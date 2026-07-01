// 任务提取双通道：
//   A. 全文 checkbox  `- [ ]` / `- [x]` / `- [/]`
//   B. TODO section 下的 bullet（主路径，日志里 checkbox 极少）
// 解析字段（独立存，从 text 清理，与 due_date 同模式）：
//   - due_date：📅 / due: / 截止: / deadline（原模式）
//   - status：  checkbox 前缀 `[x]`=done / `[/]`=doing / `[ ]`=todo；或 bullet 内 🔄=doing
//   - priority：⭐ 数 1-3 = priority 1-3
//   - urgency： 🔥 = high（无 🔥 则默认 low；派生模式仅前端做）

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

/// 从 bullet 文本拆出 priority（⭐ 数 1-3）并清理标记。
/// 返回 (去掉 ⭐ 的干净 text, priority)。无 ⭐ → (原文, 0)。
fn split_priority(text: &str) -> (String, i32) {
    if let Some(caps) = RE_PRIORITY.captures(text) {
        let n = caps[1].chars().filter(|&c| c == '⭐').count() as i32;
        let cleaned = RE_PRIORITY.replace_all(text, "").trim().to_string();
        return (cleaned, n.clamp(1, 3));
    }
    (text.to_string(), 0)
}

/// 从 bullet 文本拆出 urgency（🔥 = high）并清理标记。
/// 返回 (去掉 🔥 的干净 text, urgency)。无 🔥 → (原文, "low")。
fn split_urgency(text: &str) -> (String, String) {
    if RE_URGENCY_HIGH.is_match(text) {
        let cleaned = RE_URGENCY_HIGH.replace_all(text, "").trim().to_string();
        return (cleaned, "high".to_string());
    }
    (text.to_string(), "low".to_string())
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

/// 对 bullet 文本依次剥离所有标记 emoji（due_date / priority / urgency / 🔄），
/// 返回最终干净 text 与所有独立字段。统一所有提取通道的清理链路。
fn split_all_marks(text: &str) -> (String, Option<String>, i32, String, bool) {
    // 顺序无关紧要（每个 split 只匹配并清理自己的 emoji，互相不影响）；
    // 但要保证最终 text 不残留任何已知 emoji，故逐道处理。
    let (t, due) = split_due(text);
    let (t, pri) = split_priority(&t);
    let (t, urg) = split_urgency(&t);
    let (t, doing_emoji) = split_doing_emoji(&t);
    (t, due, pri, urg, doing_emoji)
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

/// 通道 A：全文 checkbox
pub fn extract_checkbox(content: &str) -> Vec<ExtractedTask> {
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
            let (text, due, pri, urg, _doing_emoji) = split_all_marks(caps[2].trim());
            Some(ExtractedTask {
                text,
                done,
                status,
                source: "checkbox".to_string(),
                source_line: Some(i as i32 + 1),
                due_date: due,
                priority: pri,
                urgency: urg,
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
            let (text, due, pri, urg, doing_emoji) = split_all_marks(raw);
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
    fn urgency_无火_为low() {
        assert_eq!(split_urgency("任务").1, "low");
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
}
