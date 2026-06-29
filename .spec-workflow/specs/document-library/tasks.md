# Tasks Document · 文档库（Obsidian 式浏览）

> 状态：**全部已交付**（`[x]`）。客观裁判 `cargo check` + `npm run build` 全绿。

- [x] 1. 新增轻量 DTO：`NoteMeta` / `NoteContent`
  - File: `src-tauri/src/models/note.rs`
  - 在 `Note` 之后追加 `NoteMeta`（无 raw_content/frontmatter）与 `NoteContent`（含 raw_content + html）
  - Purpose: 列表/树用轻量结构，避免一次拉全文（性能红线）
  - _Leverage: `src-tauri/src/models/note.rs::Note`（同文件风格）_
  - _Requirements: 4.1_

- [x] 2. 在 `models/mod.rs` 导出新 DTO
  - File: `src-tauri/src/models/mod.rs`
  - `pub use note::{Note, NoteContent, NoteMeta};`
  - Purpose: 供命令层引用
  - _Requirements: 1, 2, 3_

- [x] 3. 实现 `commands/library.rs`（三个命令 + 渲染）
  - File: `src-tauri/src/commands/library.rs`
  - `list_dirs`：walkdir 扫目录（排除规则同 index.rs），返回扁平相对路径
  - `list_notes_meta`：按 `dir_prefix` SQL 过滤 + Rust 直接子判定，返回 `NoteMeta`
  - `get_note_content`：单篇 `raw_content` + `render_markdown`（pulldown-cmark GFM）
  - 内部 `is_excluded` / `vault_root` 复刻 index.rs
  - Purpose: 文档库后端能力
  - _Leverage: `commands/index.rs::is_excluded`、`services/database_sqlite.rs::query_map/query_row`、`walkdir`、`pulldown-cmark`_
  - _Requirements: 1.1, 1.2, 2.1, 3.1, 3.2, 4.1, 4.2_

- [x] 4. 启用 `pulldown-cmark` 的 `html` feature
  - File: `src-tauri/Cargo.toml`
  - 改为 `pulldown-cmark = { version = "0.11", default-features = false, features = ["html"] }`
  - Purpose: `default-features=false` 会关掉 `html` 模块，`render_markdown` 需要它
  - _Requirements: 3.2_

- [x] 5. 注册模块与命令
  - File: `src-tauri/src/commands/mod.rs`（加 `pub mod library;`）、`src-tauri/src/main.rs`（invoke_handler 加三个命令）
  - Purpose: 暴露给前端 invoke
  - _Leverage: 现有注册风格_
  - _Requirements: 1, 2, 3_

- [x] 6. 前端类型与 API 封装
  - File: `frontend/src/types/index.ts`（加 `NoteMeta` / `NoteContent`）、`frontend/src/api/index.ts`（加 `listDirs` / `listNotesMeta` / `getNoteContent`）
  - snake_case 字段对齐 Rust serde
  - Purpose: 前端类型安全 + IPC 封装
  - _Leverage: 现有 `api/index.ts::getNotes` 封装模式_
  - _Requirements: 1, 2, 3_

- [x] 7. 实现 `LibraryPage.tsx`（三栏）
  - File: `frontend/src/pages/LibraryPage.tsx`
  - 左：antd `Tree`（`buildTree` 由扁平路径构建，根=「⚓ 全部文档」，默认展开根+顶层）
  - 中：`Input.Search` + `List`（标题/日期/note_type 标签，前端过滤）
  - 右：预览（`getNoteContent` → `dangerouslySetInnerHTML`，`.md-preview` 样式）
  - 三个 `useEffect` 分别驱动 树/列表/预览 懒加载，各自 loading + catch 兜底
  - Purpose: 文档浏览出口（修复"看不到所有文档"）
  - _Leverage: `useVaultStore`、antd 组件、`api`_
  - _Requirements: 1.1, 1.3, 1.4, 2.1–2.4, 3.1, 3.3, 3.4, 4.3_

- [x] 8. 接入菜单与路由
  - File: `frontend/src/App.tsx`
  - 菜单加「文档库」（`FolderOpenOutlined`，置顶）、路由加 `/library`、import `LibraryPage`
  - Purpose: 用户可进入文档库
  - _Leverage: 现有 `menuItems` + `Routes`_
  - _Requirements: 1.1_

- [x] 9. markdown 预览样式
  - File: `frontend/src/index.css`
  - 追加 `.md-preview` 样式（h1-h4 / 列表 / 引用 / code / 表格 / 任务 checkbox / 链接）
  - Purpose: 预览区排版可读
  - _Requirements: 3.2_

- [x] 10. 客观裁判全绿
  - `cd src-tauri && cargo check`：0 error（8 warning 均为项目原有死代码，非本次引入）
  - `cd frontend && npm run build`：tsc -b + vite build 通过（4828 模块）
  - Purpose: 验证代码正确性
  - _Requirements: 全部_

## 后续优化（backlog，未在本期范围）
- [x] wikilink `[[x]]` 在 `render_markdown` 预处理为可点链接（v0.2 已交付，含代码块跳过）
- [x] 全库搜索（暴露 `notes_fts` FTS5 命令 + 搜索 UI）（v0.2 已交付，trigram 中文 + snippet 高亮 + bm25）
- [ ] 目录树/文件列表虚拟滚动（应对超大目录）
- [x] `render_markdown` / `incremental` 逻辑的单元测试（v0.2 已补）

---

# v0.2 · Obsidian-first 交付（2026-06-30）

> 方向调整：用户要求「先以 Obsidian 为基础，像它一样，再加其他」。
> 本期把文档库从只读预览升级为 Obsidian 式可读写 + 双链 + 搜索 + 实时同步。
> 客观裁判全绿：`cargo check`（7 warning 均为原有死代码）+ `cargo test`（18 passed）+ `npm run build`（4832 模块）。

## 已交付（10 项）

- [x] 全库搜索（FTS5 trigram，中文短语 + snippet 高亮 + bm25 排序）
  - 修复：index_vault 末尾 `INSERT INTO notes_fts(notes_fts) VALUES('rebuild')`——contentless FTS 从未同步的历史问题
  - Files: `commands/search.rs`、`models/note.rs::SearchResult`、`LibraryPage.tsx` 搜索框
- [x] wikilink `[[x]]` 双链正向跳转（render_markdown 预处理，跳过 fenced code）
  - Files: `commands/library.rs::render_wikilinks`、`LibraryPage.tsx::onPreviewClick`
- [x] 增量索引（notify 文件监听，单文件 upsert/remove + FTS 单行同步）
  - Files: `services/indexer/incremental.rs`、`services/watcher.rs`、`commands/index.rs::start_watcher`
- [x] 笔记编辑（写回 vault + 自动备份到 `.helmose/backup/` + 增量重索引）
  - 用户明确授权写 vault；写前备份保护原文。`commands/library.rs::save_note_content`
- [x] 反向链接面板（links 表反向查询，预览区显示「谁链接了它」）
  - `commands/library.rs::get_backlinks`、`models/note.rs::Backlink`
- [x] 命令面板 Ctrl/Cmd+P（复用 FTS 搜索，模糊跳转笔记）
  - `App.tsx::CommandPalette`
- [x] 标签侧栏（tags 聚合计数，点击复用 FTS 搜 tags 列）
  - `commands/notes.rs::get_tags_stats`、`LibraryPage.tsx` 左栏
- [x] 图谱视图（自绘 canvas 力导向，按度数 top 600 截断，点击节点跳转）
  - `commands/library.rs::get_graph_data`、`pages/GraphPage.tsx`、`components/ForceGraph.tsx`
- [x] 任务页 TasksPage（未完成/已完成 Tab + 按到期分组 + Drawer 看源笔记）—— 保留
- [x] Agent 状态导出（LIFE-STATE.md + state.json → app_data_dir/agent，不碰 vault）—— 保留

## 未做（用户后置）
- AI 教练层 v0.2（主线判定/每日建议）—— 需单独 spec
- 目录树/列表虚拟滚动（超大目录性能）
- projects/okrs/events 表的索引器填充（当前空表，Agent 导出已优雅降级）
