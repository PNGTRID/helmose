# Requirements Document · {{featureName}}

> 本模板为 Helmose 项目定制版（覆盖 `templates/requirements-template.md`）。
> 写作铁律：中文 + EARS 句式验收标准 + 对齐 steering + vault 真相源。

## Introduction

### 背景

[这个功能解决什么具体痛点？给一个真实场景/例子。如果是修 bug，贴出现状证据（文件路径 + 行为）。]

### 北极星

[一句话：从「现状」→「目标」。必须是用户可感知的结果，不是技术动作。]

### 本 spec 性质

[独立 spec / 子 spec / 总纲路线图？粒度如何？后续是否拆子 spec？]

## Alignment with Product Vision

[对齐 `steering/product.md` 的哪些核心原则。Helmose 三条铁律可选引用：
「人读 + Agent 读双导向」「vault 唯一真相源」「与 Obsidian 共存」。]

## 命门决策（与用户确认后，后续 spec 不得偏离）

| 决策 | 结论 | 影响范围 |
|---|---|---|
| [决策点] | [结论] | [影响哪些模块/层] |

> 无关键决策时可删此节。

## Requirements

### Requirement 1：[能力名]

**User Story:** 作为 [角色]，我希望 [能力]，以便 [价值]。

#### Acceptance Criteria

1. WHEN [事件] THEN 系统 SHALL [响应]。
2. IF [前置条件] THEN 系统 SHALL [响应]。
3. WHEN [事件] AND [条件] THEN 系统 SHALL [响应]。

> EARS 句式强制：`WHEN/IF … THEN 系统 SHALL …`，每条带编号供 tasks 追溯（`_Requirements: 1.1`）。

### Requirement 2：[能力名]

**User Story:** 作为 [角色]，我希望 [能力]，以便 [价值]。

#### Acceptance Criteria

1. WHEN [事件] THEN 系统 SHALL [响应]。

## Non-Functional Requirements

### Code Architecture and Modularity

- [模块边界：哪个层负责什么。Helmose 分层：`commands`(IPC) ↔ `services`(解析/契约) ↔ `models`(DTO) ↔ `indexer`(纯解析不写库)。]
- [单一契约点：涉及 note_type/目录判定时复用 `services::contract`，勿自写前缀映射（架构铁律 4）。]

### Performance

- [Helmose 性能红线：vault ~1.9 万 md。列表/树只回 `NoteMeta`（无正文）；单篇才取全文。新增查询先想「会不会一次拉太多」。]

### Security / 铁律

- **vault 原文默认只读**（架构铁律 2）。任何写 vault MUST 走「写前备份 `.helmose/backup/` + 用户明确授权」；脚手架仅对空目录写（新建 vault 豁免）。
- IPC 返回 JSON 字段保持 **snake_case**（架构铁律 3），前端 TS 接口对齐。

### Reliability

- [容错策略：无匹配 type 降级而非报错；索引失败有回滚/日志。]

### Compatibility

- [现有 vault 兼容：作者 1.9 万 md 在新契约下无缝索引，不要求用户重组文件。]
