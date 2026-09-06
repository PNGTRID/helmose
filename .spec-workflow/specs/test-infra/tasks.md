# Tasks Document · test-infra（测试基建 + CI 门禁）

> 性质：补后端写库集成测试 + CI 门禁 + 覆盖率报告（非功能 spec）。
> 执行顺序：可测性重构（1）→ 写库集成测试（2）→ 关键命令集成测试（3）→ CI workflow（4）→ 覆盖率（5）→ 裁判（6）。1 是 2 的依赖；4/5 可并行。
> 验证：Rust task 跑 `cd src-tauri && cargo check` + `cargo test`；CI/覆盖率 task 校验 workflow 语法 + 本地 dry-run。
> 铁律：集成测试**不依赖 ~/wiki**（用构造 vault）；`index_vault` 重构**行为不变**；测试用临时目录/DB 隔离。

- [x] 1. `index_vault` 可测性重构
  - File: `src-tauri/src/commands/index.rs`
  - 拆 `index_vault` 为 `index_vault_inner(vault_id: &str, db: &Database) -> Result<IndexStats, String>`（承载全部业务逻辑）+ 命令壳（仅 State 解包转调）；`should_reindex` 同样拆 inner；行为零变化
  - Purpose: 让核心写库逻辑可被集成测试直接调用（Req 1.1）
  - _Leverage: `commands/index.rs::index_vault`_
  - _Requirements: 1.1_
  - _Prompt: Implement the task for spec test-infra, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Rust 重构工程师 | Task: 在 src-tauri/src/commands/index.rs 把 index_vault 的全部业务逻辑（vault_root + 遍历 + parse + 碰撞消歧 + 事务写库 + FTS rebuild + 状态更新）移入新函数 index_vault_inner，签名 `fn index_vault_inner(vault_id: &str, db: &Database) -> Result<IndexStats, String>`；原 `#[tauri::command] index_vault(vault_id: String, db: State<'_, Database>)` 改为仅 `index_vault_inner(&vault_id, db.inner())`；should_reindex 同样拆 should_reindex_inner | Restrictions: 纯可测性重构，业务逻辑与对外行为零变化（前端 invoke 不感知）；不动 index_vault_inner 的任何写库/碰撞逻辑；不引入新依赖 | Success: index_vault_inner 可被测试直接调用，cargo check + cargo test 40 passed 不回归，命令行为不变。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 2. 后端写库集成测试（index_vault）
  - File: `src-tauri/src/commands/index.rs`（`#[cfg(test)] mod tests`）
  - 复用 incremental::tests::setup 模式建临时 vault + 临时 DB + 注册 vault；构造 3 个 md（type=project / 普通 / 含 checkbox+wikilink）；调 index_vault_inner 断言 notes.id 64 位 hash、content_hash 实填、projects 表非空、tasks/links 外键；移动文件再索引断言 id 不变
  - Purpose: 写库逻辑自动化验证，取代手跑（Req 1.2-1.4）
  - _Leverage: `incremental.rs::tests::setup`、`scaffold.rs::tests::tmp`_
  - _Requirements: 1.2, 1.3, 1.4_
  - _Prompt: Implement the task for spec test-infra, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Rust 测试工程师 | Task: 在 src-tauri/src/commands/index.rs 加 `#[cfg(test)] mod tests`，setup 复用 incremental.rs 的 incremental::tests::setup 模式（临时 vault_dir + 临时 db_path + Database::new + init_schema + 注册 vault）；构造 3 个 md 文件（① 含 type:project 的 frontmatter、② 普通笔记、③ 含 - [ ] checkbox 与 `[[目标]]` wikilink）；调 index_vault_inner 后断言：notes.id 全为 64 位 hex、notes.content_hash 非 null、projects 表 count 大于等于 1、tasks 表有行、links 表有行且 target_note_id 外键有效；再把其中一个文件改名（改 rel_path 内容不变）重新 index_vault_inner，断言其 id 不变 | Restrictions: 用真 DB + 真临时 FS 不 mock；不依赖 ~/wiki；测试用 pid+计数 唯一临时目录隔离；不引入新依赖 | Success: 集成测试覆盖写库全链路，cargo test 含新增集成测试全绿。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 3. 关键 IPC 命令集成测试
  - File: `src-tauri/src/commands/vault.rs`、`library.rs`、`scaffold.rs`（各加 `#[cfg(test)] mod tests`）
  - add_vault+delete_vault 往返级联；save_note_content 备份+增量+FTS；scaffold→add_vault→index_vault_inner 链路（骨架模板入库）
  - Purpose: 关键写库命令覆盖（Req 2）
  - _Leverage: `vault.rs`、`library.rs`、`scaffold.rs`、`index_vault_inner`_
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Prompt: Implement the task for spec test-infra, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Rust 测试工程师 | Task: 为关键 IPC 命令补集成测试（各文件加 `#[cfg(test)] mod tests`，复用 incremental::tests::setup 模式）：① vault.rs 测 add_vault→list_vaults 查到→delete_vault→确认 notes/tasks/links 级联清理；② library.rs 测 save_note_content 写回后 .helmose/backup/ 下有备份文件、FTS 命中新内容、增量重索引生效；③ scaffold.rs 测 scaffold→add_vault→index_vault_inner 链路，断言脚手架生成的模板 md 被正确索引入库 | Restrictions: 涉及命令带 State 的（save_note_content 等），同样拆 inner 或直接调底层 incremental/upsert 函数绕过 State；用临时 vault+DB 隔离；不依赖 ~/wiki | Success: 关键写库命令有集成覆盖，cargo test 全绿不回归。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 4. CI workflow（GitHub Actions）
  - File: `.github/workflows/ci.yml`（新建）
  - PR/push main 触发；backend job（matrix macos+ubuntu：cargo check + cargo test）；frontend job（ubuntu：pnpm install + build + test）；Swatinem/rust-cache + pnpm/action-setup 缓存
  - Purpose: CI 门禁，main 始终绿（Req 3）
  - _Leverage: `Swatinem/rust-cache`、`pnpm/action-setup`、`actions/setup-node`_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Prompt: Implement the task for spec test-infra, first run spec-workflow-guide to get the workflow guide then implement the task: Role: DevOps/CI 工程师 | Task: 新建 .github/workflows/ci.yml，触发 on pull_request + push to main；backend job 用 matrix（macos-latest, ubuntu-latest）跑 cargo check + cargo test（working-dir src-tauri 或 --manifest-path）；frontend job 在 ubuntu-latest 用 pnpm/action-setup + actions/setup-node 装 pnpm，跑 pnpm install --frozen-lockfile + pnpm build + pnpm test；用 Swatinem/rust-cache 缓存 cargo；任一步失败阻断 | Restrictions: workflow 语法正确（用 actionlint 校验或仔细对齐 GitHub Actions schema）；不引入 secret；cargo test 不依赖 ~/wiki（index_real_wiki_smoke 现有 skip 逻辑兜底）；项目当前无 git remote，文件写好待启用 | Success: ci.yml 语法正确，本地能用 act 或目检确认步骤合理，待推 GitHub 后跑通。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 5. 覆盖率报告
  - File: `.github/workflows/ci.yml`（加覆盖率 step）、`src-tauri/Cargo.toml`（可选）、`frontend/package.json`（加 @vitest/coverage-v8 devDep）
  - cargo-llvm-cov（Rust）+ vitest coverage（前端）跑通产出 lcov；CI artifact 上传；只报告不阻断；index_real_wiki_smoke 加 ignore 显式跳过
  - Purpose: 覆盖率可见（Req 4）
  - _Leverage: `cargo-llvm-cov`、`@vitest/coverage-v8`_
  - _Requirements: 4.1, 4.2, 4.3_
  - _Prompt: Implement the task for spec test-infra, first run spec-workflow-guide to get the workflow guide then implement the task: Role: 测试基建工程师 | Task: 加覆盖率报告——Rust 用 cargo-llvm-cov（CI 装 cargo-llvm-cov 后跑 cargo llvm-cov --workspace --lcov --output-path lcov.info，忽略 #[ignore] 的 smoke），上传 artifact；前端在 frontend/package.json 加 @vitest/coverage-v8 devDep，pnpm test --coverage 产出 lcov；CI workflow 加 coverage job 或 step 上传两份 lcov artifact；给 index_real_wiki_smoke 加 #[ignore] 让 CI 显式跳过（本地 cargo test -- --ignored 跑） | Restrictions: 只报告不设硬门槛、不阻断 PR；不破坏现有 cargo test / pnpm test；cargo-llvm-cov 与 vitest coverage 工具不影响主流程 | Success: CI 产出 Rust + 前端覆盖率 lcov artifact，本地能复现，主测试流程不变。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 6. 客观裁判全绿 + 基建验证
  - `cd src-tauri && cargo check` + `cargo test`（含新集成测试）+ `cd frontend && pnpm build` + `pnpm test`；CI workflow actionlint 校语法
  - Purpose: 验证无回归 + 基建可用（全部 Req）
  - _Leverage: CLAUDE.md 验证命令_
  - _Requirements: All_
  - _Prompt: Implement the task for spec test-infra, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Engineer | Task: 跑客观裁判全量——cd src-tauri 然后 cargo check / cargo test（确认含新增集成测试且全绿、原 40 单测不回归）；cd frontend 然后 pnpm build + pnpm test；用 actionlint（或目检）确认 .github/workflows/ci.yml 语法正确；确认覆盖率 lcov 能产出 | Restrictions: 不为通过裁判改业务逻辑；发现回归立即回对应 task 修复 | Success: cargo check 绿、cargo test 全绿（含集成）、pnpm build 绿、pnpm test 绿、CI workflow 语法正确。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

## 未列入本期（backlog）
- E2E（tauri-driver + Playwright/WebDriver，覆盖关键 UI 流程）
- 契约测试（ts-rs 或 IPC schema 自动校验，Rust serde ↔ 前端 TS）
- 前端组件测试（@testing-library/react + jsdom）
- 覆盖率硬门槛（增量代码 ≥ 80% 阻断 PR）
- Windows 平台 CI matrix
