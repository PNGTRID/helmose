// 项目提取：从 frontmatter type=project 的笔记提取项目信息
// 状态来自 tags 里的 project-status:<status>（规范.md 定义 active/completed/paused/abandoned，实际还有 pending）
//
// 字段分两层算：
//   本地（extract 内）：name / status / home_rel_path / priority(fm) / is_mainline(① fm.mainline ② tag) / okr_priority
//   全局（apply_global_passes，需全集）：
//     - last_activity：home 父目录下所有 .md 的 max(mtime)，父目录是顶层/根则退化用自身 mtime
//     - priority 兜底：fm 无 priority 的按 name 字母序分桶 150/100/50
//     - is_mainline ③：status==active 且 (priority, activity) 在本 vault top-3

use crate::services::contract::TOP_LEVEL_DIRS;
use crate::services::indexer::ParsedNote;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct ProjectInfo {
    pub name: String,
    /// active | pending | paused | completed | abandoned
    pub status: Option<String>,
    pub home_rel_path: String,
    /// 优先级：frontmatter.priority（数字）；无则 None，由全局 pass 兜底
    pub priority: Option<f64>,
    /// 本地判定：① fm.mainline==true 或 ② tags 含 "mainline"。全局 ③ top-3 由外层补
    pub is_mainline: bool,
    /// fm.okr > tag "okr:*" > tag 含 "goal" → "goal" > None
    pub okr_priority: Option<String>,
    /// 活跃度 mtime（初始=笔记自身 mtime；全局 pass 提升为同目录 max）。同时用于排序与转 last_activity
    pub activity_mtime: i64,
    /// 全局 pass 填的 ISO8601 字符串（前端相对时间用）
    pub last_activity: Option<String>,
    /// M5：负责人（frontmatter.owner 字符串，无则 None）
    pub owner: Option<String>,
}

/// 判定并提取项目信息（本地字段）。非 project 类型返回 None。
/// activity_mtime 初始化为笔记 mtime，last_activity 留 None 待全局 pass 填。
pub fn extract(p: &ParsedNote) -> Option<ProjectInfo> {
    let ftype = p.frontmatter.get("type").and_then(|v| v.as_str())?;
    if ftype != "project" {
        return None;
    }
    let name = p.title.clone().unwrap_or_else(|| {
        Path::new(&p.file_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&p.file_name)
            .to_string()
    });
    // tags 里找 project-status:<x>
    let status = p
        .tags
        .iter()
        .find_map(|t| t.strip_prefix("project-status:").map(str::to_string));

    // priority：frontmatter.priority（支持数字或数字字符串）
    let priority = p
        .frontmatter
        .get("priority")
        .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok())));

    // is_mainline 本地：① fm.mainline==true ② tags 含 "mainline"（忽略大小写）
    let fm_mainline = p
        .frontmatter
        .get("mainline")
        .map(|v| v.as_bool().unwrap_or(false))
        .unwrap_or(false);
    let tag_mainline = p.tags.iter().any(|t| t.eq_ignore_ascii_case("mainline"));
    let is_mainline = fm_mainline || tag_mainline;

    // okr_priority：fm.okr > tag "okr:*" > tag 含 "goal" → "goal"
    let okr_priority = p
        .frontmatter
        .get("okr")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| {
            p.tags
                .iter()
                .find_map(|t| t.strip_prefix("okr:").map(str::to_string))
        })
        .or_else(|| {
            p.tags
                .iter()
                .find(|t| t.to_lowercase().contains("goal"))
                .map(|_| "goal".to_string())
        });

    // M5：owner（frontmatter.owner 字符串）
    let owner = p
        .frontmatter
        .get("owner")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    Some(ProjectInfo {
        name,
        status,
        home_rel_path: p.rel_path.clone(),
        priority,
        is_mainline,
        okr_priority,
        activity_mtime: p.mtime,
        last_activity: None,
        owner,
    })
}

/// 取 rel_path 的父目录（`/` 归一；根级文件返回空串）。
fn parent_dir_of(rel_path: &str) -> String {
    let norm = rel_path.replace('\\', "/");
    match norm.rfind('/') {
        Some(i) => norm[..i].to_string(),
        None => String::new(),
    }
}

/// 算单个 project 的 activity_mtime：home 父目录下所有 .md 的 max(mtime)。
/// 父目录是顶层目录（00~09 根）或根级文件（父目录空）→ 退化为自身 mtime，
/// 避免扫整个顶层共享目录（性能 + 语义双护）。
fn last_activity_for(home_rel_path: &str, self_mtime: i64, all_parsed: &[ParsedNote]) -> i64 {
    let parent = parent_dir_of(home_rel_path);
    if parent.is_empty() || TOP_LEVEL_DIRS.contains(&parent.as_str()) {
        return self_mtime;
    }
    let prefix = format!("{}/", parent);
    let mut max = self_mtime;
    for p in all_parsed {
        if p.rel_path.starts_with(&prefix) && p.mtime > max {
            max = p.mtime;
        }
    }
    max
}

/// 全局 pass（需全集）：填 last_activity、兜底 priority、补 top-3 mainline。
/// `records` = (note_id, ProjectInfo)；`all_parsed` = 全量解析结果（算 last_activity 用）。
pub fn apply_global_passes(records: &mut [(String, ProjectInfo)], all_parsed: &[ParsedNote]) {
    // 1. last_activity（ISO8601）
    for (_id, info) in records.iter_mut() {
        info.activity_mtime = last_activity_for(&info.home_rel_path, info.activity_mtime, all_parsed);
        info.last_activity = Some(crate::utils::dates::secs_to_iso8601(info.activity_mtime));
    }
    // 2. priority 兜底（仅 priority=None 的，按 name 字母序分桶 150/100/50）
    assign_fallback_priorities(records);
    // 3. is_mainline ③（status==active 且非已主线 → 按 priority/activity 取 top-3 补主线）
    assign_mainline_top3(records);
}

/// priority 仍为 None 的，按 name（小写）字母序全局排名分桶：rank0→150 / rank1→100 / 其余→50。
/// 决策：规则原文「按 01_企业... 下字母序兜底」简化为全局字母序（项目可能不在 01 下，全局更通用）。
fn assign_fallback_priorities(records: &mut [(String, ProjectInfo)]) {
    // 收集 (records 下标, name) 仅针对 priority=None 的
    let mut keyed: Vec<(usize, String)> = records
        .iter()
        .enumerate()
        .filter(|(_, (_, i))| i.priority.is_none())
        .map(|(idx, (_, i))| (idx, i.name.to_lowercase()))
        .collect();
    keyed.sort_by(|a, b| a.1.cmp(&b.1));
    for (rank, (idx, _)) in keyed.into_iter().enumerate() {
        let p = match rank {
            0 => 150.0,
            1 => 100.0,
            _ => 50.0,
        };
        records[idx].1.priority = Some(p);
    }
}

/// is_mainline 仍 false 且 status==active 的，按 (priority desc, activity_mtime desc) 取 top-3 置主线。
fn assign_mainline_top3(records: &mut [(String, ProjectInfo)]) {
    let mut cand: Vec<usize> = records
        .iter()
        .enumerate()
        .filter(|(_, (_, i))| !i.is_mainline && i.status.as_deref() == Some("active"))
        .map(|(idx, _)| idx)
        .collect();
    cand.sort_by(|&a, &b| {
        let pa = records[a].1.priority.unwrap_or(0.0);
        let pb = records[b].1.priority.unwrap_or(0.0);
        pb.partial_cmp(&pa)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| records[b].1.activity_mtime.cmp(&records[a].1.activity_mtime))
    });
    for &idx in cand.iter().take(3) {
        records[idx].1.is_mainline = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(name: &str, status: Option<&str>, priority: Option<f64>, mainline: bool, mtime: i64) -> (String, ProjectInfo) {
        (
            name.to_string(),
            ProjectInfo {
                name: name.to_string(),
                status: status.map(str::to_string),
                home_rel_path: format!("01_企业与项目资产/{}/{}.md", name, name),
                priority,
                is_mainline: mainline,
                okr_priority: None,
                activity_mtime: mtime,
                last_activity: None,
                owner: None,
            },
        )
    }

    #[test]
    fn 兜底优先级_按字母序分桶() {
        let mut rec = vec![
            mk("Zeta", Some("active"), None, false, 100),
            mk("Alpha", Some("active"), None, false, 100),
            mk("Mid", Some("active"), None, false, 100),
        ];
        assign_fallback_priorities(&mut rec);
        // 不直接依赖顺序，按 name 找
        let by_name = |n: &str| rec.iter().find(|(_, i)| i.name == n).unwrap().1.priority;
        assert_eq!(by_name("Alpha"), Some(150.0), "Alpha 字母序第一 → 150");
        assert_eq!(by_name("Mid"), Some(100.0), "Mid 第二 → 100");
        assert_eq!(by_name("Zeta"), Some(50.0), "Zeta 第三 → 50");
    }

    #[test]
    fn top3_mainline_补活跃项目() {
        // 5 个 active 非主线项目，priority 各异 → 取 priority 最高的 3 个补主线
        let mut rec = vec![
            mk("A", Some("active"), Some(10.0), false, 100),
            mk("B", Some("active"), Some(90.0), false, 100),
            mk("C", Some("active"), Some(50.0), false, 100),
            mk("D", Some("active"), Some(30.0), false, 100),
            mk("E", Some("active"), Some(70.0), false, 100),
        ];
        assign_mainline_top3(&mut rec);
        let main = |n: &str| rec.iter().find(|(_, i)| i.name == n).unwrap().1.is_mainline;
        // priority 高的 B(90)/E(70)/C(50) 进 top-3
        assert!(main("B") && main("E") && main("C"), "top-3 priority 应被置主线");
        assert!(!main("A") && !main("D"), "低 priority 不进 top-3");
    }

    #[test]
    fn 已主线_or_非active_不重算() {
        let mut rec = vec![
            mk("X", Some("paused"), None, false, 100), // 非 active → 不补
            mk("Y", Some("active"), None, true, 100),   // 已主线 → 保持
        ];
        assign_mainline_top3(&mut rec);
        assert!(!rec[0].1.is_mainline, "paused 不补主线");
        assert!(rec[1].1.is_mainline, "已主线保持");
    }

    #[test]
    fn last_activity_父目录是顶层_退化自身mtime() {
        // home 在顶层目录直接下（01_企业与项目资产/项目X.md）→ 退化
        let parsed: Vec<ParsedNote> = vec![];
        let v = last_activity_for("01_企业与项目资产/项目X.md", 12345, &parsed);
        assert_eq!(v, 12345, "顶层目录退化用自身 mtime，不扫共享目录");
    }
}
