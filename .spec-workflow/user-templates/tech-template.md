# Technology Stack · {{projectName}}

> 本模板为 Helmose 项目定制版（覆盖 `templates/tech-template.md`）。
> 这是 steering 文档，定义技术栈与约束，是 spec 写作的对齐基准。

## Project Type

**桌面应用**（Tauri v2：Rust 后端 + React 前端）。本地优先，数据主权在用户。

## Core Technologies

### Primary Language(s)
- **Rust**（edition 2021）：后端 / 索引 / 契约 / IPC 命令。
- **TypeScript 5.x**：前端。

### Key Dependencies/Libraries
- **Rust**：`rusqlite`（SQLite 派生缓存）/ `walkdir`（vault 扫描）/ `pulldown-cmark`（markdown→html，启用 `html` feature）/ `gray_matter`（frontmatter）/ `notify`（增量监听）/ `sha2`（content hash）/ `tauri` v2 + `tauri-plugin-updater`。
- **前端**：React 19 + Vite 7 + antd 6 + Zustand 5 + react-router-dom 7 + CodeMirror（编辑写回）。

### Application Architecture
**4 层**：UI（React+antd）→ 内置 AI 层（规划中）→ Vault 数据层（Rust：onboarding / notify 增量 / 契约驱动分层解析 / SQLite 索引）→ Agent 接口层（状态导出）。

Helmose 分层铁律：`commands`(IPC) ↔ `services`(解析/契约/indexer) ↔ `models`(DTO)。`indexer` 纯解析不写库，写库在 `commands` 层。

### Data Storage
- **Primary storage**：本地 markdown vault（**唯一真相源**，Obsidian 式）。
- **Caching**：SQLite `<app_data_dir>/helmose.db`（**派生缓存**，删库可从 vault 重建）。
- **Data formats**：markdown + YAML frontmatter；IPC 用 JSON（字段 snake_case）。

### External Integrations
- **Agent 接口**：`export_life_state` 写 `app_data_dir/agent/{LIFE-STATE.md, state.json}`，供外部智能体（Hermes/Codex/OpenClaw）定时读取。
- **更新**：`tauri-plugin-updater`（pubkey/endpoints 发布时配真实值）。

## Development Environment

### Build & Development Tools
- **Build System**：cargo（Rust）+ Vite（前端）+ Tauri v2 打包。
- **Package Management**：**pnpm**（本机 npm 损坏、install 不建 .bin，统一用 pnpm）；Rust 用 cargo。
- **Development workflow**：`cd frontend && npm run tauri:dev`（前端 + Tauri 后端热重载）。

### Code Quality Tools
- **Rust**：`cargo check`（类型 + 借用检查）/ `cargo test`（单测 + 真实 vault smoke test）。
- **前端**：`tsc -b`（类型）/ `vite build`（构建）/ `vitest`（单测）。
- **CI**：`.github/workflows/ci.yml`（backend cargo check+test、frontend pnpm build+test）。

### Version Control & Collaboration
- **VCS**：Git，主分支 `main`。
- **用户没主动要求，绝不执行 commit/push/branch。**

## Deployment & Distribution
- **Target Platform(s)**：macOS / Windows / Linux 桌面。
- **Distribution Method**：`npm run tauri:build` 产各平台安装包（dmg/msi/AppImage）。
- **Update Mechanism**：`tauri-plugin-updater`（M5 占位，发布时配 endpoint/pubkey）。

## Technical Requirements & Constraints

### Performance Requirements（硬红线）
- vault 规模 ~**1.9 万 md**。
- ❌ 禁止任何命令一次性返回所有笔记 `raw_content`（全文）。
- ✅ 列表/树只回 `NoteMeta`（元数据，无正文）；单篇预览才取全文。
- ✅ `search_notes`（FTS5 snippet，无全文）、`list_dirs`（只扫目录）同样遵守。

### Compatibility Requirements
- 现有 vault（作者 `~/wiki`，1.9 万 md，00~09 新体系）MUST 无缝索引，不要求用户重组文件。

### Security & Compliance
- **vault 原文默认只读**（铁律）。写 vault MUST「备份 `.helmose/backup/` + 用户授权」。
- 路径防穿越（`create_note` / `save_note_content` 校验路径不逃逸 vault 根）。

## Technical Decisions & Rationale

### Decision Log
1. **Tauri v2 而非 Electron**：[Rust 后端原生性能 + 小体积；rusqlite 直接操作 SQLite]。
2. **vault 为真相源 + SQLite 派生缓存**：[数据主权 + 可重建 + Obsidian 共存]。
3. **契约驱动分层解析**：[`services/contract/` 内置规范.md 契约，取代硬编码前缀]。

## Known Limitations
- [AI 教练层未接入（v0.2）]。
- [Agent inbox 写回未做（状态导出已做）]。
- [updater endpoint/pubkey 占位（发布时配）]。
