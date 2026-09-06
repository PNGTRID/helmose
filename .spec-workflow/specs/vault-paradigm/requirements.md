# Requirements Document · Helmose 范式转移（vault-paradigm 总纲）

## Introduction

### 背景：一次范式转移

Helmose 当前是「被动解析任意 Obsidian vault 的阅读器」。证据：[`services/indexer/layers.rs`](../../../src-tauri/src/services/indexer/layers.rs) 硬编码了 `0-日志 / 1-我 / 2-业务 / 5-经历` 这套**旧编号**做分层判定（甚至含作者姓名 `1-我/张三` 当 `profile` 判定条件）。而作者真实 vault 早已迁移到 `00_收件箱 ~ 09_核心知识库` 的新编号体系（见 `~/wiki/规范.md` 的「旧编号体系映射」表）。

后果：索引器靠猜且猜错 → `projects/okrs/events` 表为空 → note id 每次全量索引随机重建 → 文件移动即断链。Helmose 实际上是「一座过时化石 vault 的阅读器」，而非通用产品。

### 重大发现：契约源已存在

作者 vault 根目录的 `规范.md`（持续维护，更新日期 2026-06-30）已经是一套**成熟的、AI 原生的人生知识库契约**：

- **目录契约**：`00_收件箱 / 01_企业与项目资产 / 02_金融与不动产资产 / 03_IP与内容资产 / 04_关系与社群资产 / 05_个人成长与认知资产 / 06_学习与资源资产 / 07_决策与复盘 / 08_档案库 / 09_核心知识库`
- **frontmatter type 契约**：`profile / person / project / strategy / book / course / tool / method / experience / comparison / query`，每种 type 有明确的存放目录
- **标签体系 / 页面阈值 / 更新策略 / frontmatter 模板**
- **AI 运维机制**：`AI-` 前缀文件（维护日志、管道资产、收入仪表板等）+ Hermes 智能体（Cron/Skill）+ DASHBOARD 每日驾驶舱

**结论：Helmose 的「契约层」不应另起炉灶，而应成为 `规范.md` 这套契约的官方实现 / 客户端。** 新用户安装 = 生成这套 00~09 骨架 + type 模板；作者的现有 vault = 按新契约重新索引。

### 北极星

从「读 vault 的阅读器」→「**实现 `规范.md` 契约、主动维护结构骨架与关系网的人生数据底座**」，人读 + Agent 读双导向。底层始终是 markdown（Obsidian / Hermes 共存，不绑架用户）。

### 本 spec 性质

**总纲 spec（路线图）**。覆盖阶段 0–5 的需求，粒度按阶段/能力域。后续每个阶段（脚手架、引用完整性、可视化编辑、AI/Agent）各开**独立子 spec** 细化 tasks。本 spec 仅锁定方向、契约与命门决策。

## Alignment with Product Vision

- 落实 product.md「人读 + Agent 读双导向」「vault 唯一真相源」「与 Obsidian 共存」三条核心原则。
- 把 product.md 的 Future Vision（规范结构、wikilink、增量索引、AI 教练、Agent 写回）整合为一条范式转移主线。
- 实现作者已有的 `规范.md` 契约，而非发明新结构——这是对「数据主权」「本地优先」原则的延续。

## 命门决策（已与用户确认，后续 spec 不得偏离）

| 决策 | 结论 | 影响范围 |
|---|---|---|
| 目录契约 | 对齐 `规范.md` 的 00~09 资产域骨架（不另起炉灶） | 契约层、脚手架、索引器 |
| note id 方案 | content hash（sha256 规范化正文），零侵入 vault | 引用完整性、移动感知、状态导出 |
| 现有 vault 兼容 | 作者 1.9 万 md vault（00~09 新体系）在新契约下无缝索引，不要求用户重组文件 | 索引器、脚手架 |

## Requirements

### Requirement 1：契约层 —— 内置并对齐 `规范.md`（阶段 0B）

**User Story:** 作为 Helmose，我需要内置一份与 `~/wiki/规范.md` 一致的结构契约（目录 + frontmatter type + 标签），作为索引 / 脚手架 / 可视化编辑的统一依据，以结束 layers.rs 靠猜的历史。

#### Acceptance Criteria
1. WHEN Helmose 启动 THEN 系统 SHALL 内置一份契约定义（集中模块/配置），覆盖 00~09 顶层目录、11 种 frontmatter type、type→目录映射、标签体系。
2. WHEN 索引 vault THEN 系统 SHALL 按契约的 type→目录映射判定 `note_type`（取代 layers.rs 的硬编码前缀），并保留容错：无匹配 type 时降级按内容/frontmatter 推断，而非丢弃。
3. WHEN 契约与 `规范.md` 存在差异 THEN 系统 SHALL 以 `规范.md` 为单一真相源；契约定义的同步机制在 design 阶段确定。
4. layers.rs 的旧编号硬编码（含 `1-我/张三` 等私货）SHALL 被移除或迁出，不再参与判定。

### Requirement 2：脚手架 —— 安装即生成规范结构（阶段 1）

**User Story:** 作为新用户，我希望安装后一键创建一套与作者一致的知识库骨架（00~09 目录 + 待填写模板），以便开箱即用、清楚知道往哪里写。

#### Acceptance Criteria
1. WHEN 新用户在 onboarding 选择「创建我的知识库」THEN 系统 SHALL 在指定路径生成 00~09 目录骨架。
2. WHEN 生成骨架 THEN 系统 SHALL 同时生成每种 type 的待填写模板文档（带 frontmatter 占位 + 引导文字），根目录生成 `规范.md / 目录.md / README.md` 模板。
3. WHEN 用户已有 vault（如作者的 `~/wiki`）THEN 系统 SHALL 跳过脚手架，按契约直接索引现有结构，**不创建 / 移动 / 重命名任何已有文件**。
4. 脚手架 SHALL 只生成通用骨架与模板，不包含作者私有业务内容（白墨工厂 / 抖店等具体实体仅作可选示例或留空）。

### Requirement 3：note id 稳定化（阶段 0A）

**User Story:** 作为引用完整性的地基，我需要每个 note 拥有一个稳定、不随移动/重命名变化的 id，以支撑反向链接、移动感知、状态导出。

#### Acceptance Criteria
1. WHEN 索引一篇 note THEN 系统 SHALL 用其规范化正文的 content hash（sha256）作为稳定标识，不再使用每次随机的 uuid。
2. WHEN 文件被移动/重命名且内容不变 THEN 系统 SHALL 通过 content hash 识别为「同一篇换位置」，保持其 id 与所有关联（links / backlinks）不变。
3. WHEN 文件内容被编辑 THEN 系统 SHALL 结合 mtime + content hash 追踪其为同一篇的演化（具体策略 design 定），不视为全新文件。
4. 全量重建索引时，已有 note 的稳定标识 SHALL 与增量保持一致（可复现、不漂移）。

### Requirement 4：结构化数据落地（阶段 2）

**User Story:** 作为用户 / 智能体，我希望 `projects / okrs / events / tasks` 等表按契约 type 自动填充，以让项目看板 / 任务页 / Agent 状态导出不再是空壳。

#### Acceptance Criteria
1. WHEN 索引 `type=project` 的文档 THEN 系统 SHALL 解析其 frontmatter / 正文结构并填充 `projects` 表（原空表）。
2. WHEN 索引含 OKR / key-result 结构的文档 THEN 系统 SHALL 填充 `okrs` 表。
3. WHEN 索引含日期 / 事件结构的文档 THEN 系统 SHALL 填充 `events` 表。
4. 数据模型与 schema SHALL 与 `规范.md` 的 type 体系对齐；新增 type 时表结构可扩展。

### Requirement 5：引用完整性 —— 移动/重命名不断链（阶段 3）

**User Story:** 作为用户，我希望移动/重命名文件后，所有指向它的引用（反向链接、wikilink、路径型引用）自动跟随更新，像 Obsidian 一样不丢失关系。

#### Acceptance Criteria
1. WHEN 用户在 Helmose 内移动/重命名文件 THEN 系统 SHALL 提供 Move / Rename 命令（不依赖 Obsidian 手动操作）。
2. WHEN 移动发生 THEN 系统 SHALL 仅靠稳定 id（content hash）自动更新 Helmose 索引层（反向链接、links、状态导出），**不碰 vault 原文**。
3. IF 其他文档含路径型引用（相对路径 link、frontmatter 路径）指向被移动文件 THEN 系统 SHALL 弹出确认「检测到 N 处引用，是否一并更新？」，**经用户授权后**才修改这些文档原文。
4. WHEN 任何写 vault 原文的操作执行前 THEN 系统 SHALL 先备份到 `.helmose/backup/`，绝不偷偷改原文。

### Requirement 6：可视化编辑（阶段 4）

**User Story:** 作为用户，我希望按文档 type 直接可视化编辑（OKR 进度条 / 项目看板 / 任务勾选），而非手写 markdown。

#### Acceptance Criteria
1. WHEN 打开 `type=project` 文档 THEN 系统 SHALL 提供看板 / 表单式编辑（状态、里程碑、关联 OKR）。
2. WHEN 打开含 OKR 结构的文档 THEN 系统 SHALL 提供 key-result 卡片 / 进度条编辑。
3. WHEN 可视化编辑提交 THEN 系统 SHALL 将结构变更写回规范 markdown（frontmatter + 正文），保持 Obsidian / Hermes 可读。
4. 编辑写回 vault 前 SHALL 走备份机制（同 Req 5.4）。

### Requirement 7：Agent 接口 —— `agent.md` + 状态接口（阶段 5）

**User Story:** 作为外部智能体（如 Hermes），我希望读取一份 `agent.md` 了解 Helmose 提供的能力与状态接口，以便协作而非各自为政。

#### Acceptance Criteria
1. 系统 SHALL 生成并维护一份 `agent.md`（机器读向），说明 Helmose 定位、vault 规范结构、IPC 能力清单、状态接口（`LIFE-STATE.md` / `state.json`）、`AI-` 文件维护约定、协作边界。
2. `agent.md` SHALL 与 `规范.md` 的 AI 运维机制对齐，作为 Helmose 与 Hermes / Codex / OpenClaw 等智能体的协作契约。
3. Agent 状态导出 SHALL 在 Req 4 数据落地后输出真实的「主线 / 项目 / 任务 / OKR」状态（不再空跑降级）。

## Non-Functional Requirements

### Code Architecture and Modularity
- 契约定义集中为**单一模块**（如 `services/contract/`），被 indexer / scaffold / editor 共享，作为唯一真相源。
- layers.rs 的硬编码前缀逻辑被契约驱动取代；indexer 继续「纯解析不写库」（写库在 commands 层）。
- 命令层按领域拆分（scaffold / move / edit / agent），遵循 `commands ↔ services/models` 单向依赖。

### Performance
- 现有性能红线继续生效：列表 / 树只传 `NoteMeta`（无正文），1.9 万 md 不爆 IPC。
- content hash 计算 SHALL 增量 / 惰性（全文索引时算一次并缓存到 notes 表），不在每次查询重复计算。
- 脚手架生成的模板文档数量可控，不触发大规模重索引。

### Security / 铁律
- **vault 原文默认只读**。任何写 vault（脚手架创建新 vault 除外；移动更新引用、可视化编辑、Agent 写回）MUST 走「写前备份 `.helmose/backup/` + 用户明确授权」。
- content hash 仅基于正文内容，不含敏感路径信息。

### Reliability
- 契约容错：无匹配 type 的文档不报错，降级为默认层；索引 / 移动失败有回滚或日志。
- 增量索引的移动判定（content hash 相同）有冲突处理：两篇内容相同导致 hash 碰撞时的歧义消解策略在 design 阶段确定。

### Compatibility · 现有 vault 兼容（强制）
- 作者现有 1.9 万 md vault（00~09 新体系）MUST 在新契约下无缝索引，**不要求用户重新组织文件**。
- 旧编号残留（layers.rs 引用的 `0-日志` 等，规范.md 显示已迁移）SHALL 被新契约兼容或忽略，不阻塞索引。
