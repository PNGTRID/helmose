// YAML frontmatter 解析（gray_matter）

use gray_matter::engine::YAML;
use gray_matter::Matter;
use serde_json::Value;

pub struct FrontmatterResult {
    /// frontmatter 数据（无则空 object）
    pub data: Value,
    /// 去掉 frontmatter 后的正文
    pub content: String,
}

pub fn parse(content: &str) -> FrontmatterResult {
    let matter = Matter::<YAML>::new();
    let parsed = matter.parse(content);
    // gray_matter 0.2.9: parsed.data 是 Option<Pod>（无 frontmatter 时为 None）
    let data: Value = parsed
        .data
        .as_ref()
        .and_then(|pod| pod.deserialize::<Value>().ok())
        .unwrap_or_else(|| Value::Object(Default::default()));
    FrontmatterResult {
        data,
        content: parsed.content,
    }
}
