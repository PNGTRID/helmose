// Markdown section 切分：按 H2/H3 标题切成 {标题: 正文}

use std::collections::HashMap;

/// 返回 {section_name: body}（body 不含标题行，含该 section 到下一个同级标题间的内容）
pub fn split_sections(content: &str) -> HashMap<String, String> {
    let mut sections: HashMap<String, String> = HashMap::new();
    let mut current: Option<String> = None;
    let mut buf = String::new();
    for line in content.lines() {
        if let Some(name) = heading_name(line) {
            if let Some(c) = current.take() {
                sections.insert(c, std::mem::take(&mut buf));
            }
            current = Some(name);
        } else if current.is_some() {
            buf.push_str(line);
            buf.push('\n');
        }
    }
    if let Some(c) = current {
        sections.insert(c, buf);
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
