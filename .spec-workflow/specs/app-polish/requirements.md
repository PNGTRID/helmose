# app-polish · Requirements

> 全方位完善 Helmose：项目/日历/任务/今日 + 安装引导/重置/自动更新。
> **留痕文档（用户预先批准，不走 approvals）**。task 用 M1~M8 编号。

## Alignment with Product Vision

Helmose = AI 驱动的人生知识库（Tauri v2 + Rust + React），vault 是唯一真相源，SQLite 是派生缓存。
当前 9 个前端页齐备、Ribbon 挂载完成，但**核心数据层不完整**（projects 只填 3 字段、events 表空壳），
导致日历/今日/项目页只能显示浅层数据。本 spec 把数据层补全 + 核心页接真数据 + 补齐应用生命周期（更新/重置）。

对齐 steering：
- 守 vault 只读铁律（重置/更新都不碰 vault md）。
- 守性能红线（1.9 万 md，扫描按目录限定、列表只回元数据）。
- 守 IPC snake_case 契约 + 标准 Tauri 命令流程。

## Scope（做什么 / 不做什么）

**做**：M1 projects 深度结构化、M2 events 解析填表、M3 CalendarPage 接 events、M4 TodayPage 聚合卡片、
M4b ProjectsPage 显示主线/优先级/活跃度、M5 自动更新框架、M6 重置安装。

**不做（入 backlog）**：AI 教练层（v0.2）、wikilink 可点跳转、Agent inbox 写回、task due_date 解析（需另行设计）、
真实 updater endpoint/pubkey（发布时配）。

## Acceptance Criteria（EARS）

### M1 projects 深度结构化
- AC-M1.1：WHEN 全量索引完成 THEN 系统 SHALL 把 projects 表的 priority / is_mainline / okr_priority / last_activity 全部填上（不再全 NULL）。
- AC-M1.2：WHEN 增量编辑一篇 project 笔记 THEN 系统 SHALL upsert 对应 projects 行（含全字段），不残留旧值。
- AC-M1.3：WHEN 调用 get_projects(by_mainline=true) THEN 系统 SHALL 只返回 is_mainline=1 的项目。
- AC-M1.4：last_activity 计算 SHALL 限定在 project home 父目录范围内（不全库扫），父目录是顶层目录时退化为笔记自身 mtime。

### M2 events 解析与填表
- AC-M2.1：WHEN 全量索引完成 THEN events 表 SHALL 有行（从 experience / 含事件 section 的笔记提取）。
- AC-M2.2：WHEN 调用 list_events(vault_id, from, to) THEN 系统 SHALL 返回 event_date 落在 [from,to] 的事件列表。
- AC-M2.3：增量编辑笔记后，该笔记的 events 行 SHALL 同步重建。

### M3 CalendarPage 接 events
- AC-M3.1：日历月视图单元格 SHALL 同时显示「事件点」与「笔记点」（不同颜色区分）。
- AC-M3.2：点击事件 SHALL 打开其源笔记（openNoteFromMeta），竞态用 cancelled flag 守卫。
- AC-M3.3：无 events 时 SHALL 退化为只显示有 date_iso 的笔记（向后兼容）。

### M4 TodayPage 增强
- AC-M4.1：今日聚焦 SHALL 聚合 4 张卡片：今日待办 / 今日事件 / 主线项目 / 索引统计。
- AC-M4.2：每张卡片 SHALL 可点击跳转对应页。
- AC-M4.3：今日无数据时 SHALL 显示友好空态引导。

### M4b ProjectsPage 显示
- AC-M4b.1：项目卡片 SHALL 显示主线徽标（置顶）/ priority / last_activity（相对时间如「3 天前」）。
- AC-M4b.2：「只看主线」开关 SHALL 过滤 is_mainline=1 的项目。

### M5 自动更新（框架）
- AC-M5.1：系统 SHALL 装通 tauri-plugin-updater + 配置占位 + check_update 命令可调。
- AC-M5.2：未配置真实 endpoint 时，check_update SHALL 返回「未配置更新源」友好状态（不崩）。

### M6 重置安装
- AC-M6.1：SettingsPage SHALL 有「重置 Helmose」区（Popconfirm 二次确认）。
- AC-M6.2：reset_app SHALL 只清派生缓存（SQLite + app_data/agent），绝不碰 vault 原文。
- AC-M6.3：重置后 SHALL 回到 OnboardingPage（vault=null）。

## 验收方式（客观裁判）
每模块做完跑：`cargo check` / `cargo test` / `pnpm build`，连续 2 轮无新红 = 完成。
