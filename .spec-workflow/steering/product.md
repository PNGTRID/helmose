# Product Overview

## Product Purpose

Helmose（helm = 舵手）是一个 **AI 驱动的人生知识库桌面应用**，替用户掌舵人生主线。

核心解决的问题：市面笔记软件（Obsidian / Notion 等）只面向「人读」，AI 与外部智能体无法高效消费其中的结构化信息。Helmose 在保留 Obsidian 式本地 markdown vault 的同时，把任务 / 日志 / 项目 / 笔记整理成**人和智能体都能消费**的清晰结构，内置 AI 扮演**教练 + 秘书 + 第二大脑**，并开放标准化状态接口给外部智能体（Hermes / Codex / OpenClaw 等）。

一句话定位：**人读 + Agent 读双导向**的人生数据底座。

## Target Users

- **主要用户**：重度知识工作者（本项目的初始用户即作者本人），已有成熟的 Obsidian vault（`~/wiki`，约 1.9 万篇 md），需要一个能被 AI 理解、能驱动"今日该做什么"的本地知识中枢。
- **隐式用户**：外部 AI 智能体——通过 `LIFE-STATE.md` / `state.json` 状态接口读取用户当前主线、待办、画像，无需人类中转。

痛点：
1. 笔记堆积如山，却不知道"此刻该聚焦什么"。
2. AI 助手每次都要重新解释"我是谁、我在做什么"。
3. Obsidian 对机器不友好（无结构化导出、无任务聚合）。

## Key Features

按能力域（已落地为主）：

1. **Obsidian 式 vault 接入**：直接读写本地 markdown 文件夹，与 Obsidian 共存（不破坏原文）。首次启动引导选择已有 vault，或用脚手架 `scaffold_vault` 新建 Life OS 目录骨架。
2. **分层索引引擎（Rust，契约驱动）**：按规范.md 契约把 vault 全量 md 解析成结构化数据（笔记 / 任务 / wikilink / frontmatter / type / 分层 L1-L3），写入 SQLite 派生索引；`notify` 文件监听 + `content_hash`(sha256) 增量更新。
3. **文档库（Obsidian 式工作台）**：Ribbon + 可拖拽文件树（虚拟列表）+ 标签页 + markdown 预览 + 反向链接 / 前向链接面板 + 关系图谱；**TipTap WYSIWYG 富文本编辑写回**（替换 CodeMirror，所见即所得，写前 `.helmose/backup` 备份，`unescapeWikilink` 防双链转义）。
4. **全库搜索**：基于 `notes_fts`（FTS5 trigram）的全文搜索，命令面板 Ctrl/⌘+P 触发，命中关键词高亮 snippet。
5. **结构化提取**：projects 深度结构化（priority / mainline / top-3 兜底）/ events 时间线 / tasks due_date / **OKR（KR section 提取）** / 明日一句 / 项目进度聚合（运行时聚合不入 fm）。
6. **任务管理 + 标记文字化**：任务多视图（看板 / 列表 / 矩阵 / 时间线）；标记 Postel 法则（读侧三格式全兼容：Helmose 老 emoji / Obsidian Tasks 标准 / Helmose 文字，写侧默认文字契约，双模式开关可切 Obsidian 互通）；**任务到期提醒**（扫 due 幂等生成 + `tauri-plugin-notification` 桌面通知）。
7. **行级就地写入 + 移动感知**：行级 insert/update/delete/append + frontmatter patch + set_tag（全经 save 收口 = 备份 + 重索引）；`move_note` / `rename_note` + 路径型引用（`[文本](path)` / `[[path]]`）经用户授权后批量更新。
8. **今日计划页 PlannerPage**：三栏（收集箱 / 分类 / 迷你日历）+ 四象限拖拽（写回复用 set_task_priority/urgency）+ 详情面板；分类软方案（localStorage 自定义分类 + 项目/文件夹/tag 映射，不落库不改 schema）。
9. **AI 教练层（M4，已落地）**：主线判定 / 每日建议 / 明日一句；`AiClient` trait provider 可替换（Claude / OpenAI，留 Ollama 本地扩展点），数据最小化（只发聚合摘要、user 上限 4k、绝不发 vault 原文）+ 30s 超时；未配 key / LLM 失败 → 本地启发式 → `ai_generations` 缓存 → 空态；key 存 `app_data_dir/config.json`（Unix 0600，不入 vault 不入 git）。
10. **Agent 状态接口**：`export_life_state` 聚合后写 `app_data_dir/agent/{LIFE-STATE.md（人读）, state.json（机读）}`，供外部智能体定时读取；inbox 写回带保护（规划中）。

## Business Objectives

- 建成"越用越懂你"的本地人生数据底座，数据主权完全在用户（纯本地文件 + 派生缓存）。
- 让 AI 成为持续服务你的教练/秘书，而非每次从零开始。
- 形成可被多智能体复用的标准化状态协议。

## Success Metrics

- **索引完整性**：vault 全量 md（~1.9 万篇）100% 入库，索引耗时 < 10s。
- **浏览可用性**：文档库任意目录的文件列表 < 200ms 响应；单篇预览 < 100ms。
- **AI 消费就绪**：`export_life_state` 已产出 `LIFE-STATE.md` + `state.json`；内置 AI 教练层（M4）已落地主线判定 / 每日建议 / 明日一句，未配 key 自动降级本地启发式，结果带 `source=ai|heuristic` 标降级。
- **原文零破坏**：除用户明确编辑动作（`save_note_content`，写前 `.helmose/backup` 备份）外，索引/查询/浏览全只读，不修改 vault md 原文。

## Product Principles

1. **vault 是唯一真相源（single source of truth）**：SQLite 只是派生缓存，删了能从 vault 重建；永远不反向写 vault 原文（除用户明确编辑动作外）。
2. **人读 + Agent 读同等重要**：每个数据结构都要问"AI 能不能消费"。
3. **本地优先**：数据、索引、AI 调用尽可在本地闭环，数据主权不外泄。
4. **与 Obsidian 共存而非替代**：不绑架用户，`.obsidian/` 等配置完全保留。

## Monitoring & Visibility

- **形态**：Tauri 桌面应用（macOS / Windows / Linux）。
- **今日聚焦面板**：索引统计（笔记/任务/wikilink 数）+ 待办任务列表，是用户感知系统状态的窗口。
- **设置页**：vault 路径、Obsidian 共存状态、最后索引时间、索引统计。

## Future Vision

### Potential Enhancements
- **Agent 写回 inbox**：外部智能体产出经审核后写入 vault（状态导出已落地，写回未做）。
- **AI 提醒可配置**：当前 reminders 固定提前 1 天 9:00，后续接 settings 暴露 lead_days / remind_hour。
- **AI provider 扩展**：`services/ai/providers` 留 Ollama 本地扩展点（本地闭环、零外发），尚未接入。
- **events 关联项目**：`events.project_id` 关联映射未做（当前事件按笔记独立解析，未挂项目）。
- **前向链接 dangling 提示**：当前只显示已解析的前向链接，未对悬空目标（目标笔记不存在）给出提示。
- **可视化编辑扩展**：按 type 路由（OKR 进度条 / 项目看板）结构化写回 markdown（行级 CRUD 与 TipTap WYSIWYG 已落地，按 type 的可视化形态留后续）。
