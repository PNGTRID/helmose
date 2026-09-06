# ux-overhaul · Tasks

> 本 spec：用户体验大升级（中文化右键根治 + 今日/项目/日志/日历快速创建弹窗 + 任务页完整升级 + 项目多视图 + 侧栏修复）。
> 性质：新功能开发（含写 vault，受控突破"原文只读"，沿用 .helmose/backup 备份；含 DB 迁移；含新依赖 @dnd-kit）。
> **执行顺序**：P0(后端数据层前置) → P1(中文化+侧栏独立) → P2(共享前端层) → P3-P6(各页接入) → P7(任务页视图,依赖P0) → P8(裁判收口)。后端是任务/项目视图的前置。
> **验证命令**：`cd src-tauri && cargo check` + `cd src-tauri && cargo test` + `cd frontend && pnpm build`（每批改完全绿才继续，防 1.9 万文件性能红线回归）。
> **铁律**：中文注释；返回值 snake_case；写 vault 一律经 `save_note_content_inner`/`append_bullet`/`create_note` 收口（备份+索引）；不一次拉多篇全文；taskId 用数字（工具要求）；DB 迁移幂等（PRAGMA table_info 查列再 ALTER）；改契约/常量后 grep 全依赖 + 跑全量 test。

## P0 · 后端数据层（M3/M5 前置，必须先做）

- [x] 1. [M3] Task 加 status/priority/urgency 字段 + DB 迁移 + indexer 解析
  - File: src-tauri/src/models/task.rs（Task 加 status:String/priority:i32/urgency:String）、src-tauri/src/services/database.rs（init_schema：新库 CREATE tasks 自带 3 列；旧库 PRAGMA table_info(tasks) 查列存在性，无则 ALTER ADD COLUMN status TEXT NOT NULL DEFAULT 'todo' / priority INTEGER NOT NULL DEFAULT 0 / urgency TEXT NOT NULL DEFAULT 'low' + UPDATE tasks SET status='done' WHERE done=1 反填）、src-tauri/src/services/indexer/tasks.rs（加 RE_STATUS/RE_PRIORITY/RE_URGENCY 正则 + split_status/split_priority/split_urgency，仿 split_due 提取+清理 text；ExtractedTask 加 3 字段）、src-tauri/src/commands/index.rs（全量 INSERT 加 3 列）、src-tauri/src/services/indexer/incremental.rs（增量 INSERT 加 3 列）、src-tauri/src/commands/tasks.rs（row_to_task 读新列）
  - 关键：vault 标记语法见 design「数据模型变更」表（status: `- [/]` 或 🔄=doing；priority: ⭐数 1-3；urgency: 🔥=high）；split_* 提取后必须从 text 清理标记（与 split_due 一致）；done 字段保留派生（done = status=='done'）
  - _Leverage: tasks.rs:38-48 split_due 提取+清理模式；projects.rs extract fm 读取模式；database.rs init_schema 现有 migration 机制_
  - _Requirements: AC-M3.1, AC-M3.2_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide to get the workflow guide then implement the task. Role: Rust 后端工程师。Task: 按 design「Task 加 3 字段」+「vault 标记语法」表落地 6 处改动：models/task.rs 加字段、database.rs 幂等 migration（PRAGMA 查列再 ALTER，新库 CREATE 自带列）、indexer/tasks.rs 加 3 个 split_* + 正则（完全对称 split_due）、全量+增量 INSERT 加列、row_to_task 读列。Restrictions: split_* 提取标记后必须清理 text（不能残留 ⭐/🔥/🔄 在 text 里）；migration 必须幂等（新库不能 ALTER 自带列）；done=1 反填 status='done'；中文注释；snake_case。Success: cargo check 绿 + cargo test 含 split_status/priority/urgency 单测（构造 `- [/] 任务 🔄 ⭐⭐ 🔥` 断言 status=doing/priority=2/urgency=high 且 text 被清理为"任务"）+ migration 幂等测试（重复调用不报错）。记 log（taskId=1）。_

- [x] 2. [M5] Project 加 owner 字段 + DB 迁移 + indexer extract
  - File: src-tauri/src/models/project.rs（Project 加 owner:Option<String>）、src-tauri/src/services/database.rs（projects 表 migration：PRAGMA 查 owner 列，无则 ALTER ADD COLUMN owner TEXT）、src-tauri/src/services/indexer/projects.rs（extract 加 `let owner = p.frontmatter.get("owner").and_then(|v| v.as_str()).map(str::to_string);`，填入 ProjectInfo）、src-tauri/src/commands/index.rs（全量 projects INSERT 加 owner 列）、src-tauri/src/services/indexer/incremental.rs（增量 projects INSERT 加列）、src-tauri/src/commands/projects.rs（row_to_project + SELECT 加 owner）
  - 关键：owner 是 per-note 字段（extract 内一行），无需全局 pass；frontmatter.owner 是字符串
  - _Leverage: projects.rs extract 现有 fm 读取（priority/mainline/okr 同位置）；tasks 字段迁移模式（task 1 刚做）_
  - _Requirements: AC-M5.2_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: Rust 后端。Task: Project 加 owner 字段（Option<String>），6 处改动：models/project.rs、database.rs 幂等 migration、indexer/projects.rs extract 加一行 fm.owner 读取、全量+增量 INSERT 加列、row_to_project + SELECT 加列。Restrictions: migration 幂等（PRAGMA 查列再 ALTER）；中文注释；snake_case。Success: cargo check 绿 + cargo test 含 owner 提取单测（frontmatter 含 owner: 张三 → Project.owner==Some("张三")；无 owner → None）+ get_projects 返回值含 owner。记 log（taskId=2）。_

- [x] 3. [M3] get_tasks 扩展过滤 + set_task_status/priority/urgency 三命令
  - File: src-tauri/src/commands/tasks.rs（get_tasks 加 status:Option<String>/project_id:Option<String>/priority_min:Option<i32> 参数 + SQL WHERE 拼接；新增 set_task_status/set_task_priority/set_task_urgency 三命令壳 + inner）、src-tauri/src/commands/library.rs（三命令 inner 复用 save_note_content_inner：set_task_status_inner 改 bullet 前缀 `[ ]`/`[/]`/`[x]` + 增删 🔄；set_task_priority_inner 按 priority 数补 ⭐；set_task_urgency_inner 增删 🔥）、src-tauri/main.rs（invoke_handler! 注册三命令）
  - 关键：三 inner 复用 toggle_task_inner 的拆行骨架（lines() + idx=source_line-1 + 越界检查 + join + 补尾\n）；改完调 save_note_content_inner 收口（备份+重索引）；source_line==null 时 Err（与就地编辑边界一致）；返回新 NoteContent
  - _Leverage: library.rs:351-368 toggle_task_inner 拆行骨架；save_note_content_inner 收口；tasks.rs:32-44 get_tasks 现有 SQL+排序_
  - _Requirements: AC-M3.3_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: Rust 后端。Task: get_tasks 加 3 过滤参数（status/project_id/priority_min，SQL WHERE 拼接）+ 新增 set_task_status/priority/urgency 三命令。Restrictions: 三 inner 复用 toggle_task_inner 拆行模式（lines+idx+越界+join）；写入一律经 save_note_content_inner（不自写 fs::write）；source_line==null Err「该任务不支持改状态（聚合 section）」；set_task_status 同步更新 done 派生字段（status=done→done=1）；中文注释；snake_case；命令入参 camelCase（Tauri 自动转）。Success: cargo test 含三命令集成测试（建笔记→set status=doing→断言 bullet 变 `- [/]` + raw_content 正确 + 返回新 id；set priority=2→bullet 补 ⭐⭐；越界/source_line null 报错）。记 log（taskId=3）。_

- [x] 4. [M5] get_project_progress 命令
  - File: src-tauri/src/commands/projects.rs（新增 get_project_progress(vault_id) -> Vec<ProjectProgress>：SQL JOIN/聚合 tasks by project_id 算 total/done/due_overdue）、src-tauri/src/models/project.rs（加 ProjectProgress { project_id, total, done, due_overdue } DTO）、src-tauri/main.rs（注册）
  - 关键：进度是运行时聚合（不入 frontmatter，不污染 vault）；SQL 用 tasks.project_id 现有列 GROUP BY；due_overdue = due_date<今天 且 status!=done 的计数
  - _Leverage: tasks 表 project_id 列已存在；projects.rs 现有 SQL 查询模式_
  - _Requirements: AC-M5.4_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: Rust 后端。Task: 新增 get_project_progress(vault_id) 命令，SQL 聚合 tasks by project_id 返回每个项目的 total/done/due_overdue。Restrictions: 进度纯运行时聚合（不写 frontmatter）；用 tasks.project_id GROUP BY；due_overdue = due_date<CURRENT_DATE 且 status!=done；中文注释；snake_case。Success: cargo test 含进度聚合测试（建 2 项目+若干任务→断言 total/done 计数正确）。记 log（taskId=4）。_

- [x] 5. 前端 types + api 对齐新字段/新命令
  - File: frontend/src/types/index.ts（Task 加 status/priority/urgency；Project 加 owner；加 ProjectProgress 类型）、frontend/src/api/index.ts（getTasks 加过滤参数；加 setTaskStatus/setTaskPriority/setTaskUrgency/getProjectProgress 四 invoke 封装，camelCase 入参）
  - 关键：invoke 第二参 camelCase；返回类型严格对齐 Rust serde（snake_case 字段）
  - _Leverage: 现有 saveNoteContent/toggleTask/appendBullet 封装模式_
  - _Requirements: AC-M3.3, AC-M5.4_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 TS。Task: types/index.ts 给 Task 加 status:String/priority:number/urgency:String，Project 加 owner:string|null，加 ProjectProgress 接口；api/index.ts getTasks 加过滤参数（status/projectId/priorityMin），加 setTaskStatus/setTaskPriority/setTaskUrgency/getProjectProgress 四封装。Restrictions: 不改后端；返回类型对齐 Rust（snake_case）；camelCase 入参。Success: pnpm build 绿（tsc 类型过）。记 log（taskId=5）。_

## P1 · 中文化 + 侧栏（M1/M4，轻量独立）

- [x] 6. [M1] Info.plist 中文本地化 + main.tsx 包 antd App
  - File: src-tauri/Info.plist（新建：CFBundleDevelopmentRegion=zh-Hans + CFBundleLocalizations=[zh-Hans,en]）、frontend/src/main.tsx（ConfigProvider 内包 `<App as AntdApp>`，HashRouter/App 放 AntdApp 内）、frontend/src/components/SettingsPage.tsx（可选：加「关于本地化」说明区，提示菜单跟随系统语言/release 构建生效）
  - 关键：Info.plist 是 Tauri bundler 合并到生成结果（不覆盖必需字段）；dev 不生效（已知限制，须注释注明）；main.tsx 包 AntdApp 后现有 message.* 硬编码中文不受影响（保持），未来 Modal.confirm 经 App.useApp() 拿 context
  - _Leverage: main.tsx 现有 ConfigProvider 结构；antd 6 <App> 官方推荐（why-not-static）_
  - _Requirements: AC-M1.1, AC-M1.2, AC-M1.3_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 全栈。Task: ① 新建 src-tauri/Info.plist（XML plist，CFBundleDevelopmentRegion=zh-Hans + CFBundleLocalizations 数组 [zh-Hans, en]）；② main.tsx 把 HashRouter+App 包进 antd `<App>`（import { App as AntdApp }）放在 ConfigProvider 内。Restrictions: Info.plist 只放本地化字段（不碰 identifier/版本，bundler 会合并）；dev 不生效须在 Info.plist 顶部注释注明；现有 message.* 不改。Success: pnpm build 绿 + cargo check 绿（Info.plist 不影响编译但确认无语法错）；release 构建 plutil -p 查 CFBundleLocalizations 含 zh-Hans（构建验证留 task 22）。记 log（taskId=6，artifacts 用自由文本 Description 因非组件）。_

- [x] 7. [M4] 侧栏非 note 隐藏 + Ctrl+\ toast
  - File: frontend/src/App.tsx（L164-165 渲染条件加 `active?.type === "note"`；L73-75 Ctrl+\ 非 note 页改 message.info toast 不切换 sidePanelOpen）
  - 关键：resizer 同步加条件；message 需经 App.useApp() 拿（依赖 task 6 的 antd App 包裹）或用静态 message.info（现有模式，硬编码中文不影响）
  - _Leverage: App.tsx:165 现有 sidePanelOpen 条件；tabs.ts:108 toggleSide_
  - _Requirements: AC-M4.1, AC-M4.2_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: App.tsx 改两处：① SidePanel + resizer 渲染条件从 `sidePanelOpen` 改 `sidePanelOpen && active?.type === "note"`；② Ctrl+\ 快捷键在 active?.type!=="note" 时 message.info("侧栏仅在笔记页可用") 并 return（不 toggle）。Restrictions: tabs.ts toggleSide 全局语义保留不动；SidePanel 组件本身不改；中文注释。Success: pnpm build 绿 + 手动验证（切到 tasks 页侧栏消失，Ctrl+\ toast；切回 note 页侧栏按原 sidePanelOpen 显示）。记 log（taskId=7）。_

## P2 · 共享前端层（M2/M5/M7 共用，P3-P6 前置）

- [x] 8. utils/quickAdd.ts + journalTemplates.ts + projectTemplates.ts（纯函数 + 单测）
  - File: frontend/src/utils/quickAdd.ts（buildTaskBullet/buildEventBullet/buildProjectFrontmatter/slugify）、frontend/src/utils/journalTemplates.ts（daily/weekly/monthly/review 4 模板 + dayNoteRelPath 路径规则）、frontend/src/utils/projectTemplates.ts（空白/任务列表/OKR/知识库 4 模板）、frontend/src/utils/*.test.ts（vitest 单测）
  - 关键：buildTaskBullet 拼 `- [ ] {text} 📅 {due} 🏷️ {urgency} #project:{name}`（indexer 已识别 📅）；buildEventBullet 拼 `- HH:MM[-HH:MM] {title}（{note}）`；buildProjectFrontmatter 返回完整 md（含 frontmatter + 正文）；模板字符串与 design 一致
  - _Leverage: indexer tasks.rs 📅 due_date 解析约定；events.rs HH:MM 解析约定；projects.rs fm.priority/mainline/okr 解析_
  - _Requirements: AC-M2.5, AC-M7.4_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 TS。Task: 建 3 个纯函数 utils：quickAdd.ts（buildTaskBullet 拼待办 bullet 含 📅📅/🏷️urgency/#project；buildEventBullet 拼事件 bullet 含 HH:MM；buildProjectFrontmatter 拼项目 md 含 fm+正文；slugify 项目名→文件名）、journalTemplates.ts（4 日志模板 daily/weekly/monthly/review，含 fm+section）、projectTemplates.ts（4 项目模板）。Restrictions: 纯函数无副作用；bullet 格式严格对齐 indexer 解析约定（📅 YYYY-MM-DD、HH:MM 行首）；中文注释；co-located *.test.ts 单测（vitest）。Success: pnpm build 绿 + vitest 单测覆盖（buildTaskBullet 各参数组合、buildProjectFrontmatter 含 type:project、模板路径规则）。记 log（taskId=8）。_

- [x] 9. QuickAddTaskModal + QuickAddEventModal + QuickAddProjectModal + NewEventModal 组件
  - File: frontend/src/components/QuickAddTaskModal.tsx（Modal + TextArea + DatePicker + Segmented紧急程度 + Select项目）、QuickAddEventModal.tsx（Modal + Input标题 + 2×TimePicker + Checkbox时间段 + Select项目 + TextArea备注）、QuickAddProjectModal.tsx（Modal + Input名 + Select模板 + Select状态 + Segmented P0-P3 + Switch主线 + Input OKR + Input负责人 + Select父目录）、NewEventModal.tsx（日历复用：DatePicker + TimePicker + Select项目 + TextArea）、frontend/src/hooks/useActiveProjects.ts（拉 getProjects active 项共享数据源，cancelled flag 守竞态）
  - 关键：复用 utils/quickAdd.ts 拼装；项目 Select 用 showSearch optionFilterProp；紧急程度 Segmented 紧急/重要/一般/不急；onOk 调 appendBullet/createNote；props 含 open/onCancel/onSuccess
  - _Leverage: utils/quickAdd.ts（task 8）；antd Modal/DatePicker/TimePicker/Segmented/Select；useAllNotesMeta 的 cancelled flag 模式_
  - _Requirements: AC-M2.1, AC-M2.2, AC-M2.3, AC-M6.2_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: 建 4 个 Modal 组件（QuickAddTaskModal/QuickAddEventModal/QuickAddProjectModal/NewEventModal）+ useActiveProjects hook。每个 Modal props={open,onCancel,onSuccess}；表单字段见 design；onOk 调对应 API（appendBullet/createNote）。Restrictions: 复用 utils/quickAdd.ts 拼装（不自拼字符串）；useActiveProjects 加 cancelled flag 守竞态（memory 教训）；中文注释；项目 Select showSearch。Success: pnpm build 绿。记 log（taskId=9，components artifacts exports=["default"]）。_

## P3 · 今日页接入（M2）

- [x] 10. [M2] TodayPage 三卡片接弹窗
  - File: frontend/src/pages/TodayPage.tsx（待办卡片 L256-304 标题区加「+」按钮→QuickAddTaskModal；事件卡片 L307-360 移除 InlineAdd L319-323 换「+」按钮→QuickAddEventModal；项目卡片 L363-401 标题区加「+」按钮，onClick 必须 e.stopPropagation() 拦截整卡 onClick L374→QuickAddProjectModal；三弹窗 open state + onSuccess 调 refresh()）
  - 关键：项目卡片「+」按钮必须 stopPropagation（否则触发整卡跳项目页）；事件卡移除 InlineAdd 换 Modal（InlineAdd 组件保留不删）；onSuccess 后 refresh() 刷新数据
  - _Leverage: QuickAddTaskModal/EventModal/ProjectModal（task 9）；TodayPage 现有 refresh；InlineAdd_
  - _Requirements: AC-M2.1, AC-M2.2, AC-M2.3, AC-M2.4_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: TodayPage 三卡片各加「+」按钮接对应 QuickAdd Modal。Restrictions: 项目卡片「+」按钮 onClick 必须 e.stopPropagation()（整卡有 onClick 跳转）；事件卡移除 InlineAdd 换 Modal；onSuccess 调 refresh()；中文注释。Success: pnpm build 绿 + 手动验证（三弹窗能打开、填表提交后数据刷新、项目「+」不触发整卡跳转）。记 log（taskId=10）。_

## P4 · 项目页（M5）

- [x] 11. [M5] ProjectsPage 快速创建弹窗（4 模板）
  - File: frontend/src/pages/ProjectsPage.tsx（L76-99 createProject 改 Modal：项目名+模板 Select+状态+优先级+主线+OKR+负责人+父目录；移除 PROJECT_TEMPLATE L36-49 换 utils/projectTemplates.ts；拼 rel_path+frontmatter+模板正文→createNote；成功后 bumpTick+refresh，不自动开抽屉）
  - 关键：复用 utils/projectTemplates.ts + utils/quickAdd.ts buildProjectFrontmatter；createNote 零新命令；状态走 tag（project-status:*）；priority P0-P3→200/150/100/50
  - _Leverage: utils/projectTemplates.ts（task 8）；createNote；NoteFieldsForm STATUS_OPTIONS；ProjectsPage 现有 createProject/PROJECT_TEMPLATE_
  - _Requirements: AC-M5.1_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: ProjectsPage 新建项目改 Modal 一步到位（字段见 design M5），替换 PROJECT_TEMPLATE 为 utils/projectTemplates.ts。Restrictions: 复用 createNote（零新命令）；负责人写入 fm.owner；priority P0-P3 映射 200/150/100/50；状态走 project-status:* tag；成功后不自动开抽屉（弹窗已填完）；中文注释。Success: pnpm build 绿 + 手动验证（选不同模板创建→md 结构正确→列表刷新）。记 log（taskId=11）。_

- [x] 12. [M5] ProjectsPage 列表/网格视图
  - File: frontend/src/pages/ProjectsPage.tsx（顶部加 Segmented 视图切换 看板/列表/网格/进度/负责人；视图状态 localStorage 持久化）、frontend/src/components/projectViews/ListView.tsx（antd Table：名称/状态Tag/优先级/主线✓/OKR/负责人/最近活动）、GridView.tsx（Row+Col+Card：项目名+主线紫色左条+status Tag+priority P 标+last_activity 相对时间）
  - 关键：数据源复用 get_projects（一次拉取内存切视图）；行/卡片点击→NoteEditorDrawer；Segmented 切换不重新拉数据
  - _Leverage: utils/date.ts relativeTime；DataState 三态；ProjectsPage 现有看板视图_
  - _Requirements: AC-M5.3_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: ProjectsPage 加 Segmented 多视图切换（先做列表+网格，进度/负责人下个 task），数据源复用 get_projects。Restrictions: 一次拉取内存切视图（不重复 IPC）；中文注释；视图状态 localStorage。Success: pnpm build 绿 + 手动验证（看板/列表/网格切换正常，点击行/卡片开抽屉）。记 log（taskId=12）。_

- [x] 13. [M5] ProjectsPage 进度视图 + 负责人视图
  - File: frontend/src/components/projectViews/ProgressView.tsx（调 getProjectProgress→Card+Progress 条 done/total+逾期红色角标）、OwnerView.tsx（按 owner 分组：无 owner 归"未分配"，列表或网格形态）
  - 关键：进度视图调 get_project_progress（task 4）；负责人视图前端按 owner 分组（useMemo）；进度不入 frontmatter
  - _Leverage: getProjectProgress（task 4/5）；Project.owner（task 2/5）；GridView 卡片模式_
  - _Requirements: AC-M5.4, AC-M5.5_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: 建 ProgressView（调 getProjectProgress 显示完成率 Progress + 逾期角标）+ OwnerView（按 owner 分组）。接入 ProjectsPage Segmented。Restrictions: 进度纯展示不写 fm；中文注释。Success: pnpm build 绿 + 手动验证（进度条数值正确、负责人分组生效）。记 log（taskId=13）。_

## P5 · 日历页（M6）

- [x] 14. [M6] CalendarPage 事件折叠+N + 新建事件弹窗 + 日期格+
  - File: frontend/src/pages/CalendarPage.tsx（cellRender L189-215 加事件标题截断：单元格内列最多 2 条事件标题截断，超 2 条 +N popover 列全部；移除右侧栏 InlineAdd L242-247 换「新建事件」按钮→NewEventModal；单元格 hover 显「+」按钮 onClick 触发 NewEventModal 预填该日期；NewEventModal onSuccess 调 refresh）
  - 关键：复用 NewEventModal（task 9）；写回流 ensureDayNote→appendBullet；单元格 + 按钮 hover 显示（CSS）；移除 InlineAdd（组件保留）
  - _Leverage: NewEventModal（task 9）；CalendarPage ensureDayNote L110-123 + onAddEvent L137-147；antd Calendar cellRender；Popover_
  - _Requirements: AC-M6.1, AC-M6.2, AC-M6.3, AC-M6.4_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: CalendarPage 三优化：① cellRender 加事件标题截断 max 2 + +N popover；② 右侧栏 InlineAdd 换「新建事件」按钮→NewEventModal；③ 日期格 hover「+」按钮→NewEventModal 预填日期。Restrictions: 复用 ensureDayNote+appendBullet 写回（零新命令）；InlineAdd 组件保留不删；中文注释。Success: pnpm build 绿 + 手动验证（事件多时折叠+N、新建事件弹窗、日期格+按钮）。记 log（taskId=14）。_

## P6 · 日志页（M7）

- [x] 15. [M7] JournalPage 模板下拉 + Modal + 筛选器
  - File: frontend/src/pages/JournalPage.tsx（L24-127「新建今日日志」按钮改 Dropdown 选模板 daily/weekly/monthly/review→Modal 含模板+日期+心情/精力[daily]；onOk 拼 utils/journalTemplates.ts → createNote；顶部加筛选器 Segmented 全部/日报/经历 + RangePicker + 标签 Select，纯前端 useMemo 过滤；L41-51 groups useMemo 加筛选逻辑）
  - 关键：复用 utils/journalTemplates.ts（task 8）+ createNote（零新命令）；路径复用 dayNoteRelPath（周报加 -周报 后缀）；筛选纯前端（数据源 useAllNotesMeta 已全量内存）
  - _Leverage: utils/journalTemplates.ts（task 8）；createNote；useAllNotesMeta；getTagsStats_
  - _Requirements: AC-M7.1, AC-M7.2, AC-M7.4_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: JournalPage 新建改 Dropdown 选模板→Modal→createNote；顶部加筛选器（type Segmented+RangePicker+标签）。Restrictions: 复用 utils/journalTemplates.ts + createNote；筛选纯前端 useMemo（无 IPC）；周报路径加 -周报 后缀避免覆盖日报；中文注释。Success: pnpm build 绿 + 手动验证（选模板创建日志结构正确、筛选生效）。记 log（taskId=15）。_

- [x] 16. [M7] NoteFieldsForm 日志分支扩展
  - File: frontend/src/components/NoteFieldsForm.tsx（L127-143 日志分支加：心情 Rate 5 星 emoji + 精力 Slider 1-10 + 天气 AutoComplete 晴/阴/雨/雪 + 复盘类型 Select + 关联项目 Select 远程 getProjects；全经 patchFrontmatter/setTag 写回）、frontend/src/pages/CalendarPage.tsx（ensureDayNote L114-119 复用 utils/journalTemplates.ts 消除模板漂移）
  - 关键：字段写回经现有 patchFrontmatter（mood/energy/weather）+ setTag（review-type/project）；关联项目从 getProjects 拉
  - _Leverage: NoteFieldsForm 现有 patchFrontmatter/setTag 写回模式；useActiveProjects（task 9）_
  - _Requirements: AC-M7.3, AC-M7.4_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: NoteFieldsForm 日志分支扩展 5 字段（mood Rate/energy Slider/weather AutoComplete/review_type Select/关联项目 Select）经 patchFrontmatter/setTag 写回；CalendarPage ensureDayNote 复用 journalTemplates.ts。Restrictions: 不动后端；写回经现有 patchFrontmatter/setTag；中文注释。Success: pnpm build 绿 + 手动验证（日志抽屉字段改了写回 fm/tag 正确）。记 log（taskId=16）。_

## P7 · 任务页视图 + 拖拽（M3 前端，依赖 P0）

- [x] 17. [M3] 引入 @dnd-kit + taskView store + TaskForm 升级
  - File: frontend/package.json（加 @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities）、frontend/src/stores/taskView.ts（Zustand：view:'list'|'kanban'|'matrix' + groupBy + localStorage 持久化）、frontend/src/components/TaskForm.tsx（升级 InlineAdd 为参数表单：文本 TextArea + DatePicker + Segmented priority + Select project + Segmented status；onSubmit 调 appendBullet）
  - 关键：@dnd-kit 用 pnpm 装（本机 npm 坏，memory 教训）；taskView store 仿 tabs.ts/theme.ts localStorage 模式；TaskForm 替换 TasksPage 现有 InlineAdd
  - _Leverage: stores/tabs.ts/theme.ts Zustand+localStorage 模式；InlineAdd 现有_
  - _Requirements: AC-M3.4, AC-M3.7_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: ① pnpm 装 @dnd-kit/core+sortable+utilities；② 建 stores/taskView.ts（view/groupBy+localStorage）；③ 建 TaskForm（参数表单替换 InlineAdd）。Restrictions: 用 pnpm 装（本机 npm 坏）；中文注释；TaskForm 复用 appendBullet 写回。Success: pnpm install 成功（node_modules/.bin 完整）+ pnpm build 绿。记 log（taskId=17）。_

- [x] 18. [M3] TaskCard + ListView（多分组维度）
  - File: frontend/src/components/tasks/TaskCard.tsx（统一卡片：checkbox+文本+due_date Tag+⭐priority+🔄status+来源 Tag；useDraggable 包装）、ListView.tsx（抽出 TasksPage dueGroups + 多分组维度 Segmented 按到期日/项目/状态/优先级；组可折叠）
  - 关键：TaskCard 是所有视图共享单元；ListView 分组用 useMemo；checkbox 调 toggleTask
  - _Leverage: TasksPage 现有 dueGroups L27-59；toggleTask；@dnd-kit useDraggable_
  - _Requirements: AC-M3.4_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: 建 TaskCard（统一卡片+useDraggable 包装）+ ListView（多分组维度 Segmented，抽出 dueGroups）。Restrictions: 复用 toggleTask；中文注释；分组用 useMemo。Success: pnpm build 绿。记 log（taskId=18）。_

- [x] 19. [M3] KanbanView（三列 + 跨列拖拽改 status）
  - File: frontend/src/components/tasks/KanbanView.tsx（DndContext + 3 列 Droppable：待办/进行中/已完成；列内 useSortable 排序；跨列拖→onDragEnd 调 setTaskStatus；optimistic update 先改前端→失败 message.error+revert）
  - 关键：跨列拖是核心（用户痛点"拖拽移动到未完成/进行中/已完成"）；source_line==null 的任务卡片禁用拖拽（提示不支持）
  - _Leverage: setTaskStatus（task 3/5）；TaskCard（task 18）；@dnd-kit DndContext+useDroppable_
  - _Requirements: AC-M3.5, AC-M3.6_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: 建 KanbanView（DndContext + 3 列 Droppable，跨列拖→setTaskStatus，optimistic update+失败 revert）。Restrictions: source_line==null 卡片禁拖+提示；中文注释；拖拽失败 message.error+回滚。Success: pnpm build 绿 + 手动验证（跨列拖改 status 写回 vault、失败回滚）。记 log（taskId=19）。_

- [x] 20. [M3] MatrixView（四象限 + 拖拽改 priority/urgency）
  - File: frontend/src/components/tasks/MatrixView.tsx（2×2 网格 4 桶 Droppable：Q1重要+紧急/Q2重要不紧急/Q3紧急不重要/Q4都不；拖入 Q1/Q2→setTaskPriority≥2；拖入 Q1/Q3→setTaskUrgency high；urgency 派生模式拖入会加 🔥 固化）
  - 关键：重要=priority≥2，紧急=urgency==high；urgency 派生（无 🔥 按 due_date 推导）拖入高紧急象限会调 setTaskUrgency 加 🔥 固化
  - _Leverage: setTaskPriority/setTaskUrgency（task 3/5）；TaskCard（task 18）_
  - _Requirements: AC-M3.5, AC-M3.6_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: 建 MatrixView（2×2 四象限，拖入改 priority/urgency）。Restrictions: 重要=priority≥2，紧急=urgency==high；拖入高紧急象限调 setTaskUrgency 加 🔥；source_line==null 禁拖；中文注释；失败回滚。Success: pnpm build 绿 + 手动验证（拖入不同象限改 priority/urgency 写回）。记 log（taskId=20）。_

- [x] 21. [M3] TasksPage 接入多视图 Segmented + urgency 派生
  - File: frontend/src/pages/TasksPage.tsx（顶部 Tabs 上方加 Segmented 视图切换 list/kanban/matrix 读 taskView store；按 view 渲染 ListView/KanbanView/MatrixView；加 urgency 派生 useMemo：无 🔥 时 due_date≤今天=high/本周=mid/之后或无=low；保留现有 Drawer 预览源笔记）
  - 关键：一次 get_tasks 拉取内存切视图；urgency 派生只在前端（indexer 只解析手动 🔥，design 边界）；现有 InlineAdd 换 TaskForm
  - _Leverage: taskView store（task 17）；ListView/KanbanView/MatrixView（task 18-20）；TaskForm（task 17）；getTasks_
  - _Requirements: AC-M3.4, AC-M3.7_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 前端 React。Task: TasksPage 接入多视图 Segmented（list/kanban/matrix），加 urgency 派生 useMemo，InlineAdd 换 TaskForm。Restrictions: 一次拉取内存切视图（不重复 IPC）；urgency 派生只前端（手动 🔥 覆盖）；保留 Drawer；中文注释。Success: pnpm build 绿 + 手动验证（三视图切换、urgency 派生显示、TaskForm 参数选择）。记 log（taskId=21）。_

## P8 · 裁判收口

- [x] 22. 全量客观裁判 + warning 清理 + release 构建验证 M1
  - File: 全项目
  - 关键：cargo check + cargo test（含新单测）+ pnpm build 连续绿；清 cargo/ts 新 warning；release 构建验证 Info.plist（plutil -p 查 CFBundleLocalizations 含 zh-Hans）；手动冒烟（7 页快速创建 + 任务拖拽 + 侧栏 + 中文化）
  - _Leverage: 客观裁判补层_
  - _Requirements: 全 AC_
  - _Prompt: Implement the task for spec ux-overhaul, first run spec-workflow-guide. Role: 收口。Task: 跑全量客观裁判（cargo check + cargo test + pnpm build）到连续绿；清新 warning；release 构建验证 M1（plutil 查 Info.plist）；列手动冒烟清单。Restrictions: 不自动 git；warning 修到零或说明残留。Success: 三裁判连续绿 + release 构建产物 Info.plist 含 zh-Hans + 冒烟清单。记 log（taskId=22，自由文本 Description）。_

## 未列入本期（backlog）

- [ ] 时间线视图（任务第四视图，v2.1）
- [ ] 事件拖拽改日期 / 多日事件 / 周日历视图（日历高级）
- [ ] 看板拖拽改项目 status（项目拖拽）
- [ ] events.project_id 反查关联（event→project 映射）
- [ ] urgency indexer 派生（本期仅前端派生 + 手动 🔥 解析）
- [ ] 任务/项目多视图虚拟列表（dnd + 虚拟化，本期用 limit 截断）
- [ ] i18n 框架（react-i18next，中文单语无需）

## review 发现的 backlog（2026-07-01 六维审查，判非本期 scope）

- [ ] review·note_id 跨 vault 校验（写回命令加 vault_id 双键 WHERE；当前单 vault 无威胁，多 vault 支持时统一加）
- [ ] review·任务/项目卡片虚拟化（dnd + 虚拟列表配合复杂，本期 limit=500 截断 + Alert 提示缓解，1.9 万 vault 真实超量时再做）
- [ ] review·MatrixView 原子命令 set_task_quadrant(priority, urgency)（一次 IPC 一次写盘，避免串行两次中间态）
- [ ] review·NoteFieldsForm write() 抽 useNoteWriter hook（主组件 + LogFieldsForm 子组件重复，快速迭代技术债）
- [ ] review·EventFields 共享组件（QuickAddEventModal / NewEventModal 表单重复 ~70 行 JSX）
- [ ] review·library.rs 4 老函数（toggle_task / update_line / delete_line / append_bullet）迁移到 line_for_edit/save_lines 抽象（与 set_task_* 一致）
- [ ] review·createNote 路径冲突 UX（加「打开已存在」选项，非 message.error 了事）
- [ ] review·set_tag_inner split(',') 不防含逗号 tag（低危，当前 status 白名单不含逗号）
