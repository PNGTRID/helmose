# Tasks Document · vault-paradigm（范式转移总纲）

> 性质：**总纲路线图**（覆盖阶段 0–5）。本 tasks 是阶段分解 + 落地状态记录；
> 每个阶段的**实现级 task**（带 _Prompt）在对应**子 spec**（如 `vault-paradigm-scaffold`）细化。
> 落地基准日：2026-07-01（对照源码 commands/indexer + CLAUDE.md backlog 核对）。
> 图例：`[x]` 已落地 · `[-]` 部分落地 · `[ ]` 未做（留待后续子 spec）。
> 铁律：**绝不改 `~/wiki` vault 原文**（索引侧纯只读）；写 vault 必须「备份 + 授权」；IPC snake_case；契约单一真相源。

---

## 阶段 0A · note id 稳定化（content hash）✅

- [x] 0A.1 content hash 稳定 note id
  - File: `src-tauri/src/services/indexer/mod.rs`（content_hash 函数 + parse_file 填值）、`src-tauri/src/commands/index.rs`（id 用 hash + 碰撞消歧）、`src-tauri/Cargo.toml`（sha2）
  - 规范化正文 sha256 作主键；碰撞消歧 `id = "{hash}#{short_hash(rel_path)}"`；`notes.content_hash` 列存纯 hash；全量 DELETE CASCADE 自然迁移外键，无迁移脚本
  - Purpose: note id 移动不变（Req 3）
  - _Leverage: `frontmatter::parse` 的 fm.content_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - 实现细节见子 spec **vault-paradigm-scaffold** task 3

## 阶段 0B · 契约层（内置规范.md）✅

- [x] 0B.1 契约模块 `services/contract/`
  - File: `src-tauri/src/services/contract/mod.rs`、`src-tauri/src/services/mod.rs`
  - 内置 10 顶层目录 + 12 种 type + type→目录映射 + `infer_note_type`（fm_type 优先 → 最长前缀反查 → None 降级）+ `infer_layer`（L1/L2/L3）
  - Purpose: 契约单一真相源，结束 layers.rs 靠猜（Req 1）
  - _Requirements: 1.1, 1.2, 1.3_
  - 实现细节见子 spec **vault-paradigm-scaffold** task 1

- [x] 0B.2 layers.rs 改造（契约驱动 + 删旧编号私货）
  - File: `src-tauri/src/services/indexer/layers.rs`（已退化为契约薄封装，旧编号硬编码 + `1-我/张三` 私货已删）
  - Purpose: 索引按契约判定（Req 1.2/1.4）
  - _Requirements: 1.2, 1.4_
  - 实现细节见子 spec **vault-paradigm-scaffold** task 2

- [x] 0B.3 EXCLUDE_DIRS 单一契约对齐
  - File: `src-tauri/src/utils/exclude.rs`（单一定义点）、`commands/index.rs` / `library.rs` / `indexer/incremental.rs`（共用）
  - 排除规则集中一处，消除索引视图与浏览视图漂移（架构铁律 5）
  - _Requirements: 1.5_

## 阶段 1 · 脚手架（安装即生成骨架）✅

- [x] 1.1 脚手架命令 + 前端接入
  - File: `src-tauri/src/commands/scaffold.rs`、`frontend/src/pages/OnboardingPage.tsx`、`api/index.ts`、`types/index.ts`
  - `scaffold_vault` 空目录生成 00~09 骨架 + 12 种 type 模板 + 规范.md/目录.md/README.md；非空/已有 vault 拒绝；前端「创建我的知识库」入口
  - Purpose: 新用户开箱即用（Req 2）
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - 实现细节见子 spec **vault-paradigm-scaffold** task 4/6

## 阶段 2 · 结构化数据落地 🟡（缺 okrs）

- [x] 2.1 projects 深度结构化
  - File: `src-tauri/src/commands/projects.rs`、`src-tauri/src/services/indexer/projects.rs`、`src-tauri/src/services/indexer/sections.rs`
  - 两层提取（frontmatter + 正文 section），返回 priority/is_mainline/含 top-3 兜底/okr_priority/last_activity
  - Purpose: 项目看板不再是空壳（Req 4.1）
  - _Requirements: 4.1_

- [x] 2.2 events 解析
  - File: `src-tauri/src/commands/events.rs`、`src-tauri/src/services/indexer/events.rs`
  - 从「关键事件/时间线」section 提取 bullet 填 events 表 + `list_events` 命令；日历/今日页消费
  - Purpose: 时间线结构化（Req 4.3）
  - _Requirements: 4.3_

- [x] 2.3 tasks due_date 解析
  - File: `src-tauri/src/commands/tasks.rs`、`src-tauri/src/services/indexer/tasks.rs`
  - bullet 内 📅/due:/截止:/deadline → due_date 列；TasksPage 分组 + TodayPage 今日待办按此筛
  - Purpose: 任务时间结构化（Req 4.1）
  - _Requirements: 4.1_

- [ ] 2.4 OKR/key-result 解析与查询 🔴（okrs 表 schema 已建未填充）
  - File: `src-tauri/src/services/indexer/okrs.rs`（新建）、`src-tauri/src/commands/okrs.rs`（新建）、`src-tauri/src/services/indexer/mod.rs`（parse_file 编排）、`main.rs` 注册
  - `okrs` 表 schema 已就绪（`services/database.rs`，含 key-result 结构）；缺的是 `indexer/okrs.rs` 解析 + `commands/okrs.rs` 查询；解析含 OKR/key-result 结构的文档填 okrs 表
  - Purpose: OKR 看板不再空（Req 4.2）
  - _Leverage: `indexer/projects.rs` 两层提取模式、`parse_file` 编排_
  - _Requirements: 4.2_
  - **留待后续子 spec（如 vault-okrs）落地**

- [ ] 2.5 events 的 project_id 关联 🔴
  - File: `src-tauri/src/services/indexer/events.rs`、`database_sqlite.rs`
  - event → project 映射（当前 events 表无 project_id 关联）
  - _Requirements: 4.3_
  - **留待后续子 spec**

## 阶段 3 · 引用完整性（移动/重命名不断链）🟡（缺移动感知）

- [x] 3.1 反向链接 + 前向链接
  - File: `src-tauri/src/commands/library.rs`（get_backlinks / get_forward_links）、`src-tauri/src/services/indexer/wikilinks.rs`
  - SidePanel 双向链接完整；wikilink `[[x]]` 可点跳转（render_wikilinks + 前端 useWikilinkNavigation）
  - Purpose: 关系网可见（Req 5 基础）
  - _Requirements: 5.1（部分）_

- [ ] 3.2 Move/Rename 命令（移动感知）🔴
  - File: `src-tauri/src/commands/move.rs`（新建）、`main.rs` 注册、前端文件树右键菜单
  - 靠 content_hash 识别「同一篇换位置」仅更新 Helmose 索引层（反链/links/状态导出），**不碰 vault 原文**
  - Purpose: 移动不断链（Req 5.1/5.2）
  - _Leverage: `content_hash`、`library::get_backlinks/get_forward_links`_
  - _Requirements: 5.1, 5.2_
  - **留待后续子 spec（如 vault-reference-integrity）**

- [ ] 3.3 路径型引用自动更新（带授权）🔴
  - File: `src-tauri/src/commands/move.rs`、`src-tauri/src/services/indexer/incremental.rs`
  - 检测到 N 处路径型引用 → 弹确认「是否一并更新？」→ **用户授权后**才改这些文档原文（走 `.helmose/backup/` 备份）
  - Purpose: 移动后引用跟随（Req 5.3/5.4）
  - _Leverage: `save_note_content` 备份机制_
  - _Requirements: 5.3, 5.4_
  - **留待后续子 spec**

- [ ] 3.4 前向链 dangling 提示 🔴
  - File: `src-tauri/src/commands/library.rs`、前端 SidePanel
  - 当前前向链只显示已解析的，dangling（指向不存在笔记）无提示
  - **留待后续子 spec**

## 阶段 4 · 可视化编辑 🔴（未做）

- [x] 4.0 CodeMirror 编辑写回（基础）
  - File: `src-tauri/src/commands/notes.rs`（save_note_content）、前端 NoteEditor
  - 文本编辑 + 写前 `.helmose/backup/` 备份 + content hash 重算 + 增量重索引
  - Purpose: 基础编辑能力（Req 6 的文本基础）
  - _Requirements: 6.3（部分）_

- [ ] 4.1 type 路由可视化编辑器 🔴
  - File: 前端按 `note_type` 路由（`type=project`→看板、OKR 文档→key-result 进度卡片、任务→勾选）
  - 提交时结构化写回 frontmatter + 正文，保持 Obsidian/Hermes 可读；写前走备份
  - Purpose: 按 type 可视化编辑（Req 6.1/6.2/6.3）
  - _Leverage: `contract::NOTE_TYPES`（路由）、`save_note_content`（备份）、`incremental::upsert_rel`_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - **留待后续子 spec（如 vault-visual-editing），v0.2+**

## 阶段 5 · Agent 接口 🟡（缺 agent.md / inbox 写回）

- [x] 5.1 Agent 状态导出
  - File: `src-tauri/src/commands/life_state.rs`（export_life_state，199 行）
  - 聚合主线/项目/任务写 `app_data_dir/agent/{LIFE-STATE.md（人读）, state.json（机读）}`；在 Req 4 数据落地后输出真实状态
  - Purpose: 外部智能体定时读取（Req 7.3）
  - _Requirements: 7.3_

- [ ] 5.2 agent.md 协作契约 🔴
  - File: `src-tauri/src/commands/life_state.rs` 或新模块、脚手架/导出时生成
  - 机器读向，说明 Helmose 定位/vault 规范结构/IPC 能力清单/状态接口/AI- 文件约定/协作边界；与规范.md AI 运维机制对齐
  - Purpose: Helmose 与 Hermes/Codex/OpenClaw 的协作契约（Req 7.1/7.2）
  - _Requirements: 7.1, 7.2_
  - **留待后续子 spec（如 agent-protocol）**

- [ ] 5.3 Agent inbox 写回（带保护）🔴
  - File: `src-tauri/src/commands/`（新命令）、路径防穿越 + 备份
  - 外部智能体写回 inbox，经用户授权 + 备份后落 vault；绝不偷偷改原文
  - Purpose: Agent 闭环（写回方向）
  - _Leverage: `save_note_content` 备份 + 路径防穿越_
  - **留待后续子 spec**

---

## 未列入本期（backlog · 留待后续子 spec）

- **okrs 全链路**（阶段 2.4/2.5）→ 子 spec `vault-okrs`
- **移动感知 + 路径型引用更新 + dangling 提示**（阶段 3.2/3.3/3.4）→ 子 spec `vault-reference-integrity`
- **可视化编辑**（阶段 4.1）→ 子 spec `vault-visual-editing`（v0.2+）
- **agent.md + inbox 写回**（阶段 5.2/5.3）→ 子 spec `agent-protocol`
- **契约与已有 vault 规范.md 的自动同步/校验**（design 开放决策 1）→ 后续 spec
- **AI 教练层**（主线判定/每日建议/明日一句）→ 不属本范式 spec，独立 v0.2 主线
