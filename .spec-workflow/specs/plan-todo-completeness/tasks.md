# Tasks Document · plan-todo-completeness（计划/TODO 完整性补齐）

> 性质：**全栈**（M1/M2/M4 含 Rust 后端 + M3 前端为主）。本模板为 Helmose 项目定制版。
> **本期只规划不执行**，所有 task 为 `[ ]`；`_Prompt` 写到执行时直接派 subagent 可用粒度。
> **执行顺序**：M1 数据层(1-6，前置) → M2 实用(7-12) 与 M3 日程(13-16) 可并行 → M4 AI 教练(17-22，依赖 M1 完整数据) → 裁判收口(23)。
>   · M1 是 M4 的输入前置（AI 需 OKR 进度才能判主线）；M1.3 移动感知相对独立可单做。
>   · M2.2/M2.3 共享 tasks 表加列（task 7 前置）；M3 全部依赖 @dnd-kit（已装）。
> **验证命令**：`cd src-tauri && cargo check` + `cd src-tauri && cargo test` + `cd frontend && pnpm build`（每批改完全绿才继续，防 1.9 万文件性能红线回归）。
> **铁律**：中文注释；返回值 snake_case；写 vault 一律经 `save_note_content_inner`/`append_bullet`/`update_line`/`create_note` 收口（备份+索引）；不一次拉多篇全文；taskId 用数字（工具要求）；DB 迁移幂等（PRAGMA table_info 查列再 ALTER）；改契约/常量后 grep 全依赖 + 跑全量 test；**OKR 解析不加新 type**（用 strategy/project + section 双条件）。

## M1 · 数据层补齐（后端前置，M4 依赖）

- [x] 1. OKR indexer 解析（services/indexer/okrs.rs）
  - File: `src-tauri/src/services/indexer/okrs.rs`（新建）、`src-tauri/src/services/indexer/mod.rs`（加 `pub mod okrs;` + parse_file 编排接入）、`src-tauri/src/services/indexer/sections.rs`（复用 split_sections_with_lines）
  - 实现要点：`pub fn extract(parsed: &ParsedNote) -> Vec<ExtractedOkr>`；识别条件 `fm.type∈{strategy,project} AND 含 section(目标|关键结果|KR|OKR|Key Results)`；objective 取 section 标题或首行；kr_text 取 bullet；target/current 用正则 `(\d+\.?\d*)\s*[万千亿]?` 配「目标/当前/达成」字样；priority 从 fm.priority 或默认 P2；quarter 从 fm.quarter 或标题 `YYYYQN`
  - Purpose: OKR 结构化提取（Req M1.1）
  - _Leverage: `indexer/projects.rs extract` 两层提取 + fm 读取；`sections::split_sections_with_lines`_
  - _Requirements: M1.1.1, M1.1.2, M1.1.4_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide to get the workflow guide then implement the task. Role: Rust indexer 工程师。Task: 新建 services/indexer/okrs.rs，extract() 纯函数从 strategy/project 文档提取 OKR/KR（条件：fm.type∈{strategy,project} + section 关键词），提 objective/kr_text/target_value/current_value/priority/quarter，接入 parse_file 编排（仿 projects/events 提取插入点）。Restrictions: 纯函数不写库；**不加 okr type**（用 strategy/project + section 双条件，memory 教训：改契约触发连锁）；解析失败留 NULL 不报错；中文注释。Success: cargo test 含 extract 单测（strategy 文档含 KR section→正确提取；无 KR section→空；type 非 strategy/project→空；target/current 数值正则）；cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=1，functions artifact）。_

- [x] 2. list_okrs 命令 + Okr DTO + 注册
  - File: `src-tauri/src/models/okr.rs`（新建 Okr DTO）、`src-tauri/src/models/mod.rs`（re-export）、`src-tauri/src/commands/okrs.rs`（新建 list_okrs）、`src-tauri/src/commands/mod.rs`（加 pub mod）、`src-tauri/src/commands/index.rs`（全量 INSERT okrs）、`src-tauri/src/main.rs`（注册）、`frontend/src/types/index.ts`（Okr 接口）、`frontend/src/api/index.ts`（listOkrs 封装）
  - 实现要点：Okr DTO 字段 snake_case 对齐 okrs 表；list_okrs(vault_id, quarter?) SQL 查询 ORDER BY quarter DESC, priority；index_vault 全量 INSERT okrs（仿 projects INSERT 点）；前端 types/api 对齐
  - Purpose: OKR 查询消费（Req M1.1）
  - _Leverage: `commands/projects.rs get_projects` SQL+排序模式；index.rs 现有 projects INSERT；前端 invoke 封装模式_
  - _Requirements: M1.1.3_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: 全栈。Task: models/okr.rs 建 Okr DTO（对齐 okrs 表，snake_case）；commands/okrs.rs 建 list_okrs(vault_id, quarter?)；index.rs 全量索引加 okrs INSERT pass；main.rs 注册；前端 types+api 对齐。Restrictions: DTO #[derive(Serialize)]；错误 .map_err(|e| e.to_string())?；quarter 可选过滤；中文注释。Success: cargo check 绿 + cargo test（建 strategy OKR 笔记→index→list_okrs 返回正确）+ pnpm build 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=2，apiEndpoints+functions）。_

- [x] 3. events.project_id indexer 填充
  - File: `src-tauri/src/services/indexer/events.rs`（提取时尝试填 project_id）、`src-tauri/src/commands/index.rs`（events.project_id 回填 pass，仿现有 tasks.project_id 回填 [index.rs:304-318]）、`src-tauri/src/commands/events.rs`（list_events 加 project_id 可选过滤参数）
  - 实现要点：事件 bullet 含 `#project:名` 或笔记 fm.project 非空 → 按名匹配 projects 表 id 填 events.project_id（列已存在）；list_events 加 project_id? 过滤
  - Purpose: 事件关联项目（Req M1.2）
  - _Leverage: index.rs 现有 tasks.project_id 回填函数（按 fm.project 名匹配）；events.rs 现有提取_
  - _Requirements: M1.2.1, M1.2.2, M1.2.3_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: Rust 后端。Task: events 提取时按 #project:标签 或 fm.project 匹配 projects 表填 events.project_id（列已存在，零 DDL）；index.rs 加 events.project_id 回填 pass（仿 tasks.project_id 回填点 [index.rs:304-318]）；list_events 加 project_id 可选过滤。Restrictions: 匹配失败留 NULL 不报错；中文注释；snake_case。Success: cargo test（事件 bullet 含 #project:X→project_id 正确填充；无匹配→NULL）+ cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=3）。_

- [x] 4. move_note / rename_note 命令（索引层，content_hash 识别）
  - File: `src-tauri/src/commands/move.rs`（新建）、`src-tauri/src/commands/mod.rs`、`src-tauri/src/main.rs`、`src-tauri/src/models/move.rs`（MoveResult/RefLoc DTO）
  - 实现要点：move_note(note_id, target_dir) 靠 content_hash 不变识别同一篇，更新 notes.rel_path + 反链 target_note_id（content_hash 重查）；grep 旧路径检测路径型引用（`[x](旧路径)` / `[[旧路径]]`）返回 refs_to_update；**绝不主动改 vault 原文**；rename_note 同理改 file_name + rel_path
  - Purpose: 移动感知·索引层（Req M1.3.1）
  - _Leverage: `content_hash`（indexer/mod.rs）；`get_backlinks/get_forward_links`；现有 note id 解析_
  - _Requirements: M1.3.1_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: Rust 后端。Task: commands/move.rs 建 move_note(note_id, target_dir)/rename_note，靠 content_hash 识别同一篇更新 notes.rel_path+反链 target_note_id，grep 检测路径型引用返回 refs_to_update 列表。Restrictions: **索引层操作，绝不主动改 vault 原文**（路径型引用更新走 task 5 二次授权）；content_hash 不变才识别为同一篇；中文注释；snake_case。Success: cargo test（移动笔记→rel_path 更新+反链 target_note_id 跟随+content_hash 不变；检测到 N 处路径型引用返回列表）+ cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=4）。_

- [x] 5. apply_ref_updates 命令（路径型引用授权更新）
  - File: `src-tauri/src/commands/move.rs`（apply_ref_updates）、`src-tauri/src/main.rs`
  - 实现要点：apply_ref_updates(ref_locations: Vec<RefLoc>) 用户授权后，对每处引用所在文档读盘→替换旧路径为新路径→save_note_content_inner 收口（备份+重索引）；RefLoc 含 note_id + line + old_path + new_path
  - Purpose: 移动后引用跟随·授权写（Req M1.3.2, M1.3.3）
  - _Leverage: `save_note_content_inner`（备份+索引）；library.rs update_line 拆行模式_
  - _Requirements: M1.3.2, M1.3.3_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: Rust 后端。Task: commands/move.rs 加 apply_ref_updates(Vec<RefLoc>)，用户授权后逐处读盘→替换路径→save_note_content_inner 收口。Restrictions: **必须经 save_note_content_inner**（备份 .helmose/backup + 重索引），不自写 fs::write；用户拒绝授权则不调本命令（前端控制）；中文注释。Success: cargo test（apply 后原文路径替换正确 + .helmose/backup 生成）+ cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=5）。_

- [x] 6. 前端移动/重命名右键菜单 + dangling 提示
  - File: `frontend/src/components/FilePanel.tsx`（文件树右键加「移动/重命名」→弹窗选目标目录→调 move_note→若 refs_to_update 非空弹确认→apply_ref_updates）、`frontend/src/components/SidePanel.tsx`（前向链 dangling 灰色「未解析」标识，调 get_forward_links 的 is_dangling 字段）
  - Purpose: 移动感知 UI + dangling 可见（Req M1.3）
  - _Leverage: FilePanel 现有文件树；SidePanel 现有前向链渲染；antd Modal 确认框_
  - _Requirements: M1.3.2, M1.3.3（dangling 部分）_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: 前端 React。Task: FilePanel 文件树右键加「移动/重命名」→弹窗→moveNote→refs 非空弹确认→applyRefUpdates；SidePanel 前向链 dangling（is_dangling=true）灰色「未解析」标识。Restrictions: 移动操作必须用户确认；dangling 只读提示不改原文；中文注释；snake_case 对齐后端。Success: pnpm build 绿 + 手动验证（移动笔记弹引用确认、dangling 灰显）。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=6，components exports=["default"]）。_

## M2 · 实用补齐（提醒 + 重复 + 子任务）

- [x] 7. tasks 加 repeat_rule + parent_task_id 列 + migration
  - File: `src-tauri/src/services/database.rs`（migrate 加两列：PRAGMA table_info(tasks) 查 repeat_rule/parent_task_id，无则 ALTER ADD COLUMN repeat_rule TEXT / parent_task_id TEXT）、`src-tauri/src/models/task.rs`（Task 加 repeat_rule:Option<String>/parent_task_id:Option<String>）
  - 实现要点：migration 仿 [database.rs:61-89] tasks.status/priority/urgency 模式；新库 SCHEMA 的 tasks 表自带两列；Task DTO 加两字段
  - Purpose: 重复/子任务数据基础（Req M2.2, M2.3）
  - _Leverage: database.rs 现有 tasks migration 模式_
  - _Requirements: M2.2.1, M2.3.1_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: Rust 后端。Task: database.rs migrate 给 tasks 加 repeat_rule TEXT + parent_task_id TEXT（PRAGMA 查列再 ALTER，仿 status/priority/urgency）；新库 SCHEMA tasks 自带两列；models/task.rs Task 加两 Option 字段。Restrictions: migration 幂等（新库不 ALTER 自带列）；中文注释；snake_case。Success: cargo test（migration 幂等：重复调用不报错）+ cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=7）。_

- [x] 8. indexer split_repeat + 子任务缩进解析
  - File: `src-tauri/src/services/indexer/tasks.rs`（加 split_repeat 正则提 `🔁\s*every\s+(\S+)` + 清理 text，完全对称 split_due；checkbox 通道 A 加缩进层级追踪：行首空格/tab 数，缩进>0 的 parent_task_id 指向最近非缩进任务，栈式匹配）、`src-tauri/src/commands/index.rs`（全量+增量 INSERT tasks 加 repeat_rule/parent_task_id）、`src-tauri/src/commands/tasks.rs`（row_to_task 读新列）
  - Purpose: 重复规则 + 子任务解析（Req M2.2.1, M2.3.1）
  - _Leverage: `tasks.rs split_due` 提取+清理模式；checkbox 通道 A 提取骨架_
  - _Requirements: M2.2.1, M2.2.3, M2.3.1_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: Rust indexer。Task: tasks.rs 加 split_repeat（正则提 🔁 every xxx + 清理 text，对称 split_due）；checkbox 通道 A 加缩进层级追踪算 parent_task_id；全量+增量 INSERT 加两列；row_to_task 读两列。Restrictions: split_repeat 提取后必须清理 text（不残留 🔁）；语法错（🔁 abc）返回 None 当普通任务；中文注释。Success: cargo test（`- [ ] 周报 🔁 every week`→repeat_rule=Some("week")+text="周报"；父+缩进子→parent_task_id 正确；多层缩进取最近父）+ cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=8）。_

- [x] 9. toggle_task 重复推进语义
  - File: `src-tauri/src/commands/library.rs`（toggle_task_inner 加分支：若 task.repeat_rule 非空，改语义为「按 rule 推进 due_date 到下一周期 + 保持 unchecked」，而非标 done；周期计算 day=+1d/week=+7d/month=+1月/weekday=下个该 weekday）、`src-tauri/src/utils/dates.rs`（加 add_period(date, rule) 辅助）
  - Purpose: 重复任务完成时自动续期（Req M2.2.2）
  - _Leverage: `toggle_task_inner` 拆行骨架；`utils::dates` 现有日期函数_
  - _Requirements: M2.2.2_
  - _Prompt: Implement the task for spec plan todo-completeness, first run spec-workflow-guide. Role: Rust 后端。Task: toggle_task_inner 加分支——task.repeat_rule 非空时推进 due_date（day/week/month/weekday 规则）+ 保持 unchecked（不改 [ ]→[x]）；utils/dates.rs 加 add_period 辅助。Restrictions: 推进后 due_date 写回 bullet（改 📅 标记）；走 save_note_content_inner 收口；无 due_date 的重复任务推进时用今天为基准；中文注释。Success: cargo test（带 🔁 every week + due 的任务 toggle→due 推进 7 天+仍 [ ]）+ cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=9）。_

- [x] 10. reminders 表 + tauri-plugin-notification 依赖
  - File: `src-tauri/Cargo.toml`（加 tauri-plugin-notification）、`src-tauri/tauri.conf.json`（plugins 注册 notification）、`src-tauri/src/services/database.rs`（SCHEMA 加 reminders 表 + idx_reminders_at）、`src-tauri/src/models/reminder.rs`（Reminder DTO）、`src-tauri/src/models/mod.rs`、`src-tauri/src/lib.rs`（plugin 注册 .builder().plugin(tauri_plugin_notification::init())）
  - 实现要点：用 pnpm/cargo 装依赖（注意本机 npm 坏，cargo 装不受影响）；reminders 表 schema 见 design；Reminder DTO 对齐
  - Purpose: 提醒数据层 + 通知能力（Req M2.1）
  - _Leverage: tauri-plugin-updater 接入先例（app-polish task）；SCHEMA 新表模式_
  - _Requirements: M2.1.1_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: Rust 后端。Task: Cargo.toml 加 tauri-plugin-notification；tauri.conf.json 注册；lib.rs plugin init；database.rs SCHEMA 加 reminders 表（id/task_id/note_id/vault_id/remind_at/fired/task_text/due_date/created_at + idx_reminders_at）；models/reminder.rs 建 Reminder DTO。Restrictions: 新表 CREATE TABLE IF NOT EXISTS（幂等）；DTO snake_case；中文注释。Success: cargo check 绿（plugin 装通）+ cargo test（schema 初始化 reminders 表存在）。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=10）。_

- [x] 11. ensure_reminders / fire_due_reminders 命令 + 前端定时器
  - File: `src-tauri/src/commands/reminders.rs`（新建 ensure_reminders 扫 tasks due_date 未来 N 天按「提前时长」生成 reminders 幂等；fire_due_reminders 查 remind_at<=now AND fired=0 逐条发 notification + 标 fired=1）、`src-tauri/src/commands/mod.rs`、`src-tauri/src/main.rs`、`frontend/src/types/index.ts`、`frontend/src/api/index.ts`、`frontend/src/App.tsx`（启动后 setInterval 60s 调 fireDueReminders）
  - Purpose: 提醒调度 + 桌面通知（Req M2.1.1, M2.1.2, M2.1.4）
  - _Leverage: idx_tasks_due 索引；tauri-plugin-notification API；前端 hooks 模式_
  - _Requirements: M2.1.1, M2.1.2, M2.1.4_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: 全栈。Task: commands/reminders.rs 建 ensure_reminders（扫 due 任务按提前时长生成 reminders，幂等：task_id+remind_at 已存在跳过）+ fire_due_reminders（查到期未发→notification+标 fired）；前端 App.tsx 启动后 setInterval 60s 调 fireDueReminders；通知点击跳任务。Restrictions: 提前时长从设置读（默认截止当天 9:00）；权限被拒静默跳过；应用未运行不发（本期不做后台守护，设置页注明）；中文注释。Success: cargo test（ensure 幂等 + fire 发通知标 fired）+ pnpm build 绿 + 手动验证（到期任务弹通知）。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=11，apiEndpoints+components）。_

- [x] 12. QuickAddTaskModal 加重复/子任务 + TasksPage 子任务展开 UI
  - File: `frontend/src/components/QuickAddTaskModal.tsx`（加「重复」下拉 不重复/每天/每周/每月/自定义 + 「作为子任务」Select 父任务）、`frontend/src/utils/quickAdd.ts`（buildTaskBullet 加 repeat 参数拼 `🔁 every xxx`）、`frontend/src/components/tasks/ListView.tsx`（父任务折叠态显「+N 子任务」可展开）、`frontend/src/pages/TasksPage.tsx`（子任务全完成提示「可勾选完成父任务」）
  - Purpose: 重复/子任务 UI（Req M2.2.4, M2.3.2, M2.3.3, M2.3.4）
  - _Leverage: QuickAddTaskModal 现有表单；buildTaskBullet 现有拼装；ListView 现有分组_
  - _Requirements: M2.2.4, M2.3.2, M2.3.3, M2.3.4_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: 前端 React。Task: QuickAddTaskModal 加「重复」下拉+「子任务」父选；buildTaskBullet 加 repeat 拼 🔁；ListView 父任务折叠显子任务；TasksPage 子任务全完成提示勾父。Restrictions: bullet 格式对齐 indexer（🔁 every xxx）；子任务渲染按 parent_task_id 分组；中文注释。Success: pnpm build 绿 + 手动验证（新建重复任务含 🔁、子任务展开、子全完提示父）。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=12，components exports=["default"]）。_

## M3 · 日程增强（前端为主，依赖 @dnd-kit 已装）

- [x] 13. 任务→日历时间块拖拽
  - File: `frontend/src/pages/CalendarPage.tsx`（接 TasksPage/TodayPage 拖来的 task payload：日历单元格+时段为 droppable；onDrop 调 ensureDayNote→appendBullet('关键事件', buildEventBullet(task.title, slotHour))）、`frontend/src/components/tasks/TaskCard.tsx`（加 draggable 跨页 payload，含 task id+text）、`frontend/src/api/index.ts`（已有 appendBullet/ensureDayNote 复用）
  - Purpose: 任务排进日历时间块（Req M3.1）
  - _Leverage: `@dnd-kit`（已装）；`ensureDayNote`+`appendBullet`；`buildEventBullet`（utils/quickAdd.ts）_
  - _Requirements: M3.1.1, M3.1.2, M3.1.3, M3.1.4_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: 前端 React。Task: CalendarPage 接受 task drag payload，单元格+时段 droppable，onDrop→ensureDayNote→appendBullet('关键事件', buildEventBullet)；TaskCard 加跨页 draggable payload。Restrictions: source_line==null 聚合任务禁拖+提示；目标日无笔记先 ensureDayNote；写回经 appendBullet（零新命令）；中文注释。Success: pnpm build 绿 + 手动验证（拖任务到日历→事件 bullet 写入当日笔记关键事件 section+toast）。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=13，components exports=["default"]）。_

- [x] 14. 事件拖拽改日期
  - File: `frontend/src/pages/CalendarPage.tsx`（事件卡片 draggable，拖到另一天单元格→deleteLine(旧 source_line) + appendBullet(目标日笔记关键事件, raw_bullet)；Shift 修饰键=复制不删旧）
  - Purpose: 日历上直接改事件日期（Req M3.2）
  - _Leverage: deleteLine + appendBullet；ensureDayNote；@dnd-kit_
  - _Requirements: M3.2.1, M3.2.2, M3.2.3_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: 前端 React。Task: CalendarPage 事件卡片 draggable，拖到另一天→deleteLine 旧 + appendBullet 新（走 ensureDayNote）；Shift 修饰键=复制（不删旧）。Restrictions: 写回经 deleteLine/appendBullet 收口；失败 toast+UI 回滚；source_line null 的聚合事件禁拖；中文注释。Success: pnpm build 绿 + 手动验证（拖事件改日期写回 + Shift 复制 + 失败回滚）。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=14，components exports=["default"]）。_

- [x] 15. TimelineView 时间线第四视图
  - File: `frontend/src/components/tasks/TimelineView.tsx`（新建：横向时间轴今日中轴±30 天，任务按 due_date 落点；无 due_date 归「未排期」侧栏；同日多条堆叠+计数角标）、`frontend/src/stores/taskView.ts`（view 联合类型加 'timeline'）、`frontend/src/pages/TasksPage.tsx`（Segmented 加「时间线」选项，按 view 渲染 TimelineView）
  - Purpose: 时间维度分布可视化（Req M3.3）
  - _Leverage: taskView store；TaskCard；ListView/KanbanView/MatrixView 兄弟模式；TasksPage 现有 getTasks 一次拉取_
  - _Requirements: M3.3.1, M3.3.2, M3.3.3_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: 前端 React。Task: 建 TimelineView（横向时间轴今日中轴±30 天，due_date 落点，无 due 归未排期侧栏，同日堆叠+计数）；taskView store view 加 'timeline'；TasksPage Segmented 加选项。Restrictions: 数据源复用 TasksPage 一次 getTasks（不重复 IPC）；内存切视图；中文注释。Success: pnpm build 绿 + 手动验证（切时间线、无 due 归侧栏、扎堆堆叠）。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=15，components exports=["default"]）。_

- [x] 16. M3 客观裁判 + 时间块/事件拖拽行为验证
  - File: 全项目
  - 实现要点：cargo check + cargo test（含 M3 相关无回归）+ pnpm build 连续绿；手动冒烟（任务拖日历、事件拖改日期、Shift 复制、时间线视图切换）
  - Purpose: M3 收口无回归（Req M3 全）
  - _Leverage: 客观裁判补层_
  - _Requirements: M3.1, M3.2, M3.3 全_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: QA。Task: M3 三视图拖拽全量裁判（cargo check/test + pnpm build）连续绿；手动冒烟清单（任务→时间块、事件改日期、Shift 复制、时间线）。Restrictions: 不为通过裁判改业务逻辑；发现回归立即修复重跑。Success: 三件套全绿 + 冒烟通过。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=16，自由文本 Description）。_

## M4 · AI 教练层（依赖 M1 完整数据）

- [x] 17. services/ai LLM 抽象层（trait + Claude/OpenAI provider）
  - File: `src-tauri/src/services/ai/mod.rs`（AiClient trait + build_client + AiError）、`src-tauri/src/services/ai/client.rs`（聚合 prompt 构建 + 超时 + token 预算）、`src-tauri/src/services/ai/providers/claude.rs`（messages API 实现）、`src-tauri/src/services/ai/providers/openai.rs`（chat completions 实现）、`src-tauri/src/services/mod.rs`（加 pub mod ai）、`src-tauri/Cargo.toml`（确认 reqwest + tokio + serde_json）
  - 实现要点：`#[async_trait] pub trait AiClient { async fn complete(&self, system: &str, user: &str) -> Result<String, AiError>; }`；build_client(provider, key) key 空返回 None；超时 30s；user 输入硬上限 4k 字符（截断）；只接收聚合摘要字符串，**调用方负责只传摘要不传原文**
  - Purpose: 可替换 LLM 层（Req M4.1）
  - _Leverage: reqwest（确认在 Cargo.toml，无则加）；serde_json；async_trait（如未在则加）_
  - _Requirements: M4.1.1, M4.1.3, M4.1.4_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: Rust 后端。Task: services/ai/ 建 AiClient async trait + build_client（key 空→None）+ Claude/OpenAI 两 provider（各自 HTTP 实现）；超时 30s；user 输入硬截断 4k 字符。Restrictions: trait 化可替换；只接收摘要字符串（调用方保证不传 vault 全文）；调用失败返回 AiError 不 panic；中文注释。Success: cargo test（build_client key 空→None；mock provider complete 返回字符串；超时/错误返回 AiError）+ cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=17，functions+classes）。_

- [x] 18. ai_generations 表 + AiSettings 存取
  - File: `src-tauri/src/services/database.rs`（SCHEMA 加 ai_generations 表 UNIQUE(vault_id,date_iso,feature)）、`src-tauri/src/models/ai.rs`（AiSettings/AiMainline/AiGeneration DTO）、`src-tauri/src/services/settings.rs`（或 commands/settings.rs：AiSettings 读写 app_data_dir/config.json，不入 vault）、`src-tauri/src/commands/settings.rs`（get_ai_settings/set_ai_settings 命令）、`src-tauri/src/main.rs`（注册）
  - 实现要点：AiSettings 存 app_data_dir（API key 不入 vault 不入 git）；ai_generations 表缓存 AI 结果（UNIQUE 防重）
  - Purpose: AI 配置 + 结果缓存（Req M4.1.2）
  - _Leverage: 现有 settings/config 模式（若有）；theme.ts localStorage 前端模式_
  - _Requirements: M4.1.2_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: Rust 后端。Task: database.rs 加 ai_generations 表；models/ai.rs 建 AiSettings(provider/api_key/enabled)+AiMainline+AiGeneration DTO；settings 存 app_data_dir/config.json（key 不入 vault）；get/set_ai_settings 命令。Restrictions: API key 存 app_data_dir 不入 vault 不入 git；UNIQUE(vault_id,date_iso,feature) 幂等 upsert；中文注释；snake_case。Success: cargo test（settings 读写 + ai_generations upsert 幂等）+ cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=18）。_

- [x] 19. ai_mainline 命令（主线判定 + 降级链）
  - File: `src-tauri/src/commands/ai.rs`（新建 ai_mainline：聚合 active projects priority/mainline/last_activity/OKR 进度→build_client→prompt「从这些项目判 1 个主线+理由」→解析→写 life_state_snapshots.mainline_project + ai_generations）、`src-tauri/src/commands/mod.rs`、`src-tauri/src/main.rs`、`frontend/src/types/index.ts`、`frontend/src/api/index.ts`
  - 实现要点：聚合抽公共 `gather_state(db, vault_id)`（复用 export_life_state 聚合）；LLM 失败/key 空→退 projects.rs apply_global_passes top-3 + source="heuristic"；成功 source="ai"；写 life_state_snapshots + ai_generations（UNIQUE upsert）
  - Purpose: AI 主线判定（Req M4.2）
  - _Leverage: `export_life_state` 聚合（抽 gather_state）；`projects.rs apply_global_passes` top-3 降级；`life_state_snapshots` 表_
  - _Requirements: M4.2.1, M4.2.2, M4.2.3_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: Rust 后端。Task: commands/ai.rs 建 async ai_mainline：聚合 active projects（含 OKR 进度，依赖 task 2 的 okrs）→build_client→prompt→解析主线名+理由→写快照+ai_generations；LLM 失败/key 空退 apply_global_passes top-3 + source="heuristic"。Restrictions: **只发聚合摘要（项目名+priority+进度，每项截断）不发 vault 原文**；失败降级不阻塞；async 命令；中文注释。Success: cargo test（mock LLM 成功→source="ai"；mock 失败→退 top-3 source="heuristic"；key 空→降级）+ cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=19，apiEndpoints）。_

- [x] 20. ai_coach 命令（每日教练建议）
  - File: `src-tauri/src/commands/ai.rs`（ai_coach：聚合今日完成/待办/逾期/主线 OKR→prompt「给 1-3 句教练建议」→写 life_state_snapshots.today_focus + ai_generations）
  - 实现要点：复用 gather_state + 新增今日完成/逾期聚合；LLM 失败读 ai_generations 上次缓存或空态
  - Purpose: 每日教练建议（Req M4.3.1）
  - _Leverage: gather_state（task 19）；life_state_snapshots.today_focus 列_
  - _Requirements: M4.3.1_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: Rust 后端。Task: commands/ai.rs 加 async ai_coach：聚合今日完成+待办+逾期+主线 OKR→prompt 1-3 句建议→写 today_focus + ai_generations；失败读上次缓存。Restrictions: 只发摘要不发原文；降级读 ai_generations 缓存；中文注释。Success: cargo test（mock 成功写 today_focus；失败读缓存）+ cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=20，apiEndpoints）。_

- [x] 21. ai_tomorrow 命令（明日一句写回 vault）
  - File: `src-tauri/src/commands/ai.rs`（ai_tomorrow：聚合明日待办/事件/主线→prompt「一句明日聚焦」→写当日笔记「明日寄语」section 经 append_bullet 收口 + tomorrow_sentences 表）
  - 实现要点：写 vault 走 append_bullet（备份+重索引）；复用 tomorrow_sentences 表 + indexer/tomorrow.rs 解析约定；返回生成文本供前端「重新生成/编辑」
  - Purpose: 明日一句（Req M4.3.2, M4.3.3, M4.3.4）
  - _Leverage: `append_bullet`/`update_line` 收口；`tomorrow_sentences` 表；`indexer/tomorrow.rs`_
  - _Requirements: M4.3.2, M4.3.3, M4.3.4_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: Rust 后端。Task: commands/ai.rs 加 async ai_tomorrow：聚合明日待办+事件+主线→prompt 一句→写当日笔记「明日寄语」section（append_bullet 收口）+ tomorrow_sentences 表。Restrictions: **写 vault 经 append_bullet（备份+重索引），不自写 fs::write**；写前检查 section 是否已有（有则 update_line 替换，避免重复）；返回文本供前端编辑；中文注释。Success: cargo test（生成→明日寄语 section 写入+tomorrow_sentences 填充；section 已有→替换不重复）+ cargo check 绿。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=21，apiEndpoints）。_

- [x] 22. 前端 AiCoachCard + SettingsPage AI 配置 + TodayPage 接入
  - File: `frontend/src/components/ai/AiCoachCard.tsx`（新建：主线判定卡 + 每日教练卡 + 明日一句卡，各带「刷新/重新生成/编辑」按钮）、`frontend/src/pages/SettingsPage.tsx`（加 AI 配置区：provider 选/api_key 输入/enabled 开关，调 setAiSettings）、`frontend/src/pages/TodayPage.tsx`（接入 AiCoachCard，未配 key 显「去设置」）、`frontend/src/types/index.ts`、`frontend/src/api/index.ts`
  - Purpose: AI 教练 UI（Req M4 全）
  - _Leverage: TodayPage 现有卡片布局；SettingsPage 现有表单；api invoke 模式_
  - _Requirements: M4.2.2, M4.3.1, M4.3.2, M4.3.4_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: 前端 React。Task: 建 AiCoachCard（主线/教练/明日三卡，带刷新+重新生成+编辑）；SettingsPage 加 AI 配置（provider/key/enabled）；TodayPage 接入（未配 key 显「去设置」降级态）。Restrictions: API key 输入框 type=password；AI 结果 loading/降级态（heuristic 标注）；编辑后保存走对应命令；中文注释；snake_case 对齐。Success: pnpm build 绿 + 手动验证（配 key→主线判定+教练建议+明日一句；未配→降级态；重新生成/编辑）。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=22，components exports=["default"]）。_

## P_END · 裁判收口

- [x] 23. 全量客观裁判 + smoke + AI 降级链验证
  - File: 全项目
  - 实现要点：cargo check + cargo test（含 OKR/repeat/子任务/AI 降级行新单测）+ pnpm build 连续绿；清 cargo/ts 新 warning；`index_real_wiki_smoke` 对 ~/wiki 验证 OKR 解析不崩+🔁/子任务识别+events.project_id 部分填充；AI smoke（未配 key 降级不崩）；列手动冒烟清单（OKR 看板/提醒通知/重复推进/子任务/时间块/事件改日期/时间线/AI 三卡）
  - Purpose: 全 spec 无回归 + 降级链可靠（全部 Req）
  - _Leverage: 客观裁判补层；index_real_wiki_smoke_
  - _Requirements: All_
  - _Prompt: Implement the task for spec plan-todo-completeness, first run spec-workflow-guide. Role: QA。Task: 全量裁判（cargo check+test+pnpm build）连续绿；index_real_wiki_smoke 验证 OKR/🔁/子任务/events.project_id；AI smoke 验证未配 key 降级；清新 warning；列冒烟清单。Restrictions: 不为通过裁判改业务逻辑；回归立即修复重跑；warning 修到零或说明残留。Success: 三件套全绿 + smoke 过 + 降级链验证 + 冒烟清单。完成后 [ ]→[-]→[x] 并 log-implementation（taskId=23，自由文本 Description）。_

## 未列入本期（backlog · 留待后续子 spec）

- **系统级后台提醒守护**（应用未运行也发通知，需 OS 级后台进程，本期仅应用运行时提醒）→ 后续 spec
- **AI 本地 provider（Ollama）**（product 原则 3「本地优先」的终极形态，本期云端优先）→ M4 抽象层已 trait 化，后续加 provider/ollama.rs
- **AI 多模态/语音教练**（v0.3+）→ 独立 spec
- **OKR 看板可视化编辑**（type 路由可视化编辑，vault-paradigm 4.1 范畴）→ 子 spec vault-visual-editing
- **番茄钟/计时器 + 习惯打卡**（市场 TickTick 类功能，低优先）→ 独立 utility spec
- **多日事件完整态**（M3.2 本期降级为「复制到目标日」，真正多日跨区间事件需 schema 改 end_date）→ 后续
- **事件 conflict 检测**（时间块拖拽时检测时段冲突）→ 后续
- **看板拖拽改项目 status / 项目拖拽**（ux-overhaul backlog 已记）→ 后续
- **i18n 框架**（ux-overhaul backlog 已记，中文单语无需）→ 后续
- **Agent inbox 写回**（vault-paradigm 5.3，AI 教练只读+建议，不直接改 vault 主线字段）→ 子 spec agent-protocol
