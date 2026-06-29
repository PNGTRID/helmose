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
- **AI**：DeepSeek-V4-Pro（主）/ GLM-5.2（备），provider 层移植自 claude-to-im
- **数据**：Obsidian 式 vault，直接读写本地 markdown 文件夹，与 Obsidian 共存

## 架构（4 层）

```
UI 层（React+antd）→ 内置 AI 层（TS，移植 claude-to-im）
→ Vault 数据层（Rust：onboarding/notify监听/分层解析/SQLite索引）
→ Agent 接口层（导出 LIFE-STATE.md + state.json，inbox 写回保护）
```

## 开发

```bash
# 安装前端依赖
cd frontend && npm install

# 启动开发（前端 + Tauri）
npm run tauri:dev

# 仅前端
npm run dev
```

首次启动会引导选择 vault 文件夹（默认候选 `~/wiki`）或新建 Life OS 目录骨架。

## 状态

🚧 v0.1 开发中——先把数据底座和"今日聚焦"做对，v0.2 接入 AI。

详见 [实施计划](../../.claude/plans/delightful-coalescing-kazoo.md)。
