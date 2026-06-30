# Technology Stack

## Project Type

**桌面应用**（Tauri v2）：Rust 后端 + React 前端，编译为原生桌面程序。本地优先，无服务端。

## Core Technologies

### Primary Language(s)
- **Rust**（edition 2021）：后端——vault 扫描/索引/解析/SQLite/文件监听，以及 Tauri 命令层。
- **TypeScript ~5.9**：前端 UI 与状态。

### Key Dependencies/Libraries

**Rust（`src-tauri/Cargo.toml`）**
- `tauri` 2.0：桌面框架（shell/dialog/fs/opener 插件）。
- `rusqlite` 0.32（`bundled`）：SQLite 索引库，单连接 + Mutex + WAL。
- `walkdir` 2.5：vault 目录遍历。
- `pulldown-cmark` 0.11（`default-features=false, features=["html"]`）：markdown → HTML 渲染（文档库预览）。
- `gray_matter` 0.2：frontmatter 解析。
- `notify` 6 / `notify-debouncer-mini` 0.4：vault 文件监听，**增量索引已启用**（`watcher.rs` + `incremental.rs` + `start_watcher` 命令）。
- `sha2` 0.10：笔记正文 sha256 `content_hash`（增量判定 + 唯一性键）。
- `once_cell` / `parking_lot` 0.12 / `crossbeam-channel` 0.5：全局状态 / 锁 / watcher 通道。
- `anyhow` 1 / `thiserror` 1 / `tracing` 0.1 + `tracing-subscriber` 0.3：错误处理与日志。
- `regex` 1 / `chrono` 0.4 / `uuid` 1.0：工具库。
- `serde` / `serde_json`：IPC 序列化。

**前端（`frontend/package.json`，包管理用 `pnpm` 11）**
- `react` 19.2 + `react-dom` 19.2。
- `antd` 6.1 + `@ant-design/icons` 6.1：UI 组件库。
- `@uiw/react-codemirror` + `@codemirror/lang-markdown`：笔记编辑器（CodeMirror，编辑写回 vault）。
- `marked`：markdown → HTML 前端渲染（与后端 `pulldown-cmark` 并存）。
- `react-router-dom` 7.1：路由库（依赖保留；当前主界面为 tab 工作台，非路由切换）。
- `zustand` 5.0：状态管理（`stores/vault`、`stores/tabs`）。
- `dayjs` 1.11：日期。
- `vite` 7.2 + `@vitejs/plugin-react` 5.1：构建。
- `vitest` 4 + `@vitest/coverage-v8`：单测 + 覆盖率。
- `@tauri-apps/api` 2.9 + 插件：IPC。

### Application Architecture

四层（见 `structure.md`）：

```
UI 层（React + antd）
  → Tauri 命令层（Rust #[tauri::command]，IPC 边界）
    → Vault 数据层（Rust：walkdir 扫描 / 契约驱动分层解析 / SQLite 索引 / notify 增量）
      → Agent 接口层（已实现：export_life_state 写 app_data_dir/agent/{LIFE-STATE.md, state.json}；inbox 写回规划中）
```

IPC 边界约定：Tauri v2 自动做参数名 `camelCase ↔ snake_case` 转换；**返回值 JSON 字段保持 snake_case**（Rust serde 默认），前端 TS 接口须对齐。

### Data Storage
- **唯一真相源**：本地 markdown 文件（vault，如 `~/wiki`），与 Obsidian 共存。
- **派生缓存**：SQLite（`<app_data_dir>/helmose.db`），存 vaults / notes / tasks / events / projects / okrs / entities / links / tomorrow_sentences / life_state_snapshots，外加 `notes_fts`（FTS5 trigram，已由 `search_notes` 命令暴露给前端）。WAL 模式 + busy_timeout 5000ms。
- **可重建**：删库后重新 `index_vault` 即可全量恢复。

### External Integrations
- **AI（规划 v0.2）**：主线判定 / 每日建议 / 明日一句；当前版本不含 LLM 调用。
- **外部智能体**：通过 `LIFE-STATE.md` / `state.json` 文件接口（`export_life_state` 已实现导出至 `app_data_dir/agent/`）；inbox 写回带保护（规划中）。

## Development Environment

### Build & Development Tools
- **Rust**：`cargo`（在 `src-tauri/`）。
- **前端**：`pnpm`（在 `frontend/`，`packageManager` 锁定 pnpm@11；本机 npm 损坏统一用 pnpm）。
- **开发**：`cd frontend && npm run tauri:dev`（实际 `cd ../src-tauri && cargo run`，Tauri 自动挂载 vite dev server）。
- **仅前端**：`npm run dev`（浏览器调试，无 Rust 后端）。

### Code Quality Tools
- **Rust**：`cargo check`（类型 + 借用）、`cargo test`（含 `index_real_wiki_smoke` 真实 vault smoke test，标 `#[ignore]`，可用 `HELMOSE_TEST_VAULT` 指定路径）、`cargo clippy`。
- **前端**：`pnpm build` = `tsc -b && vite build`（类型检查 + 构建，前端客观裁判）、`pnpm test`（vitest 单测）、`pnpm test:coverage`（lcov 覆盖率）。
- **CI**：`.github/workflows/ci.yml` 在 PR / 推 main 时跑 backend（cargo check + test）、frontend（pnpm build + test）、coverage（仅产出 lcov artifact，非阻断）。
- 无独立 lint 配置文件；TypeScript strict 由 `tsconfig.json` 约束。

### Version Control & Collaboration
- Git（已 `git init`，主分支 `main`）；CI 由 `.github/workflows/ci.yml` 驱动。
- 分支策略 trunk-based（单 `main`）。

## Deployment & Distribution
- **目标平台**：macOS / Windows / Linux 桌面。
- **分发**：`npm run tauri:build` 产出各平台原生安装包。
- **更新**：Tauri updater（待接入）。

## Technical Requirements & Constraints

### Performance Requirements（硬约束，见 CLAUDE.md「性能红线」）
- vault 规模 ~1.9 万 md；**禁止**任何命令一次性返回所有笔记的 `raw_content` 全文（会撑爆 IPC/内存）。
- 列表/树只返回元数据（`NoteMeta`，无正文）；单篇预览才取全文（`get_note_content`）。
- 全量索引目标 < 10s；目录列表 < 200ms。

### Compatibility Requirements
- Tauri v2（非 v1，命令/插件 API 不同）。
- React 19（需注意 antd 6 / 第三方库的 React 19 兼容性）。
- 与 Obsidian 共存：保留 `.obsidian/` 等隐藏目录不索引、不破坏。

### Security & Compliance
- **原文不可破坏**：索引/查询全只读；任何写 vault 的功能（编辑、inbox 写回）须用户明确动作 + 保护机制。
- `dangerouslySetInnerHTML`（文档库预览）所用 HTML 由 Rust `pulldown-cmark` 渲染，默认转义 raw HTML，XSS 风险低（内容来自用户自有 vault）。
- 数据本地化：无云端，数据主权完全在用户。

## Technical Decisions & Rationale

### Decision Log
1. **Tauri 而非 Electron**：Rust 后端直接处理文件/SQLite，性能与内存远优于 Electron；与 Rust 生态（rusqlite/walkdir/notify）天然契合。
2. **SQLite 作为派生缓存而非主存**：vault markdown 是真相源，SQLite 只加速查询；删库可重建，零数据丢失风险。
3. **分层解析（L1/L2/L3）**：wiki 数据结构化程度不一（高结构业务/半结构学习/零结构日志），单一解析器硬套会丢信息；按路径前缀分派不同解析策略。
4. **markdown 渲染放 Rust 端（pulldown-cmark）而非前端 JS 库**：复用既有 Rust 依赖、零前端新增包、后端渲染性能好、默认安全转义。
5. **`pulldown-cmark` 启用 `html` feature**：`default-features=false` 会关掉 `html` 模块，必须显式 `features=["html"]` 才能用 `pulldown_cmark::html`。
6. **契约取代 `layers.rs` 硬编码**：旧 `layers.rs` 用编号前缀（0-日志/1-我/…）判层级，目录重构即失效。现改为 `services/contract/mod.rs` 内置 ~/wiki/规范.md 契约（顶层目录 + 11 种 type + type→dir 映射），`infer_note_type` / `infer_layer` 纯函数驱动，indexer 与 scaffold 共用同一真相源。
7. **排除目录收口到 `utils/exclude.rs`**：原本 `index.rs` / `library.rs` 各持一份 `EXCLUDE_DIRS` 易漂移；现统一为单一契约点，三处调用方共用 `is_excluded_*`。
8. **`content_hash`(sha256) 作增量判定键**：正文 sha256 入库，watcher 触发时按 hash 跳过未变文件，避免全量重算；同时作 notes 唯一性辅助键。

## Known Limitations
- **wikilink `[[x]]` 暂按字面文本显示**：文档库预览未做 wikilink 预处理，不能点击跳转（列入后续）。
- **目录树无虚拟滚动**：极深/极多目录时渲染可能变慢（当前 vault 目录规模可接受）。
- **AI 教练层未接（v0.2）**：当前版本无 LLM 调用；`export_life_state` 已能产出机器可读 `state.json`，但主线判定 / 每日建议尚待 v0.2 接入。
- **Agent inbox 写回未实现**：状态导出已落地，外部智能体产出的写回审核流待做。
