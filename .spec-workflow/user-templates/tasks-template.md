# Tasks Document · {{featureName}}

> 性质：[Rust 后端为主 / 前端为主 / 全栈]。本模板为 Helmose 项目定制版（覆盖默认）。
> 执行顺序：[列出 task 依赖链，如「契约模块(1) → indexer 改造(2) → 命令(3) → 前端(4) → 裁判(5)」。1 是 2/4 的依赖]。
> 验证：每个 Rust task 跑 `cd src-tauri && cargo check` + `cargo test`；前端 task 跑 `cd frontend && pnpm build`；最后一个 task 全量三件套。
> 铁律：**绝不改 `~/wiki` vault 原文**（索引侧纯只读）；写 vault 必须「备份 + 授权」；IPC 字段 snake_case。

- [ ] 1. [Rust 契约/service 层 task —— 通常先做，是后续依赖]
  - File: `src-tauri/src/services/[模块].rs`（新建/修改）、`src-tauri/src/services/mod.rs`（加 `pub mod [模块];`）
  - [实现要点：按 design Component X，列清接口签名 + 数据 + 纯函数逻辑]
  - Purpose: [一句话，对应 Req X]
  - _Leverage: [`现有模块::函数`、参考的 design Component]_
  - _Requirements: [X.1, X.2]_
  - _Prompt: Implement the task for spec {{featureName}}, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Rust 系统程序员 | Task: [完整指令，含文件路径、接口签名、数据、逻辑、单测覆盖点] | Restrictions: [纯函数无外部依赖/不写库/不碰 vault 原文/契约严格按 design 表] | Success: [编译通过 + 单测全过 + cargo check/test 绿]。完成后把本任务 [ ]→[-]→[x] 并用 log-implementation 记录_

- [ ] 2. [Rust 命令层 task —— IPC 命令 + DTO + 注册]
  - File: `src-tauri/src/commands/[领域].rs`（新建/修改）、`src-tauri/src/models/`（加 DTO）、`src-tauri/src/commands/mod.rs`（加 `pub mod`）、`src-tauri/src/main.rs`（invoke_handler 注册）
  - [`#[tauri::command] fn xxx(...) -> Result<T, String>`，`State<'_, Database>` 取库；涉及 note_type/目录判定复用 `services::contract`]
  - Purpose: [对应 Req]
  - _Leverage: [现有命令写法（如 `vault.rs::add_vault`）、`services::contract`]_
  - _Requirements: [X.X]_
  - _Prompt: Implement the task for spec {{featureName}}, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Rust Tauri 命令开发 | Task: [指令] | Restrictions: [错误 .map_err(|e| e.to_string())?；DTO snake_case；不碰 vault 原文] | Success: [命令注册可用 + cargo check/test 绿]。完成后 [ ]→[-]→[x] 并 log-implementation_

- [ ] 3. [前端 task —— types + api + Page/Component]
  - File: `frontend/src/types/index.ts`（加接口，snake_case 对齐 Rust）、`frontend/src/api/index.ts`（加 invoke 封装）、`frontend/src/pages|components/[X].tsx`
  - [types 对齐 Rust serde（snake_case）；api 加 `invoke('xxx_command', { snakeCase })`；React 页面 hooks → 早返回 → JSX，中文注释]
  - Purpose: [前端落地]
  - _Leverage: [现有 `api/index.ts` invoke 模式、现有 Page/Component 风格]_
  - _Requirements: [X.X]_
  - _Prompt: Implement the task for spec {{featureName}}, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React/TypeScript 前端 | Task: [指令] | Restrictions: [IPC 字段 snake_case 对齐；不引入新依赖；hooks→早返回→JSX；中文注释] | Success: [pnpm build 绿，类型正确]。完成后 [ ]→[-]→[x] 并 log-implementation_

- [ ] 4. 客观裁判全绿 + 行为验证
  - `cd src-tauri && cargo check`（0 error）、`cd src-tauri && cargo test`（含 smoke 对 `~/wiki`）、`cd frontend && pnpm build`
  - 重点验证：[本期功能的关键行为，如「type=project 正确判定」「note id 稳定」]
  - Purpose: 验证无回归（全部 Req）
  - _Leverage: CLAUDE.md 验证命令_
  - _Requirements: All_
  - _Prompt: Implement the task for spec {{featureName}}, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Engineer | Task: 跑客观裁判三件套确认全绿无回归；重点核对 [本期关键行为] | Restrictions: 不为通过裁判而改业务逻辑；发现回归立即回退修复并重跑 | Success: 三件套全绿，重点核对项通过。完成后 [ ]→[-]→[x] 并 log-implementation_

## 未列入本期（backlog）
- [明确列出本期不做的项，防 scope creep。每个注明留到哪个后续 spec。]
