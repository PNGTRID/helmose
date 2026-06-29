use serde::{Deserialize, Serialize};

/// 笔记：与物理 md 文件 1:1
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub vault_id: String,
    pub rel_path: String,
    pub file_name: String,
    pub title: Option<String>,
    /// log | experience | project | profile | weekly | note | ...
    pub note_type: Option<String>,
    /// 1=高结构 / 2=半结构 / 3=零结构
    pub layer: i32,
    pub date_iso: Option<String>,
    pub week_iso: Option<String>,
    pub tags: Vec<String>,
    /// 原始 frontmatter（保真 JSON，供 AI 用）
    pub frontmatter: serde_json::Value,
    /// 去 frontmatter 后的正文
    pub raw_content: String,
    /// 文件 mtime（unix epoch），增量判定
    pub mtime: i64,
    pub content_hash: Option<String>,
}

/// 笔记元数据（轻量，不含正文/frontmatter）—— 文档库列表/树用。
/// 关键：不返回 raw_content，避免一次拉 1.9 万全文撑爆 IPC。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMeta {
    pub id: String,
    pub rel_path: String,
    pub file_name: String,
    pub title: Option<String>,
    pub note_type: Option<String>,
    pub date_iso: Option<String>,
    pub tags: Vec<String>,
    pub mtime: i64,
}

/// 单篇笔记内容（含渲染后的 HTML）—— 预览面板用，按需单篇加载。
#[derive(Debug, Clone, Serialize)]
pub struct NoteContent {
    pub id: String,
    pub rel_path: String,
    pub title: Option<String>,
    /// 去 frontmatter 后的原文（前端可切换"渲染/原文"视图）
    pub raw_content: String,
    /// pulldown-cmark 渲染后的 HTML（GFM 表格/任务列表/删除线已启用）
    pub html: String,
}

/// 搜索命中（FTS5）：轻量元数据 + 命中片段 + bm25 相关度。
/// 关键：不带 raw_content 全文，只带 snippet（性能红线）。
#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub id: String,
    pub rel_path: String,
    pub file_name: String,
    pub title: Option<String>,
    pub note_type: Option<String>,
    pub date_iso: Option<String>,
    pub tags: Vec<String>,
    /// FTS5 snippet（命中关键词用 <b> 高亮），取自 raw_content 列
    pub snippet: String,
    /// bm25 得分（越小越相关）
    pub rank: f64,
}

/// 反向链接：源笔记元数据 + 链接文本（「谁链接了本笔记」）
#[derive(Debug, Clone, Serialize)]
pub struct Backlink {
    pub source: NoteMeta,
    /// 在源笔记里写的 [[target_text]] 或 [[target_text|alias]]
    pub target_text: String,
    pub alias: Option<String>,
}

/// 图谱节点（双链可视化用）
#[derive(Debug, Clone, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub note_type: Option<String>,
}

/// 图谱边（source → target，已解析的正向 wikilink）
#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

/// 图谱数据：nodes + edges（按度数 top N 截断，防超大库卡前端）
#[derive(Debug, Clone, Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}
