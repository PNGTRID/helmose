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

✅ **v0.1**：数据底座（vault 索引 + SQLite 派生缓存 + `notify` 增量监听）、文档库（目录树浏览 / CodeMirror 编辑写回 / markdown 预览 / 反向链接 / 关系图谱）、全库搜索（FTS5）、Agent 状态导出（`LIFE-STATE.md` + `state.json`）、脚手架（新建 Life OS 骨架）均已落地。

🚧 **v0.2**：接入 AI 教练层（主线判定 / 每日建议 / 明日一句）、Agent inbox 写回。

各功能的设计与任务分解见 [.spec-workflow/specs/](.spec-workflow/specs/)。
