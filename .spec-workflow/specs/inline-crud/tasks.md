# inline-crud · Tasks

> 本 spec：5 页（今日/日历/日志/任务/项目）就地增删改查，写回 vault。
> 性质：新功能开发（写 vault，受控突破"原文只读"铁律，沿用 .helmose/backup 备份保护）。
> 执行顺序：P0(source_line 前置) → P1(后端命令) → P2(前端组件) → P3(5 页接入) → P4(裁判收口)。后端命令是前端接入的前置。
> 验证命令：`cd src-tauri && cargo check` + `cd src-tauri && cargo test` + `cd frontend && pnpm build`（每批改完全绿才继续，防 1.9 万文件性能红线回归）。
> 铁律：中文注释；返回值 snake_case；写 vault 一律经 `save_note_content_inner` 收口（备份+索引）；不一次拉多篇全文；taskId 用数字（工具要求）。

## P0 · 前置（events source_line）

- [x] 1. events 表加 source_line + indexer 提取行号
  - File: src-tauri/src/services/indexer/sections.rs（新增 `split_sections_with_lines`，保留旧函数）、src-tauri/src/services/indexer/events.rs（extract 用新函数 + enumerate 算全文行号）、src-tauri/src/services/database.rs（SCHEMA events 加 `source_line INTEGER NULL` + init_schema 加幂等 migration：PRAGMA table_info 查无则 ALTER ADD COLUMN）、src-tauri/src/commands/index.rs（全量 events INSERT 加列）、src-tauri/src/services/indexer/incremental.rs（增量 events INSERT 加列）、src-tauri/src/models/event.rs（ExtractedEvent + Event 加 source_line: Option<i32>）、frontend/src/types/index.ts（Event 加 source_line: number|null）
  - 关键：行号 = heading_line + 1 + body_offset（1-based）；保留旧 split_sections 不动 tasks.rs/tomorrow.rs
  - _Leverage: tasks.rs:67-78 的 enumerate+`i as i32 + 1` 行号模式；incremental.rs:236 events INSERT 列清单_
  - _Requirements: AC-4_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide to get the workflow guide then implement the task. Role: Rust 后端工程师。Task: 按 design.md「events source_line 改造」6 处改动落地，让每条 event 记录原文行号。Restrictions: 保留旧 split_sections 函数（tasks.rs/tomorrow.rs 仍在用，不改它们）；migration 必须幂等（PRAGMA table_info 查列存在性再 ALTER，新库 CREATE 自带列不能 ALTER 报错）；中文注释；snake_case。_Leverage: 复用 tasks.rs 的 enumerate 行号模式。Success: cargo check 绿 + cargo test 含 events source_line 提取单测（构造带「关键事件」section 的笔记，断言提取的 source_line 指向正确行）。完成后在 tasks.md 把本 task `[ ]`→`[-]`→`[x]` 并调 log-implementation 记录（specName=inline-crud, taskId=1）。_

## P1 · 后端行级写入命令（commands/library.rs）

- [x] 2. update_line + delete_line（通用行级写入）
  - File: src-tauri/src/commands/library.rs（新增 update_line_inner/delete_line_inner + 命令壳）、src-tauri/main.rs（generate_handler 注册）
  - 关键：复用 toggle_task_inner 的拆行模式（lines() + idx=source_line-1 + 越界检查 + join + 补尾\n），update 改 `lines[idx]=new_text`，delete 用 `lines.remove(idx)`，末尾都调 save_note_content_inner 收口
  - _Leverage: toggle_task_inner (library.rs:351-368) 拆行骨架；save_note_content_inner 收口_
  - _Requirements: AC-2, AC-3, AC-6_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: Rust 后端。Task: 按 design 实现通用 update_line(note_id, source_line, new_text) 和 delete_line(note_id, source_line)，壳+inner 双层（参考 toggle_task 模式）。Restrictions: source_line 越界 Err（照搬 toggle 的越界报错文案格式）；写入一律经 save_note_content_inner（不自写 fs::write）；中文注释。Success: cargo test 含 update_line/delete_line 集成测试（建笔记→改/删指定行→断言 raw_content 正确 + 返回新 NoteContent + 新 id）。记 log（taskId=2）。_

- [x] 3. append_bullet + section 末尾定位
  - File: src-tauri/src/commands/library.rs（新增 section_end_line 工具 + append_bullet_inner + 命令壳）、src-tauri/main.rs（注册）
  - 关键：section_end_line(raw, section) 找 `^#{1,6}\s*{section}$` 标题行，向下到同级/更浅标题或文末，返回最后非空行 +1；append_bullet(note_id, section, text, as_task) 拼接 `- [ ] {text}`(task) 或 `- {text}`(event)，在定位处插入，调 save_note_content_inner
  - _Leverage: save_note_content_inner 收口；vault_root/vault 路径解析_
  - _Requirements: AC-1, AC-5_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: Rust 后端。Task: 按 design「append_bullet」+「section 末尾定位算法」实现。Restrictions: section 未找到时 Err（文案「未找到 section: {section}」），不静默追加到文末；标题匹配支持 1-6 个 # + section 名（「今日待办」「关键事件」等）；中文注释。Success: cargo test 覆盖（追加到中间 section / 追加到末尾 section / section 不存在 Err / as_task 真=假两种 bullet 格式）。记 log（taskId=3）。_

- [x] 4. patch_frontmatter + set_tag（frontmatter/tags 行级编辑）
  - File: src-tauri/src/commands/library.rs（新增 serialize_yaml_scalar + patch_frontmatter_inner + set_tag_inner + 命令壳）、src-tauri/main.rs（注册）
  - 关键：patch_frontmatter(note_id, key, value: serde_json::Value) 定位 `---\n...\n---\n` 块内 `^key:` 行替换/插入；set_tag(note_id, tag_prefix, value: Option<String>) 操作 inline `tags: [a,b]` 数组（前缀:值替换 / 无值 tag 增删）；都调 save_note_content_inner；block-array 格式 Err 提示手动编辑
  - _Leverage: save_note_content_inner；gray_matter 仅用于校验 frontmatter 存在（不序列化）_
  - _Requirements: AC-7, AC-8, AC-9_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: Rust 后端。Task: 按 design「frontmatter patch 风险与边界」实现。Restrictions: 只支持 inline array + 单行 key（scaffold 格式）；block-array/无 frontmatter 时 Err 不破坏原文；保留其余键顺序与注释；string 值加引号转义冒号/引号/#；中文注释。Success: cargo test 覆盖（改 priority / 替换 project-status / 切换 mainline / 插入不存在的 key / tags 行不存在时新建 / block-array 报错）。记 log（taskId=4）。_

- [x] 5. 前端 api/index.ts 封装 5 命令 + types 对齐
  - File: frontend/src/api/index.ts（appendBullet/updateLine/deleteLine/patchFrontmatter/setTag 五个 invoke 封装，camelCase 入参）、frontend/src/types/index.ts（按需补类型）
  - 关键：invoke 第二参 camelCase（appendBullet({noteId, section, text, asTask})）；返回 NoteContent
  - _Leverage: 现有 saveNoteContent/toggleTask 封装模式_
  - _Requirements: AC-11_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: 前端 TS。Task: 给 5 个新后端命令加 invoke 封装（参考现有 saveNoteContent 写法），入参 camelCase。Restrictions: 不改后端；返回类型对齐 NoteContent。Success: pnpm build 绿（tsc 类型过）。记 log（taskId=5）。_

## P2 · 前端可复用组件

- [x] 6. InlineEdit + InlineAdd 组件
  - File: frontend/src/components/InlineEdit.tsx、frontend/src/components/InlineAdd.tsx（+ 可选 InlineEdit.css 或复用现有 CSS 变量）
  - 关键：InlineEdit display→edit 切换（antd Input/TextArea，回车提交 onSave、Esc 取消、loading 态）；InlineAdd 单输入框 + Plus 图标 + 回车 onAdd 清空
  - _Leverage: antd Input/Props；stores 无需（纯展示组件，状态自持）_
  - _Requirements: AC-13_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: 前端 React。Task: 按 design「前端组件设计」实现两个可复用组件。Restrictions: 纯展示组件（数据/保存逻辑由父组件通过 props 注入）；守竞态（保存中禁用提交）；中文注释；样式用现有 CSS 变量（var(--ob-*)）适配暗色。Success: pnpm build 绿 + InlineEdit 提交/取消交互正确（dev 验）。记 log（taskId=6，components artifact exports=["default"]）。_

- [x] 7. NoteEditorDrawer（抽屉内嵌 CodeMirror，不跳 tab）
  - File: frontend/src/components/NoteEditorDrawer.tsx
  - 关键:antd Drawer（右侧宽 60%）+ 挂载时 get_note_content 取全文 + 内嵌现有 NoteEditor；onSaved 回调触发 useVaultStore.index() 刷新
  - _Leverage: NoteEditor（已支持 Cmd+S + 暗色 + marked 预览）；api.getNoteContent；useVaultStore.index()_
  - _Requirements: AC-10, AC-13_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: 前端 React。Task: 按 design 实现 NoteEditorDrawer（打开时拉单篇全文 → NoteEditor 编辑 → 保存走 saveNoteContent → onSaved 触发 index 刷新 + 用新 note_id）。Restrictions: 不跳 tab（用 Drawer 替代 openView/openNoteFromMeta）；单篇拉取不碰全量；中文注释。Success: pnpm build 绿。记 log（taskId=7，components artifact exports=["default"]）。_

## P3 · 5 页面接入

- [x] 8. TasksPage 就地新建/编辑/删除
  - File: frontend/src/pages/TasksPage.tsx
  - 关键：顶部 InlineAdd（新建 task，默认追加到今日笔记"今日待办" section，可下拉选目标 note）；每行 source_line≠null 的 task 加 InlineEdit（改文本→updateLine）+ 删除 Popconfirm（→deleteLine）+ 勾选（已有 toggleTask）；写后 refresh()
  - _Leverage: InlineEdit/InlineAdd (task 6)；updateLine/deleteLine/appendBullet (task 2/3/5)；useVaultStore.index()_
  - _Requirements: AC-1, AC-2, AC-3_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: 前端 React。Task: TasksPage 接入就地 CRUD。Restrictions: 仅 source_line≠null 的 task 可就地编辑（section bullet 类 task 保持只读，与现有约定一致）；删除需 Popconfirm 确认；写后用返回的新 note_id + refresh() 重拉列表（行号移位不可本地维护）；中文注释。Success: pnpm build 绿。记 log（taskId=8）。_

- [x] 9. TodayPage 事件+待办就地 CRUD + 今日笔记抽屉
  - File: frontend/src/pages/TodayPage.tsx
  - 关键：今日事件列表加 InlineEdit/删除（→updateLine/deleteLine，依赖 task 1 的 event.source_line）+ InlineAdd 新建事件（→appendBullet 追加今日笔记"关键事件"）；今日待办同 TasksPage；"今日笔记"按钮改开 NoteEditorDrawer（替代跳 tab）
  - _Leverage: InlineEdit/InlineAdd/NoteEditorDrawer；event.source_line (task 1)_
  - _Requirements: AC-5, AC-6, AC-10_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: 前端 React。Task: TodayPage 接入事件就地 CRUD + 今日笔记抽屉化。Restrictions: 依赖 task 1 的 event.source_line（先确认 task 1 完成）；写后 refresh()；中文注释。Success: pnpm build 绿。记 log（taskId=9）。_

- [x] 10. CalendarPage 事件就地 CRUD + 笔记抽屉
  - File: frontend/src/pages/CalendarPage.tsx
  - 关键：选中日期的事件列表 InlineEdit/删除 + InlineAdd 新建事件（追加该日日志"关键事件"）；点笔记 → NoteEditorDrawer（替代 openNoteFromMeta 跳转）
  - _Leverage: InlineEdit/InlineAdd/NoteEditorDrawer；event.source_line；createNote（已硬编码路径，新建日志沿用）_
  - _Requirements: AC-5, AC-6, AC-10_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: 前端 React。Task: CalendarPage 接入。Restrictions: 新建事件目标日志路径复用现有 createDayNote 的硬编码（07_决策与复盘/日志/YYYY-MM/YYYY-MM-DD.md）；点笔记开抽屉不跳 tab；中文注释。Success: pnpm build 绿。记 log（taskId=10）。_

- [x] 11. ProjectsPage 状态/主线/优先级就地编辑
  - File: frontend/src/pages/ProjectsPage.tsx
  - 关键：每项目卡加 inline antd Select（状态→setTag "project-status"）+ Switch（主线→setTag "mainline" None/Some）+ InputNumber（优先级→patchFrontmatter "priority"）；写后 refresh()
  - _Leverage: setTag/patchFrontmatter (task 4/5)；getProjects_
  - _Requirements: AC-7, AC-8, AC-9_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: 前端 React。Task: ProjectsPage 三字段就地编辑。Restrictions: 状态下拉枚举 active/pending/paused/completed/abandoned（与 projects indexer 读取的 project-status 值一致）；主线 Switch 勾=加 mainline tag 否则删；写后 refresh()；中文注释。Success: pnpm build 绿。记 log（taskId=11）。_

- [x] 12. JournalPage 抽屉编辑（替代跳转）
  - File: frontend/src/pages/JournalPage.tsx
  - 关键：点笔记 → NoteEditorDrawer（替代 openNoteFromMeta）；加"新建日志"按钮 → 复用 createNote 建 07_决策与复盘/日志 路径 + 开抽屉
  - _Leverage: NoteEditorDrawer；createNote_
  - _Requirements: AC-10_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: 前端 React。Task: JournalPage 点笔记/新建改走 NoteEditorDrawer（不跳 tab）。Restrictions: 新建日志路径与模板复用现有约定（07_决策与复盘/日志/YYYY-MM/YYYY-MM-DD.md + 日志模板）；中文注释。Success: pnpm build 绿。记 log（taskId=12）。_

## P4 · 裁判收口

- [x] 13. 全量客观裁判 + log 收尾
  - File: （无新文件，验证 + 补 log）
  - 关键：cargo check + cargo test（含新单测）+ pnpm build 全绿；补齐 task 1-12 的 log-implementation（如有遗漏）；dev 模式由用户实测 CodeMirror bug 已修 + 就地 CRUD 动线
  - _Leverage: 全 spec 改动_
  - _Requirements: AC-11, AC-12, AC-13, AC-14_
  - _Prompt: Implement the task for spec inline-crud, first run spec-workflow-guide. Role: 验证工程师。Task: 跑全量客观裁判（cd src-tauri && cargo check && cargo test；cd frontend && pnpm build），红则修到绿；核对 task 1-12 都有 log-implementation 记录。Restrictions: 不加新功能；遗留问题入 backlog。Success: 三件套全绿 + log 齐全。记 log（taskId=13）。_

## backlog（本期不做，防 scope creep）

- AI 教练层（主线判定/每日建议/明日一句）—— v0.2。
- 行级 undo（从 .helmose/backup 恢复单条 task/event）—— 备份按整篇存。
- frontmatter 任意键可视化编辑器——只做项目 status/mainline/priority。
- frontmatter block-array tags 编辑——只支持 inline 格式，block 报错提示手动编辑。
- 跨笔记移动 task/event。
- entities 表 dangling 清理（删 note 的已知小坑）。
- 事件"勾选完成"的专用语义（本期用 update_line 改 bullet 文本加 ✅ 实现，不单独做 toggle_event 命令）。
- task completed_at 填充（toggle 后仍 NULL，preexisting backlog）。
