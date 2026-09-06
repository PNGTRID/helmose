# inline-crud · Requirements

> 5 个核心页（今日/日历/日志/任务/项目）就地增删改查，改动映射回 vault 原文，不跳转到文档页。

## Alignment with Product Vision

Helmose 定位「人读 + Agent 读双导向的本地人生数据底座」（steering/product.md）。当前 5 个核心页均为**只读列表 + 跳转 NoteView 编辑**：任务页除勾选外不能就地改，事件页连勾选都做不到（缺 source_line），项目页字段只读，日志/今日的新建都跳 tab。这打断了"在上下文中即时修改"的心流。

本 spec 让用户在原页就地增删改查，改动**写回 vault markdown 原文**（唯一真相源），契合「直接读写 Obsidian 式 markdown vault」的核心定位，并为 v0.2 AI 教练层（自动建议/补全任务事件）铺路。

**对齐 tech.md 铁律**：
- vault 唯一真相源：所有就地编辑最终写回 md 文件，SQLite 派生缓存随之重索引。
- 「原文只读」铁律的**受控突破**：本 spec 明确授权"用户就地编辑动作触发写 vault"，沿用既有保护——`save_note_content` 的 `.helmose/backup/{rel}.{ts}.md` 备份 + `delete_note` 的 `.helmose/trash` 软删除。
- 性能红线：就地编辑只取/写**单篇**，绝不触碰全量列表（1.9 万 md）。

## User Stories

- **US-1**：作为用户，我想在任务页直接新建一条待办（输入文本回车），它被追加到今日笔记的"今日待办"section，不跳转。
- **US-2**：作为用户，我想就地编辑某条待办/事件的文字（点一下变输入框，回车保存到 vault）。
- **US-3**：作为用户，我想就地删除某条待办/事件（删 vault 原文那一行，删前已自动备份）。
- **US-4**：作为用户，我想在日历/今日页就地新建事件，追加到当天日志的"关键事件"section。
- **US-5**：作为用户，我想就地勾选/取消事件（当前事件做不到，因为没记录原文行号）。
- **US-6**：作为用户，我想在项目页就地切换状态（active/paused/completed）、主线开关、优先级，映射到 frontmatter/tags。
- **US-7**：作为用户，我想在日志/今日页新建或打开笔记时，编辑器在**右侧抽屉**内嵌打开（不跳 tab），写完保存回 vault。
- **US-8**：作为用户，我期望就地编辑不破坏 vault 原文格式（有备份可恢复）。

## EARS Acceptance Criteria

### 任务就地 CRUD
- **AC-1**：WHEN 用户在任务页点"新建任务"输入文本回车 THEN 系统 SHALL `append_task` 将 `- [ ] {text}` 追加到目标笔记指定 section（默认"今日待办"）末尾，写回 vault + 备份 + 重索引 + 列表即时刷新。
- **AC-2**：WHEN 用户就地编辑某条 task 文本（行内输入框，回车提交）THEN 系统 SHALL `update_line(note_id, source_line, new_text)` 改写 vault 原文对应行，保存后用新 note_id 刷新。
- **AC-3**：WHEN 用户就地删除某条 task（Popconfirm 确认）THEN 系统 SHALL `delete_line(note_id, source_line)` 删除原文对应行（删前 save 链路已备份到 `.helmose/backup`）。

### 事件就地 CRUD（依赖 source_line 改造）
- **AC-4**：系统 SHALL 给 events 表增加 `source_line INTEGER` 列；indexer 提取事件时记录 bullet 在全文的行号，使每条 event 可定位原文行。
- **AC-5**：WHEN 用户在日历/今日页就地新建事件 THEN 系统 SHALL `append_event` 追加 bullet 到目标日志"关键事件"section。
- **AC-6**：WHEN 用户就地编辑/删除/勾选某条 event THEN 系统 SHALL 按 `event.source_line` 调用 update_line/delete_line（勾选用 toggle 语义改 bullet 标记）。

### 项目就地编辑
- **AC-7**：WHEN 用户就地切换项目状态 THEN 系统 SHALL 改 vault frontmatter tags 里的 `project-status:<x>`（增删替换），保留 frontmatter 其余内容不破坏。
- **AC-8**：WHEN 用户就地切换主线开关 THEN 系统 SHALL 增删 `mainline` tag（或 frontmatter.mainline 布尔）。
- **AC-9**：WHEN 用户就地改优先级 THEN 系统 SHALL 改写 frontmatter `priority:` 行。

### 日志/今日长文就地编辑
- **AC-10**：WHEN 用户在日志/今日页点"新建笔记"或点开某篇 THEN 系统 SHALL 在右侧抽屉内嵌 CodeMirror 编辑器（复用 NoteEditor），不切 tab；保存走 `save_note_content`（带备份）。

### 通用约束
- **AC-11**：任何就地写入 SHALL 经 `save_note_content_inner` 收口（备份 + 增量索引）；写后返回新 `NoteContent`，前端用新 note_id 替换旧值（content_hash 变 → id 变）。
- **AC-12**：就地编辑 SHALL 不一次拉多篇全文（守性能红线）；仅单篇编辑时 `get_note_content`。
- **AC-13**：前端 SHALL 抽统一 `InlineEdit` / `InlineAdd` 可复用组件，5 页共用，不重复实现。
- **AC-14**：CodeMirror SHALL 不再报 "Unrecognized extension value in extension set"（vite `resolve.dedupe` 已修复，作为前置项验证）。

## Non-Goals（本期不做，防 scope creep）
- AI 教练层（主线判定 / 每日建议 / 明日一句）—— v0.2。
- 行级 undo（从 `.helmose/backup` 恢复单条 task/event）—— 备份按整篇存，行级恢复另案。
- frontmatter 任意键的可视化编辑器——只做项目 status/mainline/priority 三字段。
- 跨笔记移动 task/event。
- entities 表 dangling 清理（删 note 的已知小坑，另案）。
- frontmatter block-array 格式（`tags:\n  - a`）的 tags 编辑——仅支持 scaffold 生成的 inline 格式（`tags: [a, b]`），block 格式降级提示用户手动编辑。
