# ux-overhaul · Design

## 架构总览

三层改动（依赖方向：数据层 ← 共享前端层 ← 页面层）：

1. **数据层**（M3/M5 后端）：
   - Task 加 `status`/`priority`/`urgency`；Project 加 `owner`。
   - indexer 解析新标记（与 due_date 同模式：提取 + 清理 text + 独立存）。
   - DB 幂等迁移（PRAGMA table_info 查列再 ALTER）。
   - 新增 4 命令：`set_task_status` / `set_task_priority` / `set_task_urgency` / `get_project_progress`。

2. **共享前端层**（M2/M5/M7 共用）：
   - `utils/quickAdd.ts`（bullet/fm 拼装纯函数）+ `utils/journalTemplates.ts`（4 日志模板）+ `utils/projectTemplates.ts`（4 项目模板）。
   - 3 个 QuickAdd Modal 组件（Task/Event/Project）+ NewEventModal（日历复用）。
   - `stores/taskView.ts`（任务视图状态持久化）。

3. **页面层**：7 页改造 + 外壳 2 处（App.tsx 侧栏 + main.tsx antd App 包裹）+ src-tauri/Info.plist。

数据流不变：vault md → `indexer::parse_file` → SQLite → Tauri 命令 → 前端。新字段在 parse 阶段提取，写库走现有 `index_vault_inner` / `incremental::upsert_rel` 链路，写 vault 走 `save_note_content_inner` 收口。

## Code Reuse Analysis（复用现有代码，避免重造）

- **`append_bullet`**（library.rs）：M2 待办/事件、M6 日历事件、M7 日志 bullet 全部复用 → 零新命令。
- **`create_note`**（library.rs）：M2 项目、M5 项目、M7 日志创建复用（带 frontmatter）→ 零新命令；自带路径防穿越 + 不覆盖 + 增量索引。
- **`save_note_content_inner`**（library.rs）：M3 `set_task_*` 三命令复用收口（备份 + 重索引），与 `toggle_task_inner` 同构。
- **`split_due` 模式**（tasks.rs:38-48）：M3 `split_status`/`split_priority`/`split_urgency` 完全对称（正则提取 → 清理 text → 独立字段）。
- **`toggle_task_inner` 拆行骨架**（library.rs:351-368）：M3 `set_task_*` 复用 `lines()` + `idx=source_line-1` + 越界检查 + `join` + 补尾 `\n`。
- **`NoteFieldsForm`**（components）：M5 项目弹窗、M7 日志字段扩展复用控件模式 + `patchFrontmatter`/`setTag` 写回。
- **`DataState` 三态 + `useAllNotesMeta`**：列表/网格视图复用（loading/error/empty + 全量元数据内存过滤）。
- **indexer 两层提取模式**（projects.rs extract per-note + index_vault_inner 全局 pass）：M5 owner 是 per-note 字段（extract 内加一行），无需全局 pass。
- **前端 antd `<App>` 包裹**（main.tsx）：消费 ConfigProvider locale，解决 antd 6 静态方法不消费 Context 的坑（官方 why-not-static）。

## 数据模型变更

### Task 加 3 字段（M3）

```rust
// models/task.rs
pub struct Task {
  // 既有: id/note_id/vault_id/text/done/due_date/source/source_line/project_id/created_at/completed_at
  pub status: String,    // "todo" | "doing" | "done"，默认 "todo"
  pub priority: i32,     // 0-3，0=未设
  pub urgency: String,   // "low" | "mid" | "high"
}
```

**DB 迁移**（database.rs init_schema，幂等）：
```sql
-- 新库 CREATE TABLE tasks 时直接带 3 列
-- 旧库 migration：PRAGMA table_info(tasks) 查列存在性，无则 ALTER ADD COLUMN
ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'todo';
ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN urgency TEXT NOT NULL DEFAULT 'low';
UPDATE tasks SET status='done' WHERE done=1;  -- 旧数据反填
```
`done` 字段保留为派生（`done = (status == 'done')`），向后兼容 `get_tasks(done=...)`（命令内部转 `status` 过滤）。

### Project 加 owner 字段（M5）

```rust
pub struct Project { /* 既有... */ pub owner: Option<String> }
```
- indexer projects.rs `extract` 加一行：`let owner = p.frontmatter.get("owner").and_then(|v| v.as_str()).map(str::to_string);`
- DB migration 同模式（PRAGMA + ALTER ADD COLUMN owner TEXT）。
- `row_to_project` + SELECT 加 owner 列。

### vault 标记语法（与 due_date 同模式：emoji + Obsidian Tasks 兼容）

| 字段 | vault 语法 | indexer 解析 |
|---|---|---|
| status | `- [/] 任务` 或 `- [ ] 任务 🔄` = doing；`- [x] 任务` = done；`- [ ]` = todo | checkbox 前缀 + 🔄 emoji |
| priority | `- [ ] 任务 ⭐⭐`（⭐ 数 1-3 = priority 1-3） | 数 ⭐ 个数 |
| urgency | `- [ ] 任务 🔥` = high；无🔥且 due_date≤明天 → 前端派生 high | 🔥 emoji |
| owner | frontmatter `owner: 张三` | fm.owner 读取 |

> urgency 派生（due_date 推导）只在前端做（TasksPage 加载后 useMemo 派生），indexer 只解析手动 🔥 标记 —— 守"indexer 纯解析已知标记，派生逻辑在前端"边界。

## M1 中文化设计

### Info.plist（release 生效，dev 不生效）
新建 `src-tauri/Info.plist`（Tauri bundler 合并到生成结果，不覆盖必需字段）：
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/Property-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh-Hans</string>
  <key>CFBundleLocalizations</key><array><string>zh-Hans</string><string>en</string></array>
</dict>
</plist>
```
原理：macOS 给 app 的系统级菜单（含 WKWebView 右键 Copy/Paste/Look Up/Search/Share）语言由 **app bundle 声明的本地化**决定；Tauri 默认 `CFBundleDevelopmentRegion=en` 且无 `CFBundleLocalizations` → macOS 判定"app 不支持中文"→ 退化英文。声明 zh-Hans 后跟随中文。

### antd `<App>` 包裹（main.tsx，防御 antd 6 静态方法坑）
```tsx
import { App as AntdApp, ConfigProvider } from "antd";
<ConfigProvider locale={zhCN} theme={...}>
  <AntdApp><HashRouter><App /></HashRouter></AntdApp>
</ConfigProvider>
```
现有 `message.*` 都是硬编码中文文案（不改），未来 `Modal.confirm` 静态方法经 `App.useApp()` 拿 context 中文。

## M2 今日页设计

3 弹窗（`components/QuickAddTaskModal.tsx` / `QuickAddEventModal.tsx` / `QuickAddProjectModal.tsx`）+ `utils/quickAdd.ts`：

```ts
// utils/quickAdd.ts
buildTaskBullet(text, dueDate?, urgency?, projectName?)    // → `- [ ] {text} 📅 {due} 🏷️ {urgency} #project:{name}`
buildEventBullet(title, start, end?, projectName?, note?)  // → `- HH:MM[-HH:MM] {title}（{note}）`
buildProjectFrontmatter(name, status, priority, mainline, okr) // → fm + 正文
slugify(name)  // 项目名 → 文件名
```

写回流（零新命令）：
- 待办：`createTodayNote()` → `appendBullet(nc.id, "今日待办", buildTaskBullet(...), true)` → `refresh()`。
- 事件：`createTodayNote()` → `appendBullet(nc.id, "关键事件", buildEventBullet(...), false)` → `refresh()`。
- 项目：拼 `rel_path = "01_企业与项目资产/{slug}.md"` → `createNote(vault.id, relPath, content)` → 可选 `setDrawerNoteId(nc.id)`。

控件：紧急程度用 antd 6 `Segmented`（横排紧凑），项目用 `Select showSearch optionFilterProp`（active 项目 <50，安全）。

## M3 任务页设计

### 后端
- indexer tasks.rs 加 `RE_STATUS` / `RE_PRIORITY` / `RE_URGENCY` + `split_status()` / `split_priority()` / `split_urgency()`，`ExtractedTask` 加 3 字段（仿 `split_due`）。
- `get_tasks` 加 `status: Option<String>` / `project_id: Option<String>` / `priority_min: Option<i32>` 参数。
- `set_task_status(note_id, source_line, status)`：改 bullet 前缀 `[ ]`/`[/]`/`[x]` + 增删 🔄。
- `set_task_priority(note_id, source_line, priority)`：增删 ⭐（按 priority 数补 ⭐）。
- `set_task_urgency(note_id, source_line, urgency)`：增删 🔥。
- 三命令壳 + inner 双层（参考 `toggle_task` 模式），经 `save_note_content_inner` 收口。
- 全量/增量 INSERT 加 3 列；`row_to_task` 读新列。

### 前端
- 新依赖：`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`（现代、无障碍、antd 友好；多容器 Droppable 一流适配看板/四象限）。
- `stores/taskView.ts`：`view: 'list'|'kanban'|'matrix'` + `groupBy` + localStorage 持久化。
- `components/tasks/TaskCard.tsx`（draggable 包装，统一卡片）。
- `components/tasks/ListView.tsx`（抽出 `dueGroups` + 多分组维度 Segmented）。
- `components/tasks/KanbanView.tsx`（3 列 Droppable：待办/进行中/已完成，跨列拖 → `set_task_status`）。
- `components/tasks/MatrixView.tsx`（2×2 网格 4 桶 Droppable：重要×紧急，拖 → 改 priority/urgency）。
- `TaskForm.tsx`（升级 InlineAdd 为参数表单：文本 + DatePicker + Segmented priority + Select project + Segmented status）。
- 拖拽：optimistic update（先改前端状态）→ 调命令 → 失败 `message.error` + revert。
- urgency 派生：TasksPage 加载后 `useMemo` 按 due_date 推导（逾期/今天=high，本周=mid，之后/无=low），手动 🔥 覆盖派生。
- 性能：`get_tasks` 仍只回元数据；看板/四象限卡片量大时限高 + 默认 `limit=500`（复用 FilePanel ResizeObserver 虚拟化思路，但 dnd 与虚拟列表配合复杂，先用 limit 截断）。

## M4 侧栏设计

`App.tsx:164-165` 改：
```tsx
{sidePanelOpen && active?.type === "note" && <div className="ob-resizer" .../>}
{sidePanelOpen && active?.type === "note" && <SidePanel width={sideWidth} />}
```
Ctrl+\ 非 note 页：`App.tsx:73-75` 加 `if (active?.type !== "note") { message.info("侧栏仅在笔记页可用"); return; }`（需 `App.useApp()` 拿 message，依赖 M1 的 antd App 包裹）。

## M5 项目页设计

### 快速创建弹窗（4 模板）
`utils/projectTemplates.ts`：
- 空白项目：`# {name}\n\n> 一句话定位\n\n## 相关链接\n`
- 任务列表：`# {name}\n\n## 行动\n- [ ] 第一项 📅 {today}\n`
- OKR 项目：`# {name}\n\n## 目标 (O)\n- O1\n\n## 关键结果 (KR)\n- KR1\n\n## 行动\n- [ ] …\n`
- 知识库：`# {name}\n\n## 主题\n\n## 笔记\n`

弹窗字段：项目名 + 模板 Select + 状态 Select（复用 STATUS_OPTIONS）+ 优先级 Segmented（P0-P3→200/150/100/50）+ 主线 Switch + OKR Input + 负责人 Input + 父目录 Select（默认 01）。
写回：拼 `rel_path` + frontmatter + 模板正文 → `createNote`（零新命令）。

### 多视图（5 视图，Segmented）
- **看板**（现状保留）：按 status 分列，卡片 inline 改字段。
- **列表**（antd Table）：列 = 名称/状态 Tag/优先级/主线✓/OKR/负责人/最近活动，行点 → NoteEditorDrawer。
- **网格**（Row+Col+Card）：项目名（主线紫色左条）+ status Tag + priority P 标 + last_activity 相对时间。
- **进度**：调 `get_project_progress` → Card + Progress 条（done/total）+ 红色逾期角标。
- **负责人**：按 owner 分组（列表或网格形态）。

## M6 日历设计

- `cellRender` 加事件标题截断：单元格内列最多 2 条事件标题（截断），超 2 条 `+N` popover 列全部。
- `NewEventModal.tsx`（新组件）：标题 + DatePicker（默认选中日）+ TimePicker + 关联项目 Select + 备注 TextArea。
- 写回：`ensureDayNote(date)`（CalendarPage:110-123 已有）→ `appendBullet(noteId, "关键事件", buildEventBullet(...), false)` → `bumpTick()`。
- 日期格 hover `+` 按钮：cellRender 加 hover 显 `+`，onClick 触发 NewEventModal（预填该日期）。
- 移除右侧栏 `InlineAdd`（换 Modal；InlineAdd 组件保留不删）。

## M7 日志设计

`utils/journalTemplates.ts`（4 模板，单一源）：
| 模板 | note_type | frontmatter | 正文 section |
|---|---|---|---|
| daily | log | type,created,mood,energy | 今日待办/关键事件/复盘/明日寄语 |
| weekly | log | type,created,week_iso | 本周目标/完成情况/关键事件/下周计划 |
| monthly | experience | type,created,month_iso,highlights | 月度回顾/关键成就/反思/下月重点 |
| review | experience | type,created,review_type | 背景/做了什么/学到什么/下次改进 |

JournalPage：
- 「新建今日日志」按钮改 Dropdown（选模板）→ Modal（模板 + 日期 + 心情/精力）→ 拼 frontmatter + 正文 → `createNote`。
- 路径复用 `dayNoteRelPath`（周报加 `-周报` 后缀避免覆盖日报）。
- 顶部加筛选器：Segmented（全部/日报/经历）+ RangePicker + 标签 Select，纯前端 useMemo 过滤。

NoteFieldsForm 日志分支扩展（L127-143 段）：加 mood（Rate 5 星 emoji）/ energy（Slider 1-10）/ weather（AutoComplete 晴/阴/雨/雪）/ review_type（Select）/ 关联项目（Select 远程 getProjects），全经 `patchFrontmatter`/`setTag` 写回。
CalendarPage.ensureDayNote 复用 `journalTemplates.ts`（消除模板漂移）。

## 风险与降级

| 风险 | 应对 |
|---|---|
| **M1 dev 不生效** | Info.plist 只 release 生效；文档注明，验证用 `plutil -p` 查构建产物。dev 模式右键英文是 macOS 行为，非 bug。 |
| **M3 DB 迁移** | 幂等（PRAGMA table_info 查列再 ALTER），新库 CREATE 自带列不 ALTER（避免报错）；旧数据 done=1 反填 status=done。 |
| **M3 dnd-kit + 大量任务** | 看板/四象限默认 limit=500 + 限高；@dnd-kit 与虚拟列表配合复杂，本期先用 limit 截断，虚拟化入 backlog。 |
| **M3 dnd-kit 构建失败** | 修 2 轮仍红则拖拽入 backlog（4 视图保留，拖拽改状态退化为点击切换）。 |
| **M5 进度聚合性能** | get_project_progress 用 SQL JOIN tasks by project_id 聚合（tasks.project_id 已有列），1.9 万笔记下项目数通常 <100，安全。 |
| **写 vault 竞态** | set_task_* 三命令复用 save_note_content_inner 收口（读盘完整文件 → body 改行 → reassemble → 备份 + 重索引），与 toggle_task/update_line 同模型。 |
| **content_hash 变 id** | 改 bullet 内容 → content_hash 变 → note id 变（save 继承行为）；测试用 file_name 重查当前 id（memory 教训）。 |
