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
- `notify` 6 / `notify-debouncer-mini` 0.4：vault 文件监听（增量索引预留）。
- `regex` 1 / `chrono` 0.4 / `uuid` 1.0：工具库。
- `serde` / `serde_json`：IPC 序列化。

**前端（`frontend/package.json`）**
- `react` 19.2 + `react-dom` 19.2。
- `antd` 6.1 + `@ant-design/icons` 6.1：UI 组件库。
- `react-router-dom` 7.1：路由。
- `zustand` 5.0：状态管理。
- `dayjs` 1.11：日期。
- `vite` 7.2 + `@vitejs/plugin-react` 5.1：构建。
- `@tauri-apps/api` 2.9 + 插件：IPC。

### Application Architecture

四层（见 `structure.md`）：

```
UI 层（React + antd）
  → Tauri 命令层（Rust #[tauri::command]，IPC 边界）
    → Vault 数据层（Rust：walkdir 扫描 / 分层解析 / SQLite 索引）
      → Agent 接口层（规划：LIFE-STATE.md + state.json 导出）
```

IPC 边界约定：Tauri v2 自动做参数名 `camelCase ↔ snake_case` 转换；**返回值 JSON 字段保持 snake_case**（Rust serde 默认），前端 TS 接口须对齐。

### Data Storage
- **唯一真相源**：本地 markdown 文件（vault，如 `~/wiki`），与 Obsidian 共存。
- **派生缓存**：SQLite（`<app_data_dir>/helmose.db`），存 vaults / notes / tasks / events / projects / okrs / entities / links / tomorrow_sentences / life_state_snapshots，外加 `notes_fts`（FTS5 trigram）。WAL 模式 + busy_timeout 5000ms。
- **可重建**：删库后重新 `index_vault` 即可全量恢复。

### External Integrations
- **AI（规划）**：DeepSeek-V4-Pro（主）/ GLM-5.2（备），provider 层移植自 claude-to-im。
- **外部智能体**：通过 `LIFE-STATE.md` / `state.json` 文件接口（读）+ inbox（写回，带保护）。

## Development Environment

### Build & Development Tools
- **Rust**：`cargo`（在 `src-tauri/`）。
- **前端**：`npm`（在 `frontend/`）。
- **开发**：`cd frontend && npm run tauri:dev`（实际 `cd ../src-tauri && cargo run`，Tauri 自动挂载 vite dev server）。
- **仅前端**：`npm run dev`（浏览器调试，无 Rust 后端）。

### Code Quality Tools
- **Rust**：`cargo check`（类型 + 借用）、`cargo test`（含 `index_real_wiki_smoke` 真实 vault smoke test，可用 `HELMOSE_TEST_VAULT` 指定路径）、`cargo clippy`。
- **前端**：`npm run build` = `tsc -b && vite build`（类型检查 + 构建，作为前端客观裁判）。
- 无独立 lint 配置文件；TypeScript strict 由 `tsconfig.json` 约束。

### Version Control & Collaboration
- Git（当前工作区尚未初始化 git；规范建议尽快 `git init`）。
- 分支策略未定，建议 trunk-based。

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

## Known Limitations
- **wikilink `[[x]]` 暂按字面文本显示**：文档库预览未做 wikilink 预处理，不能点击跳转（列入后续）。
- **目录树无虚拟滚动**：极深/极多目录时渲染可能变慢（当前 vault 目录规模可接受）。
- **全库搜索未接入 UI**：`notes_fts` 表已就绪但未暴露命令。
- **增量索引未启用**：当前为全量 `index_vault`；`notify` 依赖已就绪，待接增量。
- **无 git 仓库**：当前工作区未 `git init`。
