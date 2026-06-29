# Requirements Document · 文档库（Obsidian 式浏览）

## Introduction

Helmose 后端已能全量索引 vault（~1.9 万 md），但 v0.1 前端没有任何页面展示这些笔记——侧边栏「日志/项目」是占位符，今日聚焦只显示统计数字。本功能填补这一基础缺口：提供一个 **Obsidian 式文档库**，让用户能浏览 vault 中**所有** md 文档（目录树 + 文件列表 + markdown 预览）。

价值：让"已索引的知识"真正可见、可查、可读，这是"人生知识库"得以成立的前提，也是后续 AI 教练/Agent 接口的可视化基础。

## Alignment with Product Vision

- 支撑 product.md「Obsidian 式 vault 接入」+「文档库」核心功能。
- 落实「vault 是唯一真相源」——浏览只读 SQLite 派生缓存，不碰 vault 原文。
- 落实「与 Obsidian 共存」——目录树按 vault 真实结构展示，排除规则与索引一致。

## Requirements

### Requirement 1：目录树浏览

**User Story:** 作为 vault 拥有者，我想以目录树看到 vault 的完整文件夹结构，以便像 Obsidian 一样按目录导航我的知识库。

#### Acceptance Criteria
1. WHEN 用户进入文档库 THEN 系统 SHALL 展示以 vault 根为根的目录树。
2. WHEN 目录树加载 THEN 系统 SHALL 排除隐藏目录（`.` 开头）与备份大目录（`6-原始资料`、`专家团`），与索引排除规则一致。
3. WHEN 用户点击目录节点 THEN 系统 SHALL 选中该目录并加载其文件列表。
4. WHEN 用户展开/折叠节点 THEN 系统 SHALL 保持用户操作的展开状态。

### Requirement 2：文件列表

**User Story:** 作为用户，我想看到某目录下的 md 文件列表（标题/日期/类型），以便快速找到要看的文档。

#### Acceptance Criteria
1. WHEN 选中某目录 THEN 系统 SHALL 展示该目录的**直接子** md 文件（不含子目录内文件）。
2. WHEN 列表项展示 THEN 系统 SHALL 显示标题（无标题时降级用文件名）、日期、note_type 标签。
3. WHEN 目录无 md 文件 THEN 系统 SHALL 显示空状态提示。
4. IF 用户输入搜索关键词 THEN 系统 SHALL 在当前目录列表内按标题/路径/标签过滤。

### Requirement 3：单篇预览

**User Story:** 作为用户，我想点开一篇文档看到渲染后的内容，以便直接阅读而不必切换到 Obsidian。

#### Acceptance Criteria
1. WHEN 用户点击列表项 THEN 系统 SHALL 在预览区加载该笔记并渲染 markdown 为 HTML。
2. WHEN 渲染 markdown THEN 系统 SHALL 支持 GFM 表格、任务列表（checkbox）、删除线。
3. WHEN 预览区显示 THEN 系统 SHALL 展示文档标题与相对路径。
4. WHEN 未选中任何文档 THEN 系统 SHALL 显示"选择一篇文档"提示。

### Requirement 4：性能与安全（非功能性，强制）

#### Acceptance Criteria
1. WHEN 加载目录树/文件列表 THEN 系统 SHALL **不返回**笔记正文 `raw_content`，只返回元数据（`NoteMeta`）。
2. WHEN 预览单篇文档 THEN 系统 SHALL 单独按 note_id 取该篇全文，不复用全量查询。
3. WHEN 任何浏览操作发生 THEN 系统 SHALL 不修改 vault 中的任何 md 原文（纯只读）。

## Non-Functional Requirements

### Code Architecture and Modularity
- **单一职责**：`commands/library.rs` 只负责文档库的三个命令；`LibraryPage.tsx` 只负责三栏 UI。
- **复用**：排除规则与 `index.rs` 一致；查询复用 `SqliteDatabase`；DTO 复用 `models`。
- **清晰边界**：列表/树用 `NoteMeta`（无正文），单篇用 `NoteContent`（含 HTML），职责分离。

### Performance
- 目录树（`list_dirs`）：只扫目录，目录数远少于文件数。
- 文件列表（`list_notes_meta`）：按目录前缀 SQL 过滤 + Rust 直接子判定，limit 默认 5000。
- 单篇预览（`get_note_content`）：单行查询 + Rust pulldown-cmark 渲染。
- 全程不传输 1.9 万 × 全文。

### Security
- markdown HTML 由 Rust `pulldown-cmark` 渲染，默认转义 raw HTML，XSS 风险低（内容来自用户自有 vault）。
- 纯只读：不写 vault、不写库。

### Reliability
- 所有命令返回 `Result<T, String>`，错误 `.map_err(|e| e.to_string())` 传给前端兜底。
- 前端每个异步加载都有 loading + 空状态 + catch 兜底。

### Usability
- 三栏布局（树/列表/预览）符合 Obsidian 心智模型。
- 默认展开根 + 顶层目录，首次进入即可见结构。
- 列表项点击高亮，预览即时切换。
