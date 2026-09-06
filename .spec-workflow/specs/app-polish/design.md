# app-polish · Design

## 架构总览

数据流：vault md → `indexer::parse_file`（已算 date_iso/tags/frontmatter）→ 扩展提取（projects 深度 / events）
→ `index_vault_inner` 全量写库 / `incremental::upsert_rel` 增量写库 → Tauri 命令查询 → 前端页消费。

不改：vault 原文、schema 表结构（projects/events 表字段已齐，无需 migration）、现有 IPC 契约。

## Code Reuse Analysis（复用现有代码）

- `services/contract`：复用 TOP_LEVEL_DIRS（判断 project home 父目录是否顶层）。
- `utils/exclude`：复用 is_excluded（last_activity 子目录扫描排除规则）。
- `indexer::ParsedNote`：已算好 date_iso/tags/frontmatter/mtime，M1/M2 直接复用，不重算。
- `indexer::sections::split_sections`：events 提取复用 section 切分。
- `indexer::tasks::extract_bullets` 模式：events 提取参照 bullet 正则模式。
- 前端 `useAllNotesMeta`：M3/M4 复用全量元数据（event.note_id → NoteMeta 在前端解析，免 DTO 膨胀）。
- 前端 `openNoteFromMeta` / `DataState`：M3/M4 复用三态渲染 + 跳转。

## M1 projects 深度结构化设计

### 提取分两层（per-note + 全局）

`indexer/projects.rs::extract` 返回扩展 ProjectInfo，含**本笔记可本地算出**的字段：
- `priority`：frontmatter.priority（数字）→ f64；无则 None（全局兜底）。
- `is_mainline`：① frontmatter.mainline==true 或 ② tags 含 "mainline" → true；否则 false（全局 ③ 在外层补）。
- `okr_priority`：frontmatter.okr（字符串）> tag "okr:*" > tag 含 "goal" → "goal" > None。

`index_vault_inner` 收集完所有 ProjectInfo 后做**全局 pass**（需全集）：
1. `last_activity`：parent_dir = home_rel_path 的父目录；若 parent_dir ∈ TOP_LEVEL_DIRS（顶层共享目录）→ 退化为笔记自身 mtime；否则取所有 rel_path 以 `parent_dir/` 开头的 parsed note 的 max(mtime) → 转 ISO8601 字符串。**纯内存计算，不读盘，不爆性能**。
2. `assign_fallback_priorities`：priority 仍为 None 的，按 name 字母序在同级项目内分桶 rank0→150 / rank1→100 / rank2+→50。
3. `assign_mainline_top3`：is_mainline 仍 false 且 status==active 的项目，按 (priority desc, last_activity desc) 取 top-3 → 置 is_mainline=true。

### 写库

`index_vault_inner` 第三遍 projects INSERT 改为带全字段（priority/is_mainline/okr_priority/last_activity）。
`incremental::upsert_rel` 新增：解析后若为 project → DELETE 旧 projects 行（by note_id）+ INSERT 新行（全字段）；
**全局字段（last_activity/top-3 mainline）在增量场景用本笔记 mtime + 单文件信息近似**（下次全量修正，与 wikilink 增量近似同口径）。

### 查询

`get_projects` 加 `by_mainline: Option<bool>` / `by_priority: Option<bool>` 参数；排序改 mainline DESC, priority DESC, last_activity DESC。

## M2 events 设计

### 提取

新增 `indexer/events.rs::extract(p) -> Vec<ExtractedEvent>`：
- 候选 section：名含「关键事件 / 事件 / 时间线 / 里程碑」。
- 每个 bullet → ExtractedEvent { title（去 `**bold**` 与时间前缀）, event_date（=note.date_iso）, event_time（解析行首 HH:MM）, raw_bullet, content/output/project_id=None }。
- 无事件 section 或无 date_iso → 空 Vec（该笔记仍以 dated note 形式进日历）。

`ParsedNote` 加 `events: Vec<ExtractedEvent>` 字段，`parse_file` 调 extract。

### 写库

`index_vault_inner` 加第四遍：DELETE FROM events WHERE vault_id → 遍历 parsed note 插 events。
`incremental::upsert_rel` 加：DELETE 旧 events（by note_id）+ 插新。

### 命令

`commands/events.rs::list_events(vault_id, from: Option<String>, to: Option<String>) -> Vec<Event>`：
按 event_date 在 [from,to] 过滤（from/to 为 YYYY-MM-DD）。无过滤返回全部（前端可再筛）。
mod.rs + main.rs 注册；前端 types 加 Event、api 加 listEvents。

## M3 CalendarPage 设计

- 复用 useAllNotesMeta（notes by date，已有）。
- 新增 events 拉取：useEffect（cancelled flag 守卫）按可见月范围调 listEvents。
- cellRender：事件点（紫 Badge）+ 笔记数（现有）。今日单元格加边框高亮。
- 选中日期右侧列：notes + events 合并；点击 event → note_id 在 notes 数组建 Map 查 NoteMeta → openNoteFromMeta。
- 无 events 时 byDateEvents 为空，自然退化为只显示 notes。

## M4 TodayPage 设计

四卡片（antd Row/Col + Card）：
- 今日待办：未完成 task，且 note_id ∈ 今日 date_iso 的笔记（绕开 due_date 未填的坑）。点击 → tasks 页。
- 今日事件：event_date == today。点击 → calendar 页。
- 主线项目：is_mainline=1（M1）。点击 → projects 页。
- 索引统计：现有 stats。点击 → 重新索引。
- 卡片跳转走 tabs store 的 openPage（新增方法或复用 openNote 的 page 类型）。
- 空态：所有卡片数据为空时显示引导文案。

## M4b ProjectsPage 设计

- 排序：mainline DESC → priority DESC → last_activity DESC（mainline 自动置顶）。
- 卡片显示：主线徽标（已有）+ priority 数字 + last_activity 相对时间（utils/date.ts 加 relativeTime，用 dayjs relativeTime 插件）。
- 「只看主线」Switch：本地 state，过滤 is_mainline=1。

## M5 自动更新设计

- Cargo.toml 加 `tauri-plugin-updater = "2"`；main.rs `.plugin(tauri_plugin_updater::Builder::new().build())`。
- tauri.conf.json `plugins.updater`：pubkey/endpoints 用 "TODO_REPLACE_AT_RELEASE" 占位。
- capabilities/default.json 加 updater 权限。
- `commands/update.rs::check_update(app) -> UpdateStatus { available, version, message }`：try updater.check()；任何错（含占位 endpoint）→ 返回 available=false + message="未配置更新源…"。
- 前端 SettingsPage 加「检查更新」按钮。

## M6 重置安装设计

- `commands/vault.rs::reset_app(app, db) -> ()`：DROP 所有派生表（notes/tasks/events/projects/okrs/entities/links/tomorrow_sentences/life_state_snapshots/notes_fts）+ vaults（移除注册）→ 重 init_schema（空库有效）→ 删 app_data_dir/agent/（导出缓存）。
- 铁律：绝不删 vault md 文件。
- 前端 SettingsPage 加「重置 Helmose」区（Popconfirm）→ reset_app → vaultStore.load() → vault=null → OnboardingPage。

## 风险与降级

- tauri-plugin-updater 装包可能版本冲突 → 修 3 轮仍红则 M5 入 backlog（仅留前端按钮 + 占位文案）。
- events 提取对真实 wiki 的覆盖率取决于 section 命名 → 80 分线只覆盖规范定义的 section 名，未覆盖的笔记仍以 dated note 进日历。
