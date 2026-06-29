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

按版本里程碑（当前 **v0.1**）：

1. **Obsidian 式 vault 接入**：直接读写本地 markdown 文件夹，与 Obsidian 共存（不破坏原文）。首次启动引导选择/新建 vault。
2. **分层索引引擎（Rust）**：把 vault 全量 md 解析成结构化数据（笔记 / 任务 / wikilink / frontmatter / 分层 L1-L3），写入 SQLite 派生索引。
3. **文档库（Obsidian 式浏览）**：三栏界面（目录树 + 文件列表 + markdown 预览），让用户能浏览 vault 中**所有** md 文档——填补"看得到自己的知识"这一基础缺口。
4. **今日聚焦（教练面板）**：v0.1 显示索引统计 + 待办任务；v0.2 接 AI 给出主线判定与教练建议。
5. **Agent 状态接口（规划中）**：导出 `LIFE-STATE.md` + `state.json`，inbox 写回保护，供外部智能体定时读取。

## Business Objectives

- 建成"越用越懂你"的本地人生数据底座，数据主权完全在用户（纯本地文件 + 派生缓存）。
- 让 AI 成为持续服务你的教练/秘书，而非每次从零开始。
- 形成可被多智能体复用的标准化状态协议。

## Success Metrics

- **索引完整性**：vault 全量 md（~1.9 万篇）100% 入库，索引耗时 < 10s。
- **浏览可用性**：文档库任意目录的文件列表 < 200ms 响应；单篇预览 < 100ms。
- **AI 消费就绪**：`LIFE-STATE.md` 能让外部智能体正确判断"当前主线 + 今日该做什么"（v0.2 验收）。
- **原文零破坏**：任何操作都不修改 vault 中的 md 原文（只读 + 派生缓存）。

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
- **AI 教练层（v0.2）**：主线判定、每日教练建议、明日一句。
- **wikilink 可点跳转**：文档库预览中的 `[[wikilink]]` 点击跳转到目标笔记。
- **全文搜索**：基于已有 `notes_fts`（FTS5 trigram）的全库搜索。
- **文件监听增量索引**：基于 `notify` 的 vault 变更实时增量索引（依赖已就绪）。
- **Agent 写回 inbox**：外部智能体产出经审核后写入 vault。
