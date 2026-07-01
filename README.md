# Helmose · 人生操作系统

> helm（舵手）—— AI 替你掌舵人生主线。
>
> 一个 AI 驱动的人生知识库桌面 App：把任务 / 日志 / 项目 / 笔记整理成**人和智能体都能消费**的清晰结构，内置 AI 扮演**教练 + 秘书 + 第二大脑**，同时开放标准化状态接口给 Hermes / Codex / OpenClaw 等外部智能体。

## 产品定位

**人读 + Agent 读双导向**的人生数据底座。市面笔记软件只面向人读，Helmose 同时产出机器可读的 `LIFE-STATE.md` / `state.json`，让外部智能体定时读取后即可：

- 判断此刻该聚焦哪条**主线/副线**（教练）
- 每天告诉你**该做什么**（秘书）
- 完整还原**你是谁、做过什么**（第二大脑）

## 技术栈

- **桌面**：Tauri v2 + Rust（rusqlite / notify / pulldown-cmark）
- **前端**：React 19 + TypeScript + Vite + antd v6 + Zustand
- **AI 教练层**：规划接入（v0.2）；当前版本不含 LLM 调用
- **数据**：Obsidian 式 vault，直接读写本地 markdown 文件夹，与 Obsidian 共存

## 架构（4 层）

```
UI 层（React+antd，Obsidian 式工作台外壳）→ 内置 AI 层（规划 v0.2）
→ Vault 数据层（Rust：onboarding / notify 增量监听 / 契约驱动分层解析 / SQLite 索引）
→ Agent 接口层（导出 LIFE-STATE.md + state.json 已实现；inbox 写回规划中）
```

## 开发

```bash
# 安装前端依赖（用 pnpm；本机 npm 损坏、不建 .bin，统一 pnpm）
cd frontend && pnpm install

# 启动开发（前端 + Tauri 后端；根目录 npm run dev 等价）
cd frontend && npm run tauri:dev

# 仅前端（浏览器，无 Rust 后端）
cd frontend && npm run dev

# —— 验证（客观裁判，改完代码必跑；CI 同此三步）——
cd src-tauri && cargo check      # Rust 类型 + 借用检查
cd src-tauri && cargo test       # Rust 单测（含 #[ignore] 真实 vault smoke test）
cd frontend && pnpm build        # = tsc -b && vite build（前端类型 + 构建）
cd frontend && pnpm test         # vitest 单测
```

首次启动会引导选择 vault 文件夹（默认候选 `~/wiki`）或新建 Life OS 目录骨架。

## 状态

✅ **v0.1 已落地**：
- **数据底座**：vault 索引 + SQLite 派生缓存 + `notify` 增量监听 + 契约驱动分层解析（`content_hash` 稳定 id，移动不变）。
- **Obsidian 式工作台**：Ribbon + 可拖拽 FilePanel（**虚拟列表**，1.9 万节点流畅）+ 标签页 + markdown 预览（wikilink `[[x]]` 可点跳转）+ CodeMirror 编辑写回（写前 `.helmose/backup` 备份）+ **反向链接 / 前向链接** + 关系图谱（d3-force）。
- **结构化提取**：projects 深度结构化 / events 时间线 / tasks due_date / 明日一句。
- **全库搜索**：FTS5 trigram + snippet 高亮，Ctrl/⌘+P 命令面板触发。
- **笔记 CRUD**：创建 / 编辑写回 / 软删除回收站 + 备份管理。
- **标签精确筛选** + **日历 / 今日聚焦 / 任务 / 项目 / 日志页**。
- **Agent 状态接口**：`export_life_state` 写 `LIFE-STATE.md`（人读）+ `state.json`（机读）。
- **脚手架**：新建 Life OS 目录骨架（00~09 + 12 种 type 填写引导模板）。
- **暗色模式** + **ErrorBoundary**（单页崩不白屏）+ **自动更新框架**（updater）+ **重置安装**（reset_app，绝不碰 vault 原文）。

🚧 **v0.2 待办**：AI 教练层（主线判定 / 每日建议 / 明日一句）、Agent inbox 写回、okrs 全链路、可视化编辑（OKR/看板）。

各功能的设计与任务分解见 [.spec-workflow/specs/](.spec-workflow/specs/)。
