# app-polish · Tasks

> 留痕 task 清单（用户预先批准）。task ID 用数字（工具要求），描述内带 M 标签（M1~M8）可追溯。
> 状态：**P0+P1+P2 全部已交付**（`[x]`）。客观裁判 `cargo check` + `cargo test`(57 过) + `pnpm build` 全绿。
> ID→M 映射：1=M1 projects · 2=M2 events · 3=M3 CalendarPage · 4=M4 TodayPage · 5=M4b ProjectsPage · 6=M5 更新 · 7=M6 重置 · 8=M7 Onboarding · 9=M8 Tasks

## P0 · 数据层

- [x] 1. [M1] projects 深度结构化
  - File: src-tauri/src/services/indexer/projects.rs（扩展 ProjectInfo + 全局 pass）、src-tauri/src/commands/index.rs（全字段写库）、src-tauri/src/services/indexer/incremental.rs（增量 upsert）、src-tauri/src/commands/projects.rs（查询参数）、src-tauri/src/utils/dates.rs（secs_to_iso8601）
  - priority=frontmatter.priority(数字)；is_mainline=fm.mainline/tag mainline + 全局 top-3 active；okr_priority=fm.okr/tag okr:*/goal；last_activity=home 父目录 max(mtime)（顶层/根退化自身）
  - _Requirements: AC-M1.1 ~ AC-M1.4_

- [x] 2. [M2] events 解析与填表 + list_events 命令
  - File: src-tauri/src/services/indexer/events.rs（新建 extract）、src-tauri/src/services/indexer/mod.rs（ParsedNote.events + parse_file）、src-tauri/src/commands/index.rs（全量写库）、src-tauri/src/services/indexer/incremental.rs（增量重建）、src-tauri/src/commands/events.rs（新建 list_events）、src-tauri/src/commands/mod.rs + main.rs（注册）、frontend/src/types/index.ts + api/index.ts（Event + listEvents）
  - 从「关键事件/事件/时间线/里程碑」section 提取 bullet；event_date 复用 date_iso；event_time 解析 HH:MM
  - _Requirements: AC-M2.1 ~ AC-M2.3_

## P1 · 核心页接真数据

- [x] 3. [M3] CalendarPage 接 events
  - File: frontend/src/pages/CalendarPage.tsx
  - events 月范围拉取（cancelled flag 竞态守卫）+ 单元格双点（事件绿/笔记紫）+ 今日高亮 + 点击 event 跳源笔记（note_id→NoteMeta 解析）+ 无 events 退化兼容
  - _Requirements: AC-M3.1 ~ AC-M3.3_

- [x] 4. [M4] TodayPage 增强
  - File: frontend/src/pages/TodayPage.tsx
  - 四卡片聚合：今日待办（今日笔记的 undone task）/ 今日事件 / 主线项目 / 索引状态；每卡点击跳对应页；空态友好引导
  - _Requirements: AC-M4.1 ~ AC-M4.3_

- [x] 5. [M4b] ProjectsPage 显示 mainline/priority/last_activity + 只看主线开关
  - File: frontend/src/utils/date.ts（relativeTime）、frontend/src/pages/ProjectsPage.tsx
  - 卡片显示 priority 数字 + last_activity 相对时间（「3 天前」）+「只看主线」Switch 过滤
  - _Requirements: AC-M4b.1 ~ AC-M4b.2_

## P2 · 应用生命周期

- [x] 6. [M5] 自动更新（框架）
  - File: src-tauri/Cargo.toml + main.rs + tauri.conf.json + commands/update.rs + frontend SettingsPage
  - _Requirements: AC-M5.1 ~ AC-M5.2_

- [x] 7. [M6] 重置安装
  - File: src-tauri/src/commands/vault.rs（reset_app）、frontend/src/pages/SettingsPage.tsx（重置 Helmose 区 Popconfirm）
  - _Requirements: AC-M6.1 ~ AC-M6.3_

## P3 · 微调

- [x] 8. [M7] Onboarding 完善 — 跳过（决议态）：现有 148 行功能完整（选已有/新建骨架/Obsidian 检测），无明显缺口。
- [x] 9. [M8] tasks due_date 解析 — 已做（原判 backlog，二阶段升级为完成）：bullet 内 `📅`/`due:`/`截止:`/`deadline` 标记 → due_date 列 + TasksPage 分组生效 + TodayPage 今日待办按此筛。

## 深化（第二阶段 · 查漏补缺 + 新功能，全自动化）

- [x] 10. 笔记创建能力：`create_note`（通用，路径防穿越+不覆盖）+ `create_today_note`（封装路径/查已有/日志模板，幂等）+ TodayPage「今日笔记」按钮 + Ctrl/⌘+J 快捷键（`utils/note.ts::openOrCreateTodayNote` 共用）
- [x] 11. 双向链接 + 标签精确：`get_forward_links`（SidePanel 显示前向链接，反链+前向完整）+ `list_notes_by_tag`（tags JSON 精确匹配，替代 FTS 宽泛搜，避免 project 误命中 project-status:active）
- [x] 12. 主题 + 鲁棒性 + 性能：暗色模式（`stores/theme.ts` + antd darkAlgorithm + CSS html.dark + StatusBar 切换 + localStorage）+ ErrorBoundary（content 区错误捕获不白屏）+ FilePanel 虚拟列表（antd Tree virtual + ResizeObserver，1.9万节点只渲染可见行）+ 图谱增强（hover 高亮/暗色适配/真实 NoteMeta 跳转）
- [x] 13. 交互 + 快捷键：命令面板增强（snippet 高亮 + ↑↓/Enter 键盘导航 + 空 query 跳页快捷 + 最近笔记）+ 键盘快捷键（⌘P 搜索/⌘J 今日/⌘B 文件面板/⌘\ 侧栏）+ 大纲点击跳转（滚动到标题）+ 状态栏今日统计 + 任务列表直接勾选完成（`toggle_task` 写回 vault，复用 save 备份+索引）
- [x] F1. wikilink 可点跳转 — 查漏发现**已完整实现**（后端 render_wikilinks + useWikilinkNavigation + CSS），CLAUDE.md backlog 过时已更正。
- [x] 14. 项目/日志/任务增强：ProjectsPage 新建项目 Modal（F17）+ JournalPage 按月分组 Collapse（F18）+ TasksPage overdue/今天/本周 颜色高亮（F19）+ 任务勾选 toast（F38）+ TodayPage 逾期 Alert（F24）
- [x] 15. 备份管理：list_backups + delete_backup 命令（防穿越）+ SettingsPage 备份列表/单删/刷新（F20）
- [x] 16. contract log type 查漏修复 + tomorrow_sentences：日志笔记（07_.../日志/）note_type 现为 log（之前 None，JournalPage 漏显示；真实 wiki 110 篇已正确归类）+ indexer/tomorrow.rs 提取「明日一句」+ get_tomorrow_sentence + TodayPage 昨日寄语（F26）
- [x] 17. 命令面板/路径/日历：文件名即时匹配（F32，FTS 不索引 file_name 的补全）+ Onboarding 路径记忆 localStorage（F31）+ 日历选中日期创建日志（F43）
- [x] F27. 暗色模式查漏：CSS 全 var 变量驱动 + antd darkAlgorithm + JSX 语义色暗色下可见 → 已完整，无需改
- [x] 18. 交互增强批：快捷键帮助 Modal（? 键 + kbd 样式）+ 图谱节点搜索过滤 + TabBar 右键菜单（关闭其他/右侧/全部）+ SettingsPage 笔记类型分布 + NoteView 字数统计 + SidePanel 反链/前向显示「链接词」（target_text）
- [x] 19. 编辑/创建增强：NoteEditor Ctrl/Cmd+S 保存（CodeMirror keymap）+ NoteEditor CodeMirror 跟随暗色主题 + FilePanel 新建笔记按钮（创建到 00_收件箱）
- [x] 20. 删除/回收站 + 信息增强：delete_note（软删除到 .helmose/trash 可恢复 + DB 级联）+ NoteView 删除按钮（Popconfirm）+ list_trash/clear_trash 命令 + SettingsPage 回收站卡（列表/永久清空）+ NoteView 显示创建日期 + TasksPage 显示来源笔记名
- [x] 21. 命令面板/暗色/阅读：命令面板最近搜索记忆（localStorage 6 个，空 query 点击重填）+ 暗色模式动态跟随系统（matchMedia change，用户未手动设时跟随）+ NoteView 阅读时间估算（字数/300）
- [x] 22. 杂项 polish：FilePanel 展开状态持久化（localStorage）+ NoteView 复制路径按钮（navigator.clipboard）+ 命令面板搜索结果显示 note_type 标签

## backlog（本期不做，显式记录防 scope creep）

- M7 Onboarding 完善：现有 148 行已功能完整 → 跳过。
- 真实 updater endpoint/pubkey：发布时由用户配置真实值（M5 占位）。
- events 的 project_id 关联：M2 暂不关联。
- 前向链接 dangling 提示：当前只显示已解析的。
- bundle 拆分（manualChunks）：桌面应用本地加载可接受，vite config 有历史风险，暂不动。
- 编辑器 wikilink `[[` 自动补全（CodeMirror 扩展）：复杂，另一 spec。
- task completed_at 填充：toggle_task 勾选后 done 同步，但 completed_at 仍 NULL（TasksPage done 分组按 completed_at，刚勾的落"未知"）。
- AI 教练层（主线判定 / 每日建议 / 明日一句）：v0.2。
- Agent inbox 写回：现有 backlog。
