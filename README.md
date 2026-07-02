# Helmose · 人生操作系统

> helm（舵手）—— AI 替你掌舵人生主线。

[![CI](https://github.com/PNGTRID/helmose/actions/workflows/ci.yml/badge.svg)](https://github.com/PNGTRID/helmose/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![Tauri](https://img.shields.io/badge/Tauri-v2-orange.svg)](https://tauri.app)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](#-开发)

**Helmose** 是一个 AI 驱动的本地人生知识库桌面应用：把任务 / 日志 / 项目 / 笔记整理成**人和智能体都能消费**的清晰结构，内置 AI 扮演**教练 + 秘书 + 第二大脑**，并开放标准化状态接口给外部智能体（Hermes / Codex / OpenClaw 等）。

- 🏠 **纯本地**：直接读写 Obsidian 式 markdown vault，数据主权 100% 在你。
- 🤖 **双导向**：每个数据结构都问"AI 能不能消费"，同时产出人读 + 机读状态。
- 🛡 **零破坏**：除你明确的编辑动作外，索引 / 查询 / 浏览全只读，写前自动备份。

---

## 📍 产品定位

**人读 + Agent 读双导向**的人生数据底座。

市面笔记软件只面向「人读」，AI 与外部智能体无法高效消费其中的结构化信息。Helmose 在保留本地 markdown vault 的同时，把散落的任务 / 日志 / 项目 / 笔记整理成机器可读的清晰结构，并产出标准化状态文件（`LIFE-STATE.md` / `state.json`），让外部智能体定时读取后即可：

- 判断此刻该聚焦哪条**主线 / 副线**（教练）
- 每天告诉你**该做什么**（秘书）
- 完整还原**你是谁、做过什么**（第二大脑）

---

## ✨ 核心特性

### 🗂 本地知识底座
- 直接读写本地 markdown 文件夹（与 Obsidian 共存，不破坏原文）。
- **契约驱动分层索引**：按 `规范.md` 契约把 vault 全量 md 解析成结构化数据（10 个顶层目录 + 12 种 type + type→dir 映射），写入 SQLite 派生缓存。
- `notify` 文件监听 + `content_hash`(sha256) **增量索引**——文件改动秒级同步，移动 / 重命名 id 不变。
- **全库搜索**：FTS5 trigram + snippet 高亮，⌘/Ctrl+P 命令面板触发。
- **虚拟列表**：1.9 万节点文件树流畅滚动（antd Tree virtual + ResizeObserver 测高）。

### 📝 Obsidian 式工作台
- Ribbon + 可拖拽文件树 + 标签页 + 底栏，熟悉的 Obsidian 外壳。
- markdown 预览：wikilink `[[x]]` 可点跳转、大纲、代码高亮。
- **TipTap WYSIWYG 富文本编辑**（替换 CodeMirror）：所见即所得，标题 / 粗体 / 列表 / 任务复选框 / 表格 / 链接，对外仍是 markdown 字符串，全链路零改动。
- **反向链接 / 前向链接**面板 + **关系图谱**（d3-force）。

### ✅ 任务与计划
- 任务多视图：**看板 / 列表 / 矩阵（四象限）/ 时间线**。
- **今日计划页 PlannerPage**：收集箱 + 分类（软方案）+ 迷你日历 + 四象限拖拽写回 + 详情面板。
- **任务标记文字化**（Postel 法则：读宽容、写规范）——读侧三格式全兼容（Helmose 老 emoji / Obsidian Tasks 标准 / Helmose 文字），写侧默认 Helmose 文字契约，**双模式开关**可切 Obsidian 双端互通。
- **到期提醒**：扫 `due_date` 幂等生成 reminders + 桌面通知（截止前一天 9:00）。
- `due_date` 多标记解析：`📅` / `due:` / `截止:` / `deadline`。

### 🎯 项目与目标
- **项目深度结构化**：priority / is_mainline / top-3 兜底排序 / okr_priority / last_activity。
- 项目多视图：**网格 / 列表 / 进度 / 负责人**；进度由任务完成率运行时聚合（不入 frontmatter）。
- **OKR 全链路**：从 strategy / project 文档的 KR section 提取，可按 quarter 过滤。

### 📅 时间视图
- **今日聚焦**：索引统计 + 今日待办 + 逾期提醒 + AI 教练卡片。
- **日历**（events 时间线提取）/ **日志页**（含模板快捷新建）。

### 🤖 AI 教练层（M4）
- 三个能力：**主线判定 / 每日建议 / 明日一句**。
- `AiClient` trait provider 可替换（Claude / OpenAI，留 Ollama 本地扩展点）。
- **降级链**：未配 key / LLM 失败 → 本地启发式 → `ai_generations` 缓存 → 空态，绝不 panic；结果带 `source=ai|heuristic` 标降级。
- **数据最小化**：只发聚合摘要（user 上限 4k 字符截断），**绝不发 vault 原文**；30s 超时。

### 🤝 Agent 状态接口
- `export_life_state` 聚合后写 `app_data_dir/agent/{LIFE-STATE.md（人读）, state.json（机读）}`，供外部智能体定时读取。

### 🛡 工程与体验
- 写前备份（`<vault>/.helmose/backup/`）+ 软删除回收站 + 备份管理。
- **移动 / 重命名 + 引用移动感知**：路径型引用（`[文本](path)` / `[[path]]`）经用户授权后批量更新。
- 行级就地写入：insert / update / delete / append + frontmatter patch + set_tag。
- 暗色模式、ErrorBoundary（单页崩不白屏）、自动更新框架、重置安装（绝不碰 vault 原文）。

---

## 📸 界面预览

> 截图待补充。可参考根目录 [`task-planner-preview.html`](task-planner-preview.html)（PlannerPage 的视觉设计稿）。

---

## 🚀 快速上手

### 安装

当前版本需**从源码构建**（发布安装包待 updater endpoint 配齐后提供）：

```bash
# 克隆
git clone https://github.com/PNGTRID/helmose.git
cd helmose

# 安装前端依赖（用 pnpm；本机 npm 损坏、install 不建 .bin，统一 pnpm）
cd frontend && pnpm install

# 启动开发（前端 + Tauri 后端）
cd frontend && npm run tauri:dev

# 或产安装包（各平台原生安装程序）
cd frontend && npm run tauri:build
```

> **前置**：[Rust](https://rustup.rs) toolchain + Node.js + pnpm；macOS 需 Xcode CLT，Windows 需 WebView2 + MSVC，Linux 需 webkit2gtk 等（详见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)）。

### 首次启动

1. 引导页选择已有 vault 文件夹（默认候选 `~/wiki`），或用脚手架 `scaffold_vault` **新建 Life OS 目录骨架**（`00_收件箱` ~ `09_核心知识库` + 12 种 type 填写引导模板）。
2. 进入工作台后自动全量索引（1.9 万 md 目标 < 10s），随后 `notify` 增量监听。

### 配置 AI 教练（可选，不配也能用）

打开 **设置页 → AI 教练配置**：

| 字段 | 说明 |
|---|---|
| provider | `claude` 或 `openai`（未知值 → 不启用 AI，走本地启发式） |
| api_key | 你的 API key（存 `app_data_dir/config.json`，**Unix 0600，不入 vault 不入 git**） |
| enabled | 总开关；关闭或 key 为空 → 自动降级本地启发式 |

> 不配置也能正常使用所有功能——AI 三个能力会降级为本地启发式（复用 projects top-3 排序口径），结果标注 `source=heuristic`。

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri v2（Rust 后端 + React 前端） |
| 后端 | Rust 2021：rusqlite 0.32 / walkdir / pulldown-cmark / gray_matter / notify（增量索引）/ sha2 / tauri-plugin-notification（提醒）/ tauri-plugin-updater / reqwest + async-trait（AI） |
| 前端 | React 19 + TypeScript 5.9 + Vite 7 + antd 6 + Zustand 5 + react-router-dom 7 + TipTap 3（WYSIWYG）+ @dnd-kit（拖拽） |
| 数据 | 本地 markdown（vault，真相源）+ SQLite（`<app_data_dir>/helmose.db`，派生缓存） |

---

## 🏗 架构（4 层）

```
UI 层（React + antd + TipTap WYSIWYG 编辑）
  → 内置 AI 层（M4：AiClient trait + providers，主线/教练/明日一句，未配 key 降级启发式）
  → Vault 数据层（Rust：onboarding / notify 增量监听 / 契约驱动分层解析 / SQLite 索引
                  / 行级 CRUD 写回 / 移动感知 / OKR 提取 / 到期提醒）
  → Agent 接口层（export_life_state 写 LIFE-STATE.md + state.json 已实现；inbox 写回规划中）
```

**IPC 边界**：Tauri v2 自动转参数名 `camelCase ↔ snake_case`；返回值 JSON 字段保持 snake_case（Rust serde 默认），前端 TS 接口严格对齐。

---

## 💾 数据安全与隐私

这是 Helmose 的核心设计原则，独立说明：

- **vault 是唯一真相源**。SQLite 只是派生缓存——**删库可从 vault 全量重建**，永远不要把 SQLite 当主存。
- **vault 原文只读**。索引 / 查询 / 浏览一律只读 md 文件；任何写 vault（编辑、行级 CRUD、移动引用更新）都必须有**用户明确动作** + **写前备份**（`<vault>/.helmose/backup/`，隐藏目录不索引）。绝不在用户没要求时改动 vault 原文。
- **AI 不碰原文**。LLM 只接收聚合摘要（项目名 / 优先级 / 进度数字 + 全局统计），user 输入硬上限 4k 字符截断，**绝不发送 vault 正文**。
- **key 不外泄**。AI key 存 `app_data_dir/config.json`（Unix 下收紧到 0600），不入 vault、不入 git；`AiSettings` 手写 Debug 屏蔽 api_key 防日志泄漏。
- **与 Obsidian 共存**。`.obsidian/` 等隐藏目录保留、不索引、不破坏；排除目录单一契约（`utils/exclude.rs`）。
- **纯本地、无云端**。数据主权完全在用户（AI 调用除外，且只发摘要）。

---

## 🔧 配置说明

| 配置项 | 位置 | 说明 |
|---|---|---|
| AI 教练 | 设置页 → AI 教练配置 | provider / key / enabled，存 `config.json`（0600） |
| 任务标记风格 | 设置页 → 任务标记风格 | `helmose`（文字，默认）/ `obsidian`（emoji，双端互通），localStorage 持久化 |
| 到期提醒 | 固定 | 截止前一天 9:00 桌面通知（后续接 settings 可配） |
| 排除目录 | `utils/exclude.rs` | `EXCLUDE_DIRS = ["6-原始资料", "专家团"]` + 隐藏目录，单一契约点 |
| vault 路径 | 设置页 / Onboarding | 可注册多个 vault，设默认 |

---

## ⌨️ 键盘快捷键

| 快捷键 | 功能 |
|---|---|
| ⌘/Ctrl + P | 命令面板（全库搜索 / 跳页 / 最近笔记） |
| ⌘/Ctrl + J | 今日笔记（打开或创建） |
| ⌘/Ctrl + B | 切换文件面板 |
| ⌘/Ctrl + \\ | 切换侧栏 |
| ⌘/Ctrl + S | 保存编辑（TipTap 编辑器内） |

---

## 💻 开发

```bash
# —— 验证（客观裁判，改完代码必跑；CI 同此三步）——
cd src-tauri && cargo check          # Rust 类型 + 借用检查
cd src-tauri && cargo test           # Rust 单测（含 #[ignore] 真实 vault smoke test，可用 HELMOSE_TEST_VAULT 指定路径）
cd src-tauri && cargo clippy         # Rust lint
cd frontend && pnpm build            # = tsc -b && vite build（前端类型 + 构建）
cd frontend && pnpm test             # vitest 单测
cd frontend && pnpm test:coverage    # 覆盖率（lcov）
```

本地复跑 CI：`scripts/ci-local.sh`。CI 配置见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)（Backend cargo check+test / Frontend pnpm build+test / Coverage 非阻断）。

> **编码规范**：注释一律中文；Rust 命令统一 `Result<T, String>` + `.map_err(|e| e.to_string())?`；前端 hooks → 早返回 → JSX。详见 [`CLAUDE.md`](CLAUDE.md) 与 [`.spec-workflow/steering/`](.spec-workflow/steering/)。

---

## 📁 项目结构

```
helmose/
├── src-tauri/          # Rust 后端（commands / models / services[indexer|contract|ai] / utils）
├── frontend/           # React 前端（pages / components[tasks|projectViews|ai] / stores / hooks / utils）
├── .spec-workflow/     # 规范体系：steering（product/tech/structure）+ specs（各功能 requirements/design/tasks）
├── task-planner-preview.html   # PlannerPage 视觉设计稿
└── CLAUDE.md           # AI 协作指令（架构铁律 / 性能红线 / backlog）
```

完整目录树、命名约定、模块边界见 [`.spec-workflow/steering/structure.md`](.spec-workflow/steering/structure.md)。

---

## 📋 路线图

✅ **已落地**：本地知识底座（契约索引 + 增量 + FTS5 + 虚拟列表）· Obsidian 式工作台（TipTap WYSIWYG + 反链/前链 + 图谱）· 任务与计划（多视图 + PlannerPage 四象限 + 标记文字化双模式 + 到期提醒）· 项目与目标（深度结构化 + 进度聚合 + OKR）· 时间视图（日历 / 今日聚焦 / 日志）· AI 教练层（M4，主线 / 每日建议 / 明日一句，降级链）· Agent 状态接口（LIFE-STATE.md + state.json）· 行级 CRUD / 移动感知 / 备份回收站 / 暗色 / ErrorBoundary / 自动更新框架 / 重置安装。

🚧 **待办**：Agent inbox 写回 · 真实 updater endpoint/pubkey · events 的 project_id 关联 · 前向链接 dangling 提示 · AI 提醒可配置 · Ollama 本地 provider · bundle 拆分。

各功能的设计文档与任务分解见 [`.spec-workflow/specs/`](.spec-workflow/specs/)。

---

## ❓ FAQ

**和 Obsidian 冲突吗？**
不冲突。Helmose 直接读写同一份 markdown vault，与 Obsidian 完全共存——`.obsidian/` 等隐藏配置保留、不索引。两边编辑互相同步（Helmose 走 `notify` 增量索引）。

**删了 SQLite 数据库会丢数据吗？**
不会。vault markdown 是唯一真相源，SQLite 只是派生缓存，删库后重新索引即可全量恢复。

**不配 AI key 能用吗？**
能。所有功能正常工作，AI 三个能力自动降级为本地启发式，结果标注 `source=heuristic`。

**AI 会把我的笔记原文发出去吗？**
不会。LLM 只接收聚合摘要（项目名 / 优先级 / 进度数字），user 输入硬上限 4k 字符，绝不发送 vault 正文。详见上文「💾 数据安全与隐私」一节。

**任务标记用 emoji 还是文字？**
随你。读侧三格式全兼容（老 emoji / Obsidian Tasks 标准 / Helmose 文字），写侧在设置页切「任务标记风格」：默认 Helmose 文字（对 Agent 友好），切 Obsidian 模式则与 Obsidian Tasks 插件双端互通。

---

## 📄 License

[MIT](package.json)（声明于 `package.json`；LICENSE 文件待补）。
