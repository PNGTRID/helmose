# Requirements Document · plan-todo-completeness（计划/TODO 完整性补齐）

> 本 spec 为 Helmose v0.2 计划/TODO 能力的**完整性补齐总纲**。
> 写作铁律：中文 + EARS 句式验收标准 + 对齐 steering + vault 真相源。

## Introduction

### 背景

Helmose 当前（v0.1）已建成「任务 / 项目 / 日历 / 今日 / 日志」五大视图 + 全 markdown 原文驱动 + 行级写回 + Agent 状态导出的底座（见 ux-overhaul / vault-paradigm 两个 spec 的已落地资产）。但对照市场主流计划/todo 软件（Todoist / TickTick / Sunsama / Motion / Notion），仍有四类**用户可感知的能力空白**：

1. **数据层不闭环**：`okrs` 表 schema 已建但 indexer 从未填充（OKR 看板永远空）；`events.project_id` 列存在但 indexer 没填（事件无法关联项目）；笔记移动/重命名后路径型引用断链（dangling 无提示、不跟随更新）。真实场景：作者 `~/wiki` 有大量 OKR 文档与项目下事件，当前全部"看不到结构化"。
2. **实用功能缺失**：无到期提醒通知、无重复任务（`🔁 every week`）、无子任务嵌套——这是把 Helmose 从「能看能编辑」变「能驱动每日行动」的最低门槛，市场纯 Todo 工具全有。
3. **日程只能看不能排**：日历页只读展示事件，无法把任务拖进日历做时间块排程（Sunsama 核心体验）、无法拖拽事件改日期、无时间线视图。
4. **AI 教练层空白**：product.md 明确 v0.2 灵魂是「主线判定 / 每日教练建议 / 明日一句」，`tomorrow_sentences` 表与解析已就绪，但缺 LLM 调用层；`export_life_state` 的 `okrs` 字段写死 `[]`、`today_focus` 字段未生成。这是 Helmose 区别于所有竞品的核心壁垒。

### 北极星

从「**能浏览、能编辑的本地知识库**」→「**能驱动每日行动、有 AI 教练掌舵的人生操作系统**」。用户打开 Helmose 不再只是看笔记，而是：收到今天该做什么的提醒 → 看到主线项目的 OKR 进度 → 把任务拖进日历排程 → AI 给出一句明日聚焦。

### 本 spec 性质

**总纲 spec**（仿 `vault-paradigm` 总纲 + `ux-overhaul` 可执行粒度的混合）。覆盖 M1-M4 四个 milestone，每个 milestone 内部是**可执行 task 粒度**（带 `_Prompt`，可直接派 subagent 执行），而非"留待后续子 spec"的纯路线图。

依赖链：**M1（数据层，后端前置）→ M2（实用补齐）/M3（日程增强）并行 → M4（AI 教练，依赖 M1 完整数据）**。本期为**纯规划**（只写 spec 三件套，不写代码）；执行时若范围过大，可按 milestone 拆为子 spec（`plan-todo-utility` / `plan-todo-schedule` / `ai-coach` / `data-completeness`）独立推进。

## Alignment with Product Vision

对齐 `steering/product.md`：

- **「人读 + Agent 读双导向」**：M4 AI 教练层直接产出 Agent 可消费的 `today_focus` / 主线判定；M1 OKR 全链路让 `export_life_state` 的 `okrs` 字段从写死 `[]` 变真实数据，外部智能体据此判断 OKR 健康度。
- **「vault 唯一真相源」**：所有结构化数据（OKR / 重复规则 / 子任务 / 提醒）从 vault markdown 解析而来，SQLite 仍是派生缓存；M2/M3 写操作沿用 `.helmose/backup` 备份铁律。
- **「本地优先」**（product principle 3）：M4 LLM 调用虽走云端 API（用户决策），但 prompt 输入只发「聚合后的结构化状态」（主线/待办/OKR 摘要），**不发 vault 原文全文**，最小化数据外泄；API key 本地存储，调用可关。
- **与 Obsidian 共存**：M2 重复/子任务语法（`🔁` / 缩进 `-`）兼容 Obsidian Tasks 插件约定，不破坏原文可读性。

## 命门决策（与用户确认后，后续执行不得偏离）

| 决策 | 结论 | 影响范围 |
|---|---|---|
| 补齐范围 | M1 数据层 + M2 实用 + M3 日程 + M4 AI 教练，**四方向全规划** | 全 spec |
| 本期产出 | **只写 spec 三件套，不写代码**；执行待后续 | 无代码改动 |
| AI 调用路线 | **云端 API**（Claude/OpenAI），SettingsPage 配 key；prompt 只发聚合状态不发 vault 全文 | M4 |
| OKR 解析来源 | 从 `strategy` / `project` 文档的「关键结果/KR」section 提取，**不加新 type**（避免 contract 改动连锁，memory 教训） | M1 Req 1 |
| 子任务语法 | 缩进 bullet（`  - [ ] 子任务`）+ `parent_task_id` 列，兼容 Obsidian | M2 Req 6 |
| 重复任务语法 | bullet 内 `🔁 every day/week/Mon/月` 标记 + `repeat_rule` 列，兼容 Obsidian Tasks | M2 Req 5 |
| 提醒实现 | 本地 `reminders` 表 + Tauri `tauri-plugin-notification`，应用运行时轮询触发 | M2 Req 4 |
| 时间块拖拽 | 任务拖到日历时间槽 → 在当日笔记「关键事件」section 写一条事件 bullet（复用 append_bullet） | M3 Req 7 |

## Requirements

### Requirement M1.1：OKR / Key-Result 解析与查询（数据层）

**User Story:** 作为目标驱动型用户，我希望 Helmose 能从我的 OKR 文档里自动提取目标与关键结果，以便我在项目页/今日页看到 OKR 进度，而不是让 `okrs` 表永远空着。

#### Acceptance Criteria

1. WHEN 一篇文档 frontmatter `type` 为 `strategy` 或 `project` 且正文含「## 目标」「## 关键结果」「## OKR」「## Key Results」任一 section THEN indexer SHALL 解析出 objective（目标标题）与若干 kr_text（关键结果条目），写入 `okrs` 表（复用已就绪 schema）。
2. WHEN OKR 文档含 `target_value` / `current_value`（如「KR1: 营收 100万，当前 30万」）THEN 系统 SHALL 用正则提取数值填入 `okrs.target_value` / `current_value`，无法解析时留 NULL 不报错。
3. WHEN 用户调用 `list_okrs(vault_id, quarter?)` 命令 THEN 系统 SHALL 返回该 vault 的 OKR 列表（含 objective / kr_text / target / current / 来源 note），按 quarter 与 priority 排序。
4. IF `okrs.priority` 字段无法从文档推断 THEN 系统 SHALL 降级为默认值 `'P2'` 而非报错（契约容错原则）。

### Requirement M1.2：events 关联 project_id（数据层）

**User Story:** 作为项目管理者，我希望日历事件能关联到所属项目，以便按项目筛选事件、在项目详情看到该项目所有事件。

#### Acceptance Criteria

1. WHEN 一条事件 bullet 含 `#project:项目名` 标签 或 所在笔记 frontmatter 含 `project` 字段 THEN indexer SHALL 把解析出的 `project_id` 填入 `events.project_id` 列（列已存在，当前为 NULL）。
2. WHEN 用户调用 `list_events(vault_id, from, to, project_id?)` 命令 THEN 系统 SHALL 支持按 `project_id` 可选过滤。
3. WHEN `project_id` 解析失败（项目名无匹配） THEN 系统 SHALL 留 NULL 且不报错（不阻塞索引）。

### Requirement M1.3：移动 / 重命名感知（引用完整性）

**User Story:** 作为长期维护知识库的用户，我希望移动或重命名笔记后，已有的 wikilink 与路径型引用不会断链，以便我的关系网长期可用。

#### Acceptance Criteria

1. WHEN 用户在文件树对一篇笔记触发「移动/重命名」 THEN 系统 SHALL 仅更新 Helmose 索引层（notes.rel_path + 反链 target_note_id + content_hash 不变识别同一篇），**绝不主动改 vault 原文**（靠 content_hash 识别「同一篇换位置」）。
2. WHEN 移动/重命名检测到 N 处**路径型引用**（如 `[详情](01_xxx/旧名.md)`）指向旧路径 THEN 系统 SHALL 弹确认框列出这 N 处，**用户授权后**才修改这些文档原文（走 `.helmose/backup/` 备份）。
3. WHEN 用户拒绝授权 THEN 系统 SHALL 只更新索引、保留原文引用不动（dangling 由后续 reindex 自然标记）。
4. WHEN 前向链存在 dangling（指向不存在笔记） THEN 系统 SHALL 在 SidePanel 以灰色「未解析」标识提示（当前只显示已解析的）。

### Requirement M2.1：到期提醒通知（实用补齐）

**User Story:** 作为执行力弱的用户，我希望任务接近截止时收到桌面通知，以便不会错过 deadline。

#### Acceptance Criteria

1. WHEN 用户为一条任务设置了 `due_date` THEN 系统 SHALL 在 SettingsPage 提供「提醒」开关与「提前时长」配置（默认截止当天 9:00）。
2. WHEN 应用运行中且到达某任务的提醒时间 THEN 系统 SHALL 通过 `tauri-plugin-notification` 发起系统桌面通知（标题「Helmose 提醒」，正文任务名 + due）。
3. WHEN 应用未运行 THEN 系统 SHALL 不发通知（本期不做系统级后台守护，backlog）并在设置页注明此限制。
4. WHEN 用户点击通知 THEN 系统 SHALL 聚焦 Helmose 窗口并跳转到该任务（TasksPage 高亮）。

### Requirement M2.2：重复任务（实用补齐）

**User Story:** 作为有周期性事务的用户，我希望任务能设置重复（如「每周一复盘」），以便完成一次后自动生成下一次，不必手动重建。

#### Acceptance Criteria

1. WHEN 一条任务 bullet 含 `🔁 every day|week|month|Mon..Sun` 标记 THEN indexer SHALL 解析出 repeat_rule 填入 `tasks.repeat_rule` 列（新增列）。
2. WHEN 用户勾选完成一条带 repeat_rule 的任务 THEN 系统 SHALL 在原位置把该任务 due_date 推进到下一周期（按 repeat_rule 计算）并取消勾选，而非标记 done（Obsidian Tasks 语义）。
3. WHEN repeat_rule 无法解析（语法错误） THEN 系统 SHALL 当作普通任务处理（无 repeat），不报错。
4. WHEN QuickAddTaskModal 新建任务 THEN 表单 SHALL 提供「重复」下拉（不重复/每天/每周/每月/自定义），选中时在 bullet 拼 `🔁 every xxx`。

### Requirement M2.3：子任务嵌套（实用补齐）

**User Story:** 作为任务需要拆解的用户，我希望任务能挂子任务（缩进 bullet），以便父任务下展开看子步骤、子任务全完成时父任务自动推进。

#### Acceptance Criteria

1. WHEN 任务 bullet 下方有缩进 bullet（`  - [ ]`，2 空格或 tab 缩进） THEN indexer SHALL 解析为子任务，`parent_task_id` 指向父任务（新增列）。
2. WHEN TasksPage 渲染任务 THEN 父任务 SHALL 可展开显示子任务（折叠态显「+N 子任务」）。
3. WHEN 一条父任务的所有子任务均 done THEN 系统 SHALL 在 UI 提示「可勾选完成父任务」（不自动改，需用户确认，避免越权写 vault）。
4. WHEN TaskForm 新建任务 THEN 用户 SHALL 能选「作为某任务的子任务」（指定 parent），生成的 bullet 带缩进。

### Requirement M3.1：任务→日历时间块拖拽（日程增强）

**User Story:** 作为按时间块工作（time-blocking）的用户，我希望把待办任务拖进日历的某个时间槽，以便它变成那个时段的事件，物理上安排进我的一天。

#### Acceptance Criteria

1. WHEN 用户从 TasksPage（或今日待办）拖一条任务到 CalendarPage 某天某时段 THEN 系统 SHALL 在该日笔记「关键事件」section 写一条事件 bullet（`- HH:MM 任务名`，复用 `append_bullet`），并保留原任务（不删）。
2. WHEN 目标日期无笔记 THEN 系统 SHALL 先 `ensureDayNote`（复用 daily 模板）再写事件。
3. WHEN 拖拽成功 THEN 系统 SHALL 刷新日历显示新事件 + toast「已排入 HH:MM」。
4. WHEN 任务 `source_line` 为 null（聚合任务） THEN 系统 SHALL 禁止拖拽并 toast 提示。

### Requirement M3.2：事件拖拽改日期 / 多日事件（日程增强）

**User Story:** 作为日程常变动的用户，我希望在日历上直接拖拽事件到另一天改日期，以便快速调整日程而不必编辑原文。

#### Acceptance Criteria

1. WHEN 用户在日历上拖拽一条事件到另一天 THEN 系统 SHALL 修改该事件 bullet 的日期归属（移动到目标日期的笔记，或改 bullet 内日期标记），走 `update_line` / `delete_line`+`append_bullet` 写回。
2. WHEN 用户拖拽时按住修饰键（如 Shift） THEN 系统 SHALL 创建为多日事件（目标日保留 + 原日不删，标记为跨天）——本期可降级为「复制到目标日」。
3. WHEN 写回失败 THEN 系统 SHALL toast 报错并回滚 UI。

### Requirement M3.3：时间线视图（日程增强）

**User Story:** 作为项目驱动的用户，我希望在 TasksPage 看到第四个视图「时间线」（按 due_date 横向铺开），以便直观看到任务在时间上的分布与扎堆。

#### Acceptance Criteria

1. WHEN 用户在 TasksPage Segmented 切到「时间线」 THEN 系统 SHALL 渲染横向时间轴（今日为中轴，左右延展），任务按 due_date 落点。
2. WHEN 任务无 due_date THEN 系统 SHALL 归到「未排期」侧栏区。
3. WHEN 任务扎堆（同一天多条） THEN 系统 SHALL 堆叠显示 + 计数角标。

### Requirement M4.1：LLM 调用抽象层（AI 教练基础）

**User Story:** 作为系统，我需要一个可替换的 LLM 调用层，以便 AI 教练功能不绑死单一供应商，且未配置 key 时优雅降级。

#### Acceptance Criteria

1. WHEN 调用 AI 功能 THEN 系统 SHALL 经统一的 `services::ai::Client` 抽象（封装 prompt + HTTP + 解析），支持 Claude / OpenAI 两种 provider（SettingsPage 选）。
2. IF 用户未配置 API key THEN 所有 AI 功能 SHALL 优雅降级（UI 显「未配置 AI，去设置」），不崩溃、不报错弹窗。
3. WHEN 发起 LLM 调用 THEN 系统 SHALL 只发送**聚合后的结构化状态**（主线项目名 + 待办摘要 + OKR 摘要，每项截断），**绝不发送 vault 原文全文**（数据主权 + token 成本）。
4. WHEN LLM 调用失败（网络/超时/限流） THEN 系统 SHALL 降级为本地启发式（如规则推断主线）+ 静默记日志，不阻塞用户。

### Requirement M4.2：AI 主线判定（AI 教练）

**User Story:** 作为多项目并行、容易失焦的用户，我希望 AI 每天判定我的主线项目，以便我清楚今天该聚焦什么。

#### Acceptance Criteria

1. WHEN 用户在 TodayPage 点「刷新主线判定」或定时触发 THEN 系统 SHALL 把当前 active 项目（含 priority / is_mainline / last_activity / OKR 进度）聚合后送 LLM，LLM 返回「主线 1 个 + 理由」。
2. WHEN LLM 返回主线 THEN 系统 SHALL 写入 `life_state_snapshots.mainline_project` + 在 TodayPage 主线卡片显示 AI 判定与理由。
3. IF LLM 未配置/失败 THEN 系统 SHALL 退回现有 indexer top-3 启发式（projects.rs `apply_global_passes`），UI 标注「本地推断（未接 AI）」。

### Requirement M4.3：每日教练建议 + 明日一句（AI 教练）

**User Story:** 作为需要外部视角的用户，我希望每天收到一句 AI 教练建议（基于今日完成与待办），以及睡前一句「明日聚焦」，以便有节奏感。

#### Acceptance Criteria

1. WHEN 用户在 TodayPage 点「今日教练」 THEN 系统 SHALL 聚合（今日已完成 + 今日待办 + 逾期 + 主线 OKR）送 LLM，返回 1-3 句建议，写入 `life_state_snapshots.today_focus` + UI 卡片展示。
2. WHEN 用户在 TodayPage 点「生成明日一句」 THEN 系统 SHALL 基于（明日待办 + 明日事件 + 主线）生成一句话，写入当日笔记「明日寄语」section + `tomorrow_sentences` 表（复用现有解析）。
3. WHEN 生成内容写回 vault（明日寄语 section） THEN 系统 SHALL 走 `append_bullet`/`update_line` 收口（备份 + 重索引），遵守写 vault 铁律。
4. WHEN 用户对 AI 生成内容不满意 THEN 系统 SHALL 提供「重新生成」与「编辑后保存」两个出口（不强制接受 AI 原文）。

## Non-Functional Requirements

### Code Architecture and Modularity

- **分层不变**：`commands`(IPC) ↔ `services`(解析/契约/AI) ↔ `models`(DTO) ↔ `indexer`(纯解析不写库)。AI 调用属 `services::ai`，不污染 indexer。
- **契约单一真相源**：OKR 解析**不加新 type**，复用现有 `strategy`/`project`（架构铁律 4，memory 教训：改契约触发 6 测试红）。
- **AI 抽象层可替换**：`services::ai::Client` trait 化，provider（Claude/OpenAI/未来本地 Ollama）可插拔。
- **写 vault 统一收口**：M2.2 推进重复任务、M3 拖拽写事件、M4.3 写明日寄语，全部经现有 `append_bullet`/`update_line`/`save_note_content_inner`（含 `.helmose/backup` 备份），不自写 `fs::write`。

### Performance

- **性能红线**（vault ~1.9 万 md）：OKR 解析在全量索引内完成（不新增全量扫盘）；AI 聚合状态**只发摘要**（主线/待办各 ≤10 条截断），绝不发原文。
- **提醒轮询**：本地 `reminders` 表查询按 `due_date` 索引（已存在 `idx_tasks_due`），轻量；轮询间隔 ≥60s。
- **时间线视图**：任务按 due_date 内存排序（复用 get_tasks 一次拉取），不重复 IPC。

### Security / 铁律

- **vault 原文默认只读**：M1.3 路径型引用更新 MUST 用户授权 + 备份；M2/M3/M4 写操作经统一收口 API。
- **AI 数据最小化**：LLM 输入只发聚合摘要，API key 存 `app_data_dir`（不入 vault、不入 git）。
- **IPC snake_case**：新增 DTO（Okr / Reminder / AiSuggestion）字段 snake_case，前端 TS 对齐（架构铁律 3）。
- **提醒不越权**：通知权限首次触发时请求（macOS Notarization 友好），用户拒绝则静默跳过。

### Reliability

- **AI 降级链**：LLM 失败 → 本地启发式 → 上次快照 → 空态提示，四级降级不阻塞。
- **契约容错**：OKR / repeat_rule / 子任务解析失败一律降级（留 NULL / 当普通任务），不报错阻塞索引。
- **迁移幂等**：tasks 加 `repeat_rule`/`parent_task_id` 列、新建 `reminders` 表，全部 `PRAGMA table_info` 查存在再 ALTER（仿 M3 migration）。

### Compatibility

- **现有 vault 兼容**：作者 1.9 万 md 在新解析下无缝索引（OKR 文档被识别、含 `🔁` 的任务被识别、缩进子任务被识别），不要求用户重组文件。
- **Obsidian 共存**：`🔁` / 缩进 bullet / `#project:` 语法与 Obsidian Tasks 插件约定对齐，Obsidian 端打开仍可读。
- **跨平台通知**：`tauri-plugin-notification` 支持 macOS/Windows/Linux，行为差异（macOS 需授权）在设置页说明。
