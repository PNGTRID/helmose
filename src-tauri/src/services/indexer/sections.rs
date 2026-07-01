// Markdown section 切分：按 H2/H3 标题切成 SectionInfo（带标题行号，供行级写入定位原文行）

/// 带标题行号的 section（供 events 提取行号 / 行级写入定位原文行）
#[derive(Debug, Clone)]
pub struct SectionInfo {
    pub name: String,
    pub body: String,
    /// 标题所在全文行号（1-based）；body 第 i 行（0-based enumerate）对应全文 heading_line+1+i 行
    pub heading_line: usize,
}

/// 与 split_sections 同口径，但保留每个 section 的标题行号（1-based）。
/// 重复同名 section 都保留（Vec），不像 split_sections（HashMap）会覆盖。
pub fn split_sections_with_lines(content: &str) -> Vec<SectionInfo> {
    let mut sections: Vec<SectionInfo> = Vec::new();
    let mut cur: Option<usize> = None; // 当前 section 在 sections 的 index
    for (i, line) in content.lines().enumerate() {
        let line_no = i + 1; // 1-based
        if let Some(name) = heading_name(line) {
            sections.push(SectionInfo {
                name,
                body: String::new(),
                heading_line: line_no,
            });
            cur = Some(sections.len() - 1);
        } else if let Some(idx) = cur {
            sections[idx].body.push_str(line);
            sections[idx].body.push('\n');
        }
    }
    sections
}

fn heading_name(line: &str) -> Option<String> {
    let t = line.trim_start();
    let n = t.chars().take_while(|&c| c == '#').count();
    if !(2..=6).contains(&n) {
        return None;
    }
    let rest = t[n..].trim();
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}
