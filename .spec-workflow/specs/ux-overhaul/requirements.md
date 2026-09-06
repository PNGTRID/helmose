# ux-overhaul · Requirements

> 用户体验大升级：中文化（右键真凶）+ 今日/项目/日志/日历快速创建弹窗 + 任务页完整升级（status/priority/urgency/四象限/看板拖拽）+ 项目多视图（进度/负责人）+ 侧栏修复。
> **用户预先批准「全部一期做完」，全权委托执行**。task 用 M1~M7 编号 + 数字 ID（工具要求）。

## Alignment with Product Vision

Helmose = AI 驱动的人生知识库（Tauri v2 + Rust + React），vault 唯一真相源，SQLite 派生缓存。

当前痛点（用户原话归纳）：
1. 右键菜单英文（系统已是中文、应用内也是中文，唯独右键英文）。
2. 各页只有简陋单行输入框，缺"快速创建弹窗 + 参数选择（时间/紧急程度/优先级等）"。
3. 任务只有 done 二态、单一列表，无四象限/看板/拖拽改状态。
4. 侧栏在非笔记页（tasks/projects/calendar 等）占位无用。
5. 项目新建只有名字框、只有看板视图。
6. 日历/日志页缺快捷创建与参数。

本 spec 把"快捷创建 + 多视图 + 拖拽 + 中文化"一次性补齐，让 Helmose 从"能看"升级到"好用"。

对齐 steering：
- 守 vault 只读铁律：所有创建/编辑经 `append_bullet` / `create_note` / `save_note_content_inner` 收口 + `.helmose/backup` 备份 + 路径防穿越 + 不覆盖。
- 守性能红线（1.9 万 md）：列表只回元数据，任务/项目多视图前端一次拉取内存切视图，避免重复 IPC。
- 守 IPC snake_case + 契约驱动（type→dir，新建项目走 contract 映射目录 `01_企业与项目资产/`）。

## Scope（做什么 / 不做什么）

**做**：
- **M1 中文化**：`Info.plist` 中文本地化（release 右键根治）+ antd `<App>` 包裹防御静态方法英文。
- **M2 今日页**：待办/事件/项目 3 个快速创建弹窗（参数选择）。
- **M3 任务页完整升级**：Task 加 status/priority/urgency 字段 + indexer 解析 + DB 迁移 + 3 新命令 + 4 视图（列表/看板/四象限）+ @dnd-kit 拖拽。
- **M4 侧栏**：非 note tab 强制隐藏（1 行 + toast）。
- **M5 项目页**：快速创建弹窗（4 模板）+ 5 视图（看板/列表/网格/进度/负责人）+ owner 字段 + get_project_progress 命令。
- **M6 日历页**：事件折叠+N + 新建事件弹窗 + 日期格+按钮。
- **M7 日志页**：4 模板 + 模板 Modal + 筛选器 + NoteFieldsForm 日志字段扩展。

**不做（入 backlog，明确划线）**：
- 时间线视图（任务第四视图，v2.1）。
- 事件拖拽改日期、多日事件、周/日历视图（日历高级，ROI 低）。
- 看板拖拽改项目 status（项目拖拽，ROI 中等）。
- events.project_id 反查关联（CLAUDE.md backlog 已列）。
- urgency indexer 派生（本期 urgency 用手动 🔥 + due_date 前端派生，indexer 只解析手动 🔥）。
- i18n 框架（react-i18next，过度工程，中文单语硬编码 + antd locale 足够）。

## Acceptance Criteria（EARS）

### M1 中文化
- **AC-M1.1**：release 构建（`npm run tauri:build`）产物的 `Info.plist` SHALL 含 `CFBundleDevelopmentRegion=zh-Hans` + `CFBundleLocalizations=[zh-Hans, en]`；macOS 系统级右键菜单（Copy/Paste/Look Up 等）跟随中文。
- **AC-M1.2**：WHEN 前端调用 antd 静态方法（Modal.confirm 等）THEN 系统 SHALL 通过 `<App>` 包裹消费 ConfigProvider locale，默认按钮中文。
- **AC-M1.3**：dev 模式（`tauri dev`）右键菜单 SHALL 仍为英文（dev 不打包 bundle，Info.plist 不参与）—— 已知限制，须在 README/任务注明，不视作 bug。

### M2 今日页快速创建弹窗
- **AC-M2.1**：今日待办卡片 SHALL 有「+」添加按钮，弹窗含：任务内容（TextArea）+ 截止时间（DatePicker）+ 紧急程度（Segmented：紧急/重要/一般/不急）+ 所属项目（Select 拉 active 项目）。
- **AC-M2.2**：今日事件卡片 SHALL 有「+」按钮，弹窗含：标题 + 开始时间（TimePicker）+ 时间段开关（Checkbox 控结束时间显隐）+ 关联项目 + 备注。
- **AC-M2.3**：主线项目卡片 SHALL 有「+」按钮（onClick 须 `e.stopPropagation()` 拦截整卡跳转），弹窗含：项目名 + 状态 + 优先级（P0-P3 Segmented）+ 主线开关 + OKR。
- **AC-M2.4**：三弹窗提交 SHALL 复用 `append_bullet`（待办/事件）+ `create_note`（项目），零新增后端命令；写盘后触发 refresh。
- **AC-M2.5**：弹窗字段拼装 SHALL 集中在 `utils/quickAdd.ts` 纯函数（buildTaskBullet/buildEventBullet/buildProjectFrontmatter），含单测。

### M3 任务页完整升级
- **AC-M3.1**：Task 模型 SHALL 新增 `status`（todo/doing/done）+ `priority`（i32 0-3）+ `urgency`（low/mid/high）三字段；DB 迁移幂等（PRAGMA table_info 查列存在性再 ALTER），旧数据 `done=1 → status='done'` 反填。
- **AC-M3.2**：indexer SHALL 从 bullet 文本解析 status（`- [/]` 或 🔄=doing）+ priority（⭐ 数 1-3）+ urgency（🔥=high），语法与 due_date 同模式（提取后清理 text，独立存）。
- **AC-M3.3**：`get_tasks` SHALL 支持 `status`/`project_id`/`priority_min` 过滤参数；新增 `set_task_status`/`set_task_priority`/`set_task_urgency` 三命令（经 `save_note_content_inner` 收口 + 备份）。
- **AC-M3.4**：任务页 SHALL 支持视图 Segmented 切换：列表（多分组维度：按到期日/项目/状态/优先级）/ 看板（status 三列）/ 四象限（priority×urgency）。时间线视图入 backlog。
- **AC-M3.5**：看板跨列拖拽 SHALL 调 `set_task_status` 写回 vault；四象限拖拽 SHALL 改 priority/urgency；拖拽失败 SHALL 前端状态回滚 + `message.error`。
- **AC-M3.6**：仅 `source_line != null` 的任务可拖拽写回；聚合 section 任务拖拽 SHALL 提示「该任务来自聚合 section，不支持改状态」并回滚。
- **AC-M3.7**：视图选择 SHALL 持久化（localStorage，经 Zustand taskView store）。

### M4 侧栏
- **AC-M4.1**：WHEN active tab `type !== "note"` THEN SidePanel 与 resizer SHALL 隐藏；WHEN `type === "note"` THEN 按现有显示（双链/大纲/标签）。
- **AC-M4.2**：非 note 页按 Ctrl+\ SHALL toast 提示「侧栏仅在笔记页可用」，不切换全局 `sidePanelOpen`（避免切回 note 页状态错乱）。

### M5 项目页
- **AC-M5.1**：项目页新建 SHALL 弹窗一步到位：项目名 + 模板（空白/任务列表/OKR/知识库）+ 状态 + 优先级（P0-P3）+ 主线 + OKR + 负责人 + 父目录，复用 `create_note` 零新命令。
- **AC-M5.2**：Project 模型 SHALL 新增 `owner: Option<String>`（frontmatter.owner，indexer extract 一行读取）；DB 迁移幂等；`get_projects` 返回值含 owner。
- **AC-M5.3**：项目页 SHALL 支持 5 视图 Segmented：看板（现状）/ 列表（antd Table）/ 网格（Card）/ 进度 / 负责人。
- **AC-M5.4**：进度视图 SHALL 调 `get_project_progress` 命令（SQL 聚合 tasks by project_id）显示完成率 Progress 条 + 逾期角标；进度不入 frontmatter（运行时聚合，不污染 vault）。
- **AC-M5.5**：负责人视图 SHALL 按 owner 分组（列表/网格形态）。

### M6 日历页
- **AC-M6.1**：日历单元格 SHALL 直接列最多 2 条事件标题（截断），超 2 条显示 `+N` popover 列全部。
- **AC-M6.2**：日历 SHALL 有新建事件弹窗（标题 + 时间 TimePicker + 关联项目 Select + 备注），复用 `append_bullet` 到「关键事件」section。
- **AC-M6.3**：日期格 hover SHALL 显示「+」按钮，点击触发新建事件弹窗（预填该日期）。
- **AC-M6.4**：新建事件 SHALL 复用 `ensureDayNote(date)` 取 note_id，零新增后端命令。

### M7 日志页
- **AC-M7.1**：日志页新建 SHALL 下拉选模板（daily/weekly/monthly/review），弹窗含模板 + 日期 + 心情/精力（仅 daily）。
- **AC-M7.2**：日志列表 SHALL 支持筛选：按 type（Segmented 全部/日报/经历）+ 时间范围（RangePicker）+ 标签，纯前端 useMemo 过滤（无 IPC 增量）。
- **AC-M7.3**：`NoteFieldsForm` 日志分支 SHALL 扩展字段：心情（Rate 5 星）+ 精力（Slider 1-10）+ 天气（AutoComplete）+ 复盘类型（Select）+ 关联项目（Select），经 patchFrontmatter/setTag 写回。
- **AC-M7.4**：新建日志 SHALL 复用 `createNote`（前端拼模板）；`utils/journalTemplates.ts` 为单一模板源（消除 JournalPage/CalendarPage 双份漂移）。

## 验收方式（客观裁判）

每模块做完跑：
- `cd src-tauri && cargo check`（Rust 类型 + 借用）
- `cd src-tauri && cargo test`（含新字段解析 / 命令 / 迁移单测）
- `cd frontend && pnpm build`（= tsc -b && vite build，前端类型 + 构建）

连续绿 = 完成。M1 额外：`npm run tauri:build` 后 `plutil -p Info.plist` 查 `CFBundleLocalizations` 含 `zh-Hans`。
