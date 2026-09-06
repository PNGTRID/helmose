# Product Overview · {{projectName}}

> 本模板为 Helmose 项目定制版（覆盖 `templates/product-template.md`）。
> 这是 steering 文档（项目级方向盘），定义产品定位，是 spec 写作的对齐基准。

## Product Purpose

[产品解决什么问题？一句话定位。Helmose 范式：「人读 + Agent 读双导向」的本地人生数据底座。]

## Target Users

- **主要用户**：[谁，什么场景，什么痛点。]
- **隐式用户**：[如外部 AI 智能体——通过状态接口读取，无需人类中转。]

痛点：
1. [痛点 1]
2. [痛点 2]
3. [痛点 3]

## Key Features

按版本里程碑（当前 **vX.Y**）：

1. **[能力 1]**：[一句话描述]。
2. **[能力 2]**：[一句话描述]。
3. **[能力 3]**：[一句话描述]。

## Business Objectives

- [目标 1]
- [目标 2]

## Success Metrics

- **[指标 1]**：[目标，如「索引完整性：vault 全量 md 100% 入库，耗时 < 10s」]。
- **[指标 2]**：[目标]。

## Product Principles

1. **vault 唯一真相源**：本地 markdown 是主存，SQLite 是派生缓存（删库可从 vault 全量重建）。
2. **vault 原文只读**：索引/查询/浏览一律只读；任何写 vault 必须用户明确动作 + 备份保护。
3. **人读 + Agent 读双导向**：同时产出人读文档与机器可读状态（`LIFE-STATE.md` / `state.json`）。
4. **与 Obsidian 共存**：不绑架用户，不破坏原文，本地优先。

## Monitoring & Visibility

- **Dashboard Type**：[桌面应用 / 命令面板 / 今日聚焦页]。
- **Real-time Updates**：[`notify` 文件监听 + 增量索引]。
- **Key Metrics Displayed**：[索引统计 / 待办 / 主线状态]。

## Future Vision

[产品演进方向。]

### Potential Enhancements
- **AI 教练层**：[主线判定 / 每日建议 / 明日一句]。
- **Agent 写回**：[inbox 带保护写回 vault]。
