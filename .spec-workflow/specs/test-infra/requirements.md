# Requirements Document · test-infra（测试基建 + CI 门禁）

## Introduction

### 背景：测试金字塔中层 + CI 门禁缺位

Helmose 当前测试集中在金字塔**底层**：Rust 40 个 `#[test]`（单元 + 一个 `index_real_wiki_smoke` 只解析**不写库**）、前端 3 个纯函数 vitest 测试。**中层（后端写库集成测试）与 CI 质量门禁都缺**——这是大厂企业级的标配 gap。

后果：`index_vault` 等核心写库逻辑（projects 表填充、note id 落库、tasks/links 外键）只能靠人手跑 `tauri:dev` 验证，回归靠 dogfood，无法可持续迭代；后续阶段 2-5 越往上压越脆。

### 北极星

补「测试金字塔中层 + CI 门禁」，把**能自动化的尽量往下压**（写库集成测试全自动），UI 层留 dogfood + 少量 e2e（后续 spec）。**main 始终绿、写库逻辑有自动化回归护栏、不再靠手验后端**。

### 本 spec 性质

测试基建 spec（非功能 spec）。聚焦**集成测试 + CI 门禁 + 覆盖率报告**三块落地；e2e / 契约测试 / 前端组件测试 / 覆盖率硬门槛列入 backlog（各自后续 spec）。

## Alignment with Product Vision

- 落实 product.md「原文零破坏」「索引完整性」——硬约束必须有回归护栏，靠人眼不可持续。
- 支撑后续阶段 2-5（结构化数据 / 引用完整性 / 可视化编辑 / Agent）的快速迭代——地基测试不到位，越往上越脆。
- 延续「本地优先」：集成测试用本地构造 vault + 临时 SQLite，不依赖外部服务。

## 命门决策（已定，后续 spec 不得偏离）

| 决策 | 结论 | 理由 |
|---|---|---|
| 测试分层策略 | 补中层（集成）+ CI 门禁；e2e / 契约留后续 | 大厂金字塔 ~70/20/10，中层是最大 gap |
| 集成测试依赖 | 用真 SQLite + 真临时文件系统，**不 mock** | mock DB 是反模式，测不出真问题；复用 `incremental::tests` setup 模式 |
| 可测性重构 | `index_vault` 拆出 `index_vault_inner(vault_id, &Database)` | 当前签名带 Tauri `State` 不可直测；拆 inner 让核心可测 |
| CI 平台 | GitHub Actions（cargo check + cargo test + pnpm build + vitest） | 通用；项目当前无 git remote，workflow 写好待推 GitHub 启用 |
| 覆盖率 | 先报告后门槛 | CI 出报告（cargo-llvm-cov + vitest coverage），硬门槛后续设 |
| ~/wiki 依赖 | 集成测试用构造的小 vault，**不依赖 ~/wiki** | CI 无 ~/wiki；`index_real_wiki_smoke` 保留为可选本地测试 |

## Requirements

### Requirement 1：后端可测性重构 + 写库集成测试（最高优先级）

**User Story:** 作为开发者，我需要 `index_vault` 的写库逻辑有自动化集成测试，以不再靠手跑验证 projects 表填充 / note id 落库。

#### Acceptance Criteria
1. WHEN 重构 THEN `index_vault` SHALL 拆出 `index_vault_inner(vault_id, &Database) -> Result<IndexStats, String>`；命令壳仅做 `State` 解包 + 转调，**行为不变**（前端 invoke 不感知）。
2. WHEN 跑集成测试 THEN 用构造的小 vault（临时目录 + 真 SQLite）→ 调 `index_vault_inner` → 断言：`notes.id` 为 64 位 content_hash、`content_hash` 列实填、`type=project` 文档进入 `projects` 表、`tasks`/`links` 外键有效。
3. WHEN 文件移动（改 rel_path、内容不变）后重新索引 THEN 断言其 `id` 不变（content_hash 稳定，验证移动感知地基）。
4. 集成测试 SHALL 不依赖 `~/wiki`（用构造 vault），可在 CI 无障碍跑；与现有 40 单测一起 `cargo test` 全绿、不回归。

### Requirement 2：关键 IPC 命令集成测试

**User Story:** 作为开发者，我需要关键写库命令有集成测试覆盖，而非只测纯函数。

#### Acceptance Criteria
1. `add_vault` + `delete_vault` 往返：注册 → 查 → 删除 → 确认级联清理（notes/tasks/links 随 vault 删）。
2. `save_note_content`：写回 vault → 备份到 `.helmose/backup/` → 增量重索引（FTS / tasks / links 同步更新）。
3. `scaffold_vault` → `index_vault` 链路：脚手架生成骨架 → 注册 → 索引 → 断言骨架文件被正确索引（模板 md 入库）。
4. 每个集成测试 SHALL 用唯一临时 vault + 唯一临时 DB（pid + 计数），隔离不污染。

### Requirement 3：CI 门禁（GitHub Actions）

**User Story:** 作为团队，我需要 PR 合并前 CI 自动跑全量客观裁判，保证 main 始终绿。

#### Acceptance Criteria
1. WHEN PR / 推送 main THEN CI SHALL 跑：`cargo check` + `cargo test`（src-tauri）+ `pnpm install` + `pnpm build` + `pnpm test`（vitest run）。
2. CI SHALL 在 macOS + ubuntu 双平台跑（Tauri 跨平台；Windows 可后续）。
3. 任一步失败 SHALL 阻断 PR（单元/集成失败 = 阻断）。
4. workflow 文件 SHALL 写好并校验语法；待项目推 GitHub remote 后启用（当前无 remote）。

### Requirement 4：覆盖率报告（先报告后门槛）

**User Story:** 作为开发者，我需要看到测试覆盖率，以防测试债累积。

#### Acceptance Criteria
1. CI SHALL 出 Rust 覆盖率（cargo-llvm-cov）+ 前端覆盖率（`@vitest/coverage-v8`），作为 artifact 或 PR 评论。
2. 本阶段 SHALL 只报告，不设硬门槛（避免新 spec 被门槛卡）。
3. 覆盖率工具 SHALL 不破坏现有 `cargo test` / `pnpm test` 流程。

## Non-Functional Requirements

### Code Architecture and Modularity
- `index_vault_inner` 重构保持业务逻辑不变，仅改可测性（命令壳 + inner）。
- 集成测试内嵌 `#[cfg(test)] mod tests`（与现有约定一致），setup 复用 `incremental::tests` 模式。
- CI workflow 用标准 GitHub Actions，缓存 cargo registry + pnpm store 提速。

### Performance
- 集成测试用小 vault（< 50 文件），秒级跑完，不拖 CI。
- CI 缓存依赖，冷启动目标 < 5min。
- `index_real_wiki_smoke` 保留为本地可选（`HELMOSE_TEST_VAULT`），CI 不跑（无 ~/wiki）。

### Reliability
- 测试隔离：每个集成测试用唯一临时目录 + 临时 DB（pid + 计数），不互相污染。
- 测试不依赖外部状态（~/wiki、网络、GUI）。
- CI 失败有清晰日志（cargo / vitest 输出）。

### Compatibility
- CI 在 macOS（Tauri 原生构建需要）+ ubuntu 跑。
- 不改现有 40 单测的行为。
- `index_vault` 重构后前端 `invoke('index_vault')` 行为不变。

## Scope

**In（本 spec 做）**
- `index_vault_inner` 重构 + 后端写库集成测试。
- 关键命令集成测试（add_vault / save_note_content / scaffold→index 链路）。
- GitHub Actions CI workflow（check + test + build + vitest）。
- 覆盖率报告（Rust + 前端，只报告）。

**Out（后续 spec / backlog）**
- E2E（tauri-driver + Playwright/WebDriver，覆盖关键 UI 流程）。
- 契约测试（Rust serde ↔ 前端 TS schema 自动校验，如 ts-rs）。
- 前端组件测试（@testing-library/react + jsdom）。
- 覆盖率硬门槛（本 spec 只报告）。
- 性能测试 / 负载测试。
