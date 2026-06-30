# Helmose · 项目协作指令（CLAUDE.md）

> AI 协作时必读。Helmose = AI 驱动的人生知识库桌面应用（Tauri v2 + Rust + React）。

## 一句话定位

**人读 + Agent 读双导向**的本地人生数据底座。直接读写 Obsidian 式 markdown vault，内置 AI 当教练/秘书/第二大脑，并产出机器可读状态给外部智能体。

## 技术栈速览

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri v2（Rust 后端 + React 前端） |
| 后端 | Rust（edition 2021）：rusqlite 0.32 / walkdir 2.5 / pulldown-cmark 0.11 / gray_matter / notify |
| 前端 | React 19 + TypeScript 5.9 + Vite 7 + antd 6 + Zustand 5 + react-router-dom 7 |
| 数据 | 本地 markdown（vault，真相源）+ SQLite（`<app_data_dir>/helmose.db`，派生缓存） |

详细见 `.spec-workflow/steering/tech.md`。

## 开发与验证命令（客观裁判）

```bash
# 前端依赖（pnpm；本机 npm 损坏、install 不建 .bin，统一用 pnpm）
cd frontend && pnpm install

# 开发（前端 + Tauri 后端）
cd frontend && npm run tauri:dev

# 仅前端（浏览器，无 Rust 后端）
cd frontend && npm run dev

# —— 验证（客观裁判，改完代码必跑）——
cd src-tauri && cargo check          # Rust 类型 + 借用检查
cd src-tauri && cargo test           # Rust 单测（含真实 vault smoke test）
cd frontend && npm run build         # = tsc -b && vite build（前端类型 + 构建）
```

全量 Tauri 构建（产安装包）：`cd frontend && npm run tauri:build`。

## 架构铁律（不可违反）

1. **vault 是唯一真相源**。SQLite 是派生缓存——删库可从 vault 全量重建。永远不要把 SQLite 当主存。
2. **vault 原文只读**。索引/查询/浏览一律只读 md 文件；任何写 vault（编辑、Agent inbox 写回）必须有用户明确动作 + 保护机制。**绝不在用户没要求时改动 vault 原文**。
3. **IPC 边界**：Tauri v2 自动转参数名 `camelCase ↔ snake_case`；**返回值 JSON 字段保持 snake_case**（Rust serde 默认），前端 TS 接口必须对齐（如 `rel_path`、`note_type`、`last_indexed`）。
4. **分层解析**：`services/indexer/layers.rs` 按路径前缀判 L1/L2/L3 + note_type。新增 vault 目录结构时同步更新前缀映射，否则文档会被归到默认层且 `note_type=null`。
5. **排除目录一致性**：`commands/index.rs` 与 `commands/library.rs` 的 `EXCLUDE_DIRS`（`6-原始资料`、`专家团`、隐藏目录）必须保持一致，否则"索引视图"与"浏览视图"不符。

## 性能红线（硬约束）

vault 规模约 **1.9 万 md 文件**。以下规则必须遵守：

- ❌ **禁止**任何命令一次性返回所有笔记的 `raw_content`（全文）。1.9 万 × 全文 = IPC/内存必爆。
- ✅ 列表/树只返回**元数据**（`NoteMeta`，无正文）；单篇预览才取全文（`get_note_content`）。
- ✅ 目录树用 `list_dirs`（只扫目录，轻）；文件列表按目录懒加载（`list_notes_meta(dir_prefix)`）。
- 新增查询命令时，先想"会不会一次拉太多"，必要时分页/懒加载/去正文。

## 编码规范

- **注释一律中文**（与现有代码库一致）。
- Rust 命令：`#[tauri::command] fn xxx(...) -> Result<T, String>`，错误统一 `.map_err(|e| e.to_string())?`。
- Rust 模块经 `mod.rs` 暴露；跨模块用 `crate::` 绝对路径。
- React 页面：hooks → 早返回 → JSX；类型集中 `types/index.ts`；API 集中 `api/index.ts`。
- 改代码前**先读后写**，理解现有约定再动手（如 `SqliteDatabase::query_map` 返回 `Vec`、`query_row` 返回 `Option`）。
- 不添加用户没要求的功能/重构/改进。

## 新增 Tauri 命令的标准流程

1. `models/` 加/改 DTO（`#[derive(Serialize)]`，字段 snake_case）。
2. `commands/<领域>.rs` 写 `#[tauri::command]`，`State<'_, Database>` 取库。
3. `commands/mod.rs` 加 `pub mod <领域>;`。
4. `main.rs` 的 `invoke_handler!` 注册命令。
5. `frontend/src/types/index.ts` 加对齐类型；`api/index.ts` 加 `invoke` 封装。
6. 跑 `cargo check` + `npm run build` 全绿。

## 已知后续项（ backlog）

- wikilink `[[x]]` 可点跳转（当前文档库预览按字面文本显示）。
- 全库搜索 UI（`notes_fts` FTS5 表已就绪，未暴露命令）。
- 基于 `notify` 的增量索引（依赖已就绪，当前为全量）。
- Agent 状态接口：`LIFE-STATE.md` / `state.json` 导出 + inbox 写回。
- AI 教练层（v0.2）：主线判定、每日建议、明日一句。

## 工作区状态

- 当前**未初始化 git**。如需版本管理，先与用户确认再 `git init`。
- 默认 vault 候选 `~/wiki`（作者真实 vault，1.9 万 md）；smoke test 可用 `HELMOSE_TEST_VAULT` 环境变量指定路径。
