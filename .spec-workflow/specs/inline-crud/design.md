# inline-crud · Design

> 在不破坏 vault 原文铁律的前提下，给 5 页加就地增删改查。核心策略：所有写入复用 `save_note_content_inner` 收口（备份+写盘+增量索引），新命令只负责"改 raw_content 字符串"。

## Code Reuse Analysis（复用现有代码，不重造）

| 复用资产 | 位置 | 用途 |
|---|---|---|
| `save_note_content_inner(note_id, content, db)` | `commands/library.rs:262` | **所有新命令的总收口**：拼好新 raw → 调它，自带 `.helmose/backup` 备份 + 写盘 + `incremental::upsert_rel` 重索引。返回新 NoteContent（新 id）。 |
| toggle_task 的拆行模式 | `commands/library.rs:351-368` | `lines()` + `idx = source_line - 1` + `join("\n")` + 补尾 `\n` → update_line / delete_line 的现成骨架。 |
| `create_note_inner` 路径安全三件套 | `commands/library.rs:437-447` | `split('/').any(=="..")` + `is_excluded_rel` + `abs.exists()` —— 新命令涉及 note_id→路径转换时复用安全校验。 |
| `vault_root(vault_id, db)` | `commands/library.rs:28` | vault root 解析。 |
| `db.sqlite().transaction/query_map/query_row/execute` | `services/database_sqlite.rs` | 统一 DB 访问 API，新命令直接用。 |
| events/tasks INSERT SQL 片段 | `incremental.rs:162-176`(tasks) / `:236-252`(events) | source_line 改造时照抄列清单加一列。 |
| 前端 `NoteEditor` 组件 | `components/NoteEditor.tsx` | 抽屉内嵌编辑器直接复用（已支持 Cmd+S + 暗色 + marked 预览）。 |
| 前端 `useVaultStore.index()` | `stores/vault.ts` | 写入后触发刷新的既有约定。 |
| 前端 `utils/note.ts::openOrCreateTodayNote` | `utils/note.ts` | 新建笔记的模式参考（改为不跳 tab，开抽屉）。 |

**确认无现成资产、需新写**：
- 行级通用写入（update_line / delete_line / append_bullet）—— toggle 写死 checkbox，非通用。
- frontmatter patch —— `gray_matter` 全仓仅用于解析（`frontmatter.rs:14-27`），无序列化代码。
- events 的 source_line —— `sections::split_sections` 丢弃标题行号，events/tasks(section 通道) 都没行号。

## 架构概览

```
前端 5 页面（Tasks/Today/Calendar/Journal/Projects）
  ├─ 短条目（task/event/项目字段）→ InlineEdit / InlineAdd / 行内 Select·Switch
  └─ 长文（日志/今日笔记）→ NoteEditorDrawer（antd Drawer + 复用 NoteEditor）
        │  invoke（camelCase 入参）
        ▼
Tauri 命令层（commands/library.rs 新增 5 命令，每命令 = 壳 + *_inner 核心）
  append_bullet / update_line / delete_line / patch_frontmatter / set_tag
        │  改 raw_content 字符串
        ▼
save_note_content_inner（既有总收口）
  → 备份 .helmose/backup/{rel}.{ts}.md
  → std::fs::write 整篇
  → incremental::upsert_rel（事务内重建 notes/FTS/tasks/events/projects/links/tomorrow）
  → 返回新 NoteContent（content_hash 变 → 新 id）
```

**前置依赖**：events source_line 改造（否则 event 无法 update_line/delete_line 定位）。

## 后端命令设计（5 个新命令）

全部遵循「命令壳 `#[tauri::command]` 解 `State<Database>` + `xxx_inner(..., db: &Database) -> Result<NoteContent>` 可被集成测试直接调」双层结构（与 toggle_task 一致）。全部在 `main.rs:42` 的 `generate_handler!` 注册。

### 1. `append_bullet(note_id, section, text, as_task) -> NoteContent`
向指定 section 末尾追加一条 bullet。
- `as_task=true` → 追加 `- [ ] {text}`；`false` → 追加 `- {text}`（事件）。
- **section 末尾定位算法**（新写工具 `section_end_line(raw, section) -> Option<usize>`）：
  1. 按行扫，找匹配 `^#{1,6}\s*{section}$` 的标题行 `H`（含 `## 今日待办` / `## 关键事件` 等，支持 `#` 数量 1-6）。
  2. 从 `H+1` 向下，到下一个 `^#{1,6}\s` 标题（同级或更浅，即 `#` 数 ≤ 当前）或文件末尾。
  3. 在该范围内找最后一条非空行 `L`，插入位置 = `L+1`；范围全空则插在标题行后一行。
- 找不到 section → Err `未找到 section: {section}`（前端可先 create_note 建 section，或降级追加到文件末尾——本期 Err）。
- 插入后调 `save_note_content_inner`。

### 2. `update_line(note_id, source_line, new_text) -> NoteContent`
- `idx = source_line - 1`；越界 Err（照搬 toggle 的越界检查）。
- `lines[idx] = new_text`（前端传完整新行内容，含 `- [ ]` 前缀由前端按场景拼）。
- 调 `save_note_content_inner`。

### 3. `delete_line(note_id, source_line) -> NoteContent`
- `idx = source_line - 1`；越界 Err。
- `lines.remove(idx)`。
- 调 `save_note_content_inner`（删前备份已由 save 链路完成，无需额外保护）。

### 4. `patch_frontmatter(note_id, key, value) -> NoteContent`
`value: serde_json::Value`（支持 string/number/bool）。改 frontmatter 指定键，保留其余原文。
- 定位 frontmatter 块：首行是 `---` → 找下一个 `---`，两行之间是 frontmatter；无 frontmatter 则 Err（项目笔记必有，由 scaffold 保证）。
- 块内逐行找 `^key:\s*(.*)$`：
  - 命中 → 替换为 `key: {serialized_value}`。
  - 未命中 → 在块末尾（第二个 `---` 前）插入 `key: {serialized_value}`。
- value 序列化（手写 `serialize_yaml_scalar`）：string → `"..."`（含特殊字符转义）；number/bool → `to_string`。
- 调 `save_note_content_inner`。
- 用于 AC-9（priority）。

### 5. `set_tag(note_id, tag_prefix, value: Option<String>) -> NoteContent`
操作 frontmatter `tags:` 数组（inline 格式 `tags: [a, b, c]`，scaffold 生成格式）。
- `tag_prefix` 如 `project-status` / `mainline` / `okr`。`value=Some("active")` → 确保存在 `project-status:active`（同前缀的旧值替换）；`value=None` → 删除该前缀所有 tag（mainline 关闭用 None + 精确 mainline）。
- 找 `tags:` 行 → 解析 inline 数组（`[` `]` 内 split `,` trim）→ 按前缀增删改 → 重写 `tags: [a, b, c]`。
- 找不到 `tags:` 行 → 在 frontmatter 块末尾插入 `tags: [{new_tag}]`。
- mainline 特殊：`mainline` 是无值 tag，`set_tag(note_id, "mainline", Some("mainline"))` = 加，`None` = 删（精确匹配，非前缀）。算法对"无值 tag"与"前缀:值 tag"分两路。
- 调 `save_note_content_inner`。
- 用于 AC-7（status）/ AC-8（mainline）。

## events source_line 改造（前置，6 处改动）

1. **`services/indexer/sections.rs`**：新增 `split_sections_with_lines(raw) -> Vec<SectionInfo>`，`SectionInfo { name, body, heading_line: usize }`（标题所在行号，1-based）。**保留旧 `split_sections`**（tasks.rs/tomorrow.rs 等不改，最小侵入）。
2. **`services/indexer/events.rs`**：`extract` 改用 `split_sections_with_lines`，body 逐行 `enumerate` 算全文行号 = `heading_line + 1 + offset`；`ExtractedEvent` 加 `source_line: Option<i32>`。
3. **`services/database.rs`**：SCHEMA 的 `events` CREATE TABLE 加 `source_line INTEGER NULL`（新库自带）+ `init_schema` 加幂等 migration：`PRAGMA table_info(events)` 不含 source_line 则 `ALTER TABLE events ADD COLUMN source_line INTEGER`（老库平滑升级，不需 reset）。
4. **`commands/index.rs:242`**（全量 events INSERT）+ **`incremental.rs:236`**（增量 events INSERT）：列清单加 source_line。
5. **`models/event.rs`**：`ExtractedEvent` + `Event` DTO 加 `source_line: Option<i32>`。
6. **`frontend/src/types/index.ts`**：`Event` 加 `source_line: number | null`。

> tasks 表已有 source_line（checkbox 通道），不改。tasks 的 section 通道（`extract_bullets`）仍无行号——本期 task 就地编辑仅支持 checkbox 通道的 task（有 source_line），section bullet 的 task 不支持就地编辑（前端按 `source_line != null` 判定可编辑性，已是现有约定）。

## frontmatter patch 风险与边界

- **只支持 inline array + 单行 key**（scaffold 生成格式）。block array（`tags:\n  - a`）解析失败时 **Err 提示「frontmatter tags 非-inline 格式，请手动编辑」**，不破坏原文（Non-Goals 已声明）。
- 保留 frontmatter 注释、键顺序、其余键值——只动目标行/数组。
- value 含特殊字符（冒号、引号、#）时字符串加引号转义。

## note_id 不稳定处理

content_hash 变 → note id 变。设计约定：
- 所有写命令返回新 `NoteContent`（含新 id）。
- 前端 `onSave(updated)` 回调用 `updated.id` 替换本地 note_id。
- **删除/编辑后列表整体 `refresh()`**（从后端重拉 tasks/events），因为删除一行后后续 source_line 移位，前端不能本地维护行号。勾选 toggle 同理（现有 toggle_task 已是这个模式）。

## 前端组件设计

### `components/InlineEdit.tsx`（可复用行内编辑）
- Props: `{ value, onSave: (newText) => Promise<void>, multiline?: boolean }`
- display 模式：显示文本，hover 显示编辑图标；点击 → edit 模式（antd `Input`/`Input.TextArea`）。
- edit 模式：回车提交（调 onSave）+ Esc 取消 + Shift+回车换行（multiline）。
- 保存中 loading 态；失败 message.error。

### `components/InlineAdd.tsx`（可复用行内新建）
- Props: `{ placeholder, onAdd: (text) => Promise<void> }`
- 一个 `Input` + 前缀 `Plus` 图标；回车提交 → 清空 → onAdd。
- 用于 task/event 顶部新建。

### `components/NoteEditorDrawer.tsx`（抽屉内嵌编辑器，不跳 tab）
- Props: `{ open, noteId, rawContent, onClose, onSaved }`
- antd `Drawer`（右侧，宽 ~60%）+ 内嵌现有 `NoteEditor`。
- 替代"跳 NoteView tab"的动线，日志/今日/日历点笔记时用。

### 5 页面接入
| 页面 | 短条目就地操作 | 长文操作 |
|---|---|---|
| TasksPage | 顶部 InlineAdd（新建 task，默认追加到今日笔记"今日待办"，可选目标 note）；每行 InlineEdit（改文本，仅 source_line≠null）+ 删除 Popconfirm + 勾选（已有） | 行点击 → NoteEditorDrawer |
| TodayPage | 今日事件 InlineEdit/删除 + InlineAdd 新建事件（追加今日笔记"关键事件"）；今日待办同 TasksPage | "今日笔记"按钮 → NoteEditorDrawer（替代跳 tab） |
| CalendarPage | 选中日期事件 InlineEdit/删除 + InlineAdd 新建事件 | 点笔记 → NoteEditorDrawer |
| JournalPage | （条目是整篇笔记，无行级） | 点笔记/"新建" → NoteEditorDrawer |
| ProjectsPage | 状态 `Select`（inline）→ set_tag；主线 `Switch` → set_tag；优先级 `InputNumber` → patch_frontmatter | 点项目 → NoteEditorDrawer |

## 性能红线遵守
- 所有就地编辑只涉及单篇 note（get_note_content / save_note_content_inner），不拉全量。
- 列表刷新复用现有 `useVaultStore.index()`（触发 useAllNotesMeta + 各页自己的 api 拉取），无新增全量调用。
- NoteEditorDrawer 只在打开时 get_note_content 一次。

## 测试策略
- 后端：每命令的 `*_inner` 写集成测试（参考 `toggle_task_inner` 测试在 library.rs:1239 模式），覆盖正常/越界/section 未找到/frontmatter 格式边界。events source_line 提取加单测。
- 前端：`pnpm build`（tsc 类型）+ 关键组件 vitest（InlineEdit 提交/取消）。dev 实测由用户在 tauri:dev 验。
- 客观裁判：每批改完跑 `cargo check` + `cargo test` + `pnpm build` 全绿才继续（守 1.9 万文件性能红线 + 防回归）。
