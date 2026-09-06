# Requirements Document · vault-paradigm-scaffold（契约地基 + note-id + 脚手架）

> vault-paradigm 总纲的**阶段 0A + 0B + 1** 实现子 spec。范式转移的地基：先让 Helmose「按规范.md 契约正确读懂 vault」+「给每篇 note 稳定身份证」+「让新用户开箱即用」，后续引用完整性 / 可视化编辑 / Agent 接口才有的放矢。

## Introduction

### 本子 spec 的位置

总纲 `vault-paradigm` 锁定了范式转移的方向与命门决策（目录契约对齐 `规范.md`、note id 用 content hash、现有 vault 兼容），但粒度按阶段。本子 spec 把其中 **阶段 0A + 0B + 1** 落地为可执行任务：

- **阶段 0B · 契约层**：把 `~/wiki/规范.md` 这套成熟契约内置为 Helmose 的单一真相模块，让 indexer 不再靠 `layers.rs` 硬编码旧编号猜 `note_type`。
- **阶段 0A · note-id 稳定化**：用规范化正文的 sha256 作 note 标识，取代当前每次全量索引随机的 uuid，为引用完整性 / 移动感知打地基。
- **阶段 1 · 脚手架**：新用户 onboarding「创建我的知识库」一键生成与作者一致的 00~09 骨架 + type 模板。

三块合一是因为：脚手架（写）必须复用契约层（0B）的目录/type 定义，而稳定 id（0A）是后续所有「关系网」能力的地基——三者构成范式转移的第一块完整地基。

### 调研已确认的关键事实

- `~/wiki/规范.md`（251 行，2026-06-30 维护中）已是成熟契约：10 个顶层目录（`00_收件箱` ~ `09_核心知识库`）、11 种 frontmatter type、完整 **type→存放目录映射表**、标签体系、frontmatter 模板、旧→新编号映射表。
- 现有 [`layers.rs`](../../../src-tauri/src/services/indexer/layers.rs) 硬编码旧编号（`0-日志 / 1-我 / 2-业务 / 5-经历 / 4-工具与效率 / 3-学习 / 2-创作`），且含私货 `1-我/张三`→`profile`，与规范.md 新体系完全脱节。
- [`database.rs`](../../../src-tauri/src/services/database.rs) 的 `notes.content_hash TEXT` 列**已就绪**（当前填 `None`）；note id 当前在 [`index.rs`](../../../src-tauri/src/commands/index.rs) 用 `uuid::Uuid::new_v4()` 随机生成。
- [`index.rs`](../../../src-tauri/src/commands/index.rs) 与 [`library.rs`](../../../src-tauri/src/commands/library.rs) 的 `EXCLUDE_DIRS`（`6-原始资料`、`专家团`）是旧路径，新体系下需重对齐（架构铁律 5）。

## Alignment with Product Vision

- 落实 product.md「vault 唯一真相源」「与 Obsidian 共存」「人读 + Agent 读双导向」三条核心原则。
- 把总纲命门决策（目录契约 / content hash / 现有 vault 兼容）从「决策」推进到「可运行代码」。
- 为 product.md Future Vision 的 wikilink 跳转、增量索引、AI 教练提供稳定 id 与契约地基。

## Scope

**In（本 spec 做）**
- 阶段 0B：契约层模块 + indexer 按契约判定 `note_type` + 删 `layers.rs` 旧编号硬编码。
- 阶段 0A：content hash 作 note id + 全量索引可复现。
- 阶段 1：脚手架命令（生成 00~09 骨架 + 11 type 模板 + 根目录 3 文件）+ onboarding 接入。
- 排除目录按新体系对齐（`index.rs` ↔ `library.rs` 一致）。

**Out（各自独立子 spec）**
- 阶段 2 结构化数据落地（projects / okrs / events 表填充）。
- 阶段 3 引用完整性（移动/重命名命令 + 反向链接跟随 + 写前备份）。
- 阶段 4 可视化编辑。
- 阶段 5 Agent 接口（`agent.md` + 状态导出）。
- note id 的「增量 watcher 移动感知」——本 spec 只做 hash 作 id + 全量索引可复现；增量监听的移动判定留阶段 3。

## Requirements

### Requirement 1：契约层 —— 内置规范.md 契约（阶段 0B，对应总纲 Req 1）

**User Story:** 作为 Helmose，我需要内置一份与 `~/wiki/规范.md` 一致的结构契约（目录 + frontmatter type + 标签），作为索引 / 脚手架的统一依据，以结束 `layers.rs` 靠猜的历史。

#### Acceptance Criteria
1. WHEN Helmose 编译启动 THEN 系统 SHALL 内置一份集中的契约定义（单一模块，如 `services/contract/`），覆盖规范.md 的 00~09 顶层目录、11 种 frontmatter type（profile/person/project/strategy/book/course/tool/method/experience/comparison/query）、type→存放目录映射、标签体系。
2. WHEN 索引 vault THEN 系统 SHALL 按契约判定 `note_type`，优先级为：frontmatter.type（若属于 11 种内）→ 文件所在目录按 type→目录映射反查 → 内容/frontmatter 推断降级，取代 `layers.rs` 的硬编码前缀。
3. IF 文档无匹配 type THEN 系统 SHALL 降级为默认层（不报错、不丢弃），保证索引鲁棒。
4. `layers.rs` 的旧编号硬编码（`0-日志/1-我/2-业务/...`）及私货 `1-我/张三`→profile SHALL 被移除，不再参与判定。
5. WHEN 契约定义与 `规范.md` 存在差异 THEN 系统 SHALL 以 `规范.md` 为单一真相源；具体同步 / 校验机制（如启动时比对、校验命令）在 design 阶段确定。

### Requirement 2：note-id 稳定化（阶段 0A，对应总纲 Req 3）

**User Story:** 作为引用完整性的地基，我需要每个 note 拥有一个稳定、不随移动/重命名变化的 id，以支撑反向链接、移动感知、状态导出。

#### Acceptance Criteria
1. WHEN 索引一篇 note THEN 系统 SHALL 用其规范化正文（去 frontmatter）的 content hash（sha256）作为稳定标识，取代当前随机 uuid。
2. WHEN 文件被移动/重命名且内容不变 THEN 系统 SHALL 通过 content hash 识别为「同一篇换位置」（全量重建场景），保持其 id 与所有关联（links / backlinks）不变。
3. WHEN 全量重建索引 THEN 已有 note 的稳定标识 SHALL 与增量保持一致（可复现、不漂移）。
4. content hash 计算 SHALL 在全量索引时算一次并缓存到 notes 表（列已就绪），不在每次查询重复计算（性能红线）。
5. IF 两篇文档规范化正文完全相同导致 hash 碰撞 THEN 系统 SHALL 有歧义消解策略（如叠加路径短哈希、保留多对一并标记），具体在 design 阶段确定。
6. WHEN note id 由 uuid 切换为 hash THEN 系统 SHALL 处理已有 SQLite 缓存的外键一致性（tasks / links / projects 的 `note_id`），迁移策略在 design 阶段确定。

### Requirement 3：脚手架 —— 安装即生成规范结构（阶段 1，对应总纲 Req 2）

**User Story:** 作为新用户，我希望安装后一键创建一套与作者一致的知识库骨架（00~09 目录 + 待填写模板），以便开箱即用、清楚知道往哪里写。

#### Acceptance Criteria
1. WHEN 新用户在 onboarding 选择「创建我的知识库」并指定一个**空目录** THEN 系统 SHALL 在该路径生成 00~09 目录骨架。
2. WHEN 生成骨架 THEN 系统 SHALL 同时生成 11 种 type 的待填写模板文档（带 frontmatter 占位 + 引导文字，存放于契约规定的对应目录），并在根目录生成 `规范.md / 目录.md / README.md` 模板。
3. WHEN 用户指定的是**已有 vault**（如作者的 `~/wiki`）THEN 系统 SHALL 跳过脚手架，按契约直接索引现有结构，**不创建 / 移动 / 重命名任何已有文件**。
4. 脚手架 SHALL 只生成通用骨架与模板，不包含作者私有业务内容（白墨工厂 / 抖店等具体实体仅作可选示例或留空）。
5. 脚手架 SHALL 仅在用户明确选择的目标路径写入；IF 目标目录非空且未被识别为已有 vault THEN 系统 SHALL 拒绝写入并提示用户，绝不偷偷向非空目录铺文件。

### Requirement 4：排除目录契约对齐（架构铁律 5）

**User Story:** 作为系统一致性，索引视图与浏览视图的排除目录必须一致，且按规范.md 新体系。

#### Acceptance Criteria
1. `EXCLUDE_DIRS` SHALL 按新体系重新确认：旧 `6-原始资料`（现位于 `08_档案库/原始资料/6-原始资料/`）、`专家团`（现位于 `04_关系与社群资产/专家团/`）等大体积目录的排除策略在 design 阶段定（按新路径或按目录体积策略），且 `commands/index.rs` 与 `commands/library.rs` MUST 保持一致。
2. 隐藏目录（`.obsidian / .helmose / .git / .trash / .DS_Store / node_modules`）SHALL 继续排除，与 onboarding `default_excludes` 对齐。

## Non-Functional Requirements

### Code Architecture and Modularity
- 契约定义集中为**单一模块**（`services/contract/`），被 indexer / scaffold 共享，作为唯一真相源。
- `layers.rs` 的硬编码前缀逻辑被契约驱动取代；indexer 继续「纯解析不写库」（写库在 commands 层）。
- 新增脚手架命令按领域拆为独立命令文件（如 `commands/scaffold.rs`），遵循 `commands ↔ services/models` 单向依赖。

### Performance
- 现有性能红线继续生效：列表 / 树只传 `NoteMeta`（无正文），1.9 万 md 不爆 IPC。
- content hash 计算 SHALL 全量索引时算一次并缓存到 notes 表，不在每次查询重复计算。
- 脚手架生成的模板文档数量可控（10 目录 + 11 type 模板 + 3 根文件 ≈ 24 个文件），不触发大规模重索引。

### Security / 铁律
- **vault 原文默认只读**。脚手架是「新建 vault」豁免情形：仅对用户明确选择的**空目标目录**写入，**绝不碰已有 vault（~/wiki）**。
- 脚手架写入无需备份（没有原文被改）；但 SHALL 仅限新建空 vault 场景。
- content hash 仅基于正文内容，不含路径等敏感信息。

### Reliability
- 契约容错：无匹配 type 的文档不报错，降级为默认层。
- 全量索引失败有事务回滚（现有机制）与日志。

### Compatibility · 现有 vault 兼容（强制）
- 作者现有 1.9 万 md vault（00~09 新体系）MUST 在新契约下无缝索引，**不要求用户重新组织文件**。
- 旧编号残留（`layers.rs` 引用的 `0-日志` 等）SHALL 被新契约兼容或忽略，不阻塞索引。
