# Requirements Document · 前端组件化重构

## Introduction

基于六维审查 + 组件化评估（2026-06-30），Helmose 前端存在 **6 项技术债**：

1. **逻辑重复·wikilink 跳转**——`NoteView.onPreviewClick` 与 `TasksPage.onDrawerClick` 几乎一字不差
2. **逻辑重复·openNote 映射**——`openNote({id,title,file_name,rel_path})` 在 10+ 处重复，字段易写错
3. **胖组件·App.tsx（205 行）**——内联了 70 行 `CommandPalette` + 外壳布局 + 索引/监听副作用
4. **缺 utils 层**——纯函数散落各组件（`dateKey`/`extractOutline`/`makeCompare`/`childDirs`/`fileIcon`）
5. **胖组件·NoteView（205 行）**——阅读/编辑/保存/outline 提取全揉一起
6. **既存竞态·FilePanel**——`listDirs+listAllNotesMeta` 无 cancel flag（与已修的 `useAllNotesMeta` 同模式）

本期是 **纯重构**：消除重复、拆分胖组件、修复竞态，**严格保持用户可见行为不变**。不新增功能、不改动 vault 读写逻辑、不触碰后端 Rust（`src-tauri`）。

价值：提升可维护性（组件单一职责）、消除重复（改一处而非多处）、修复竞态（数据一致性），为后续 AI 教练层等大功能打基础。

## Alignment with Product Vision

- 支撑 product.md「Obsidian 式工作台」——重构后组件更清晰，迭代更快
- 维持 tech.md 技术栈（React 19 + antd 6 + zustand 5 + dayjs），**不引入新依赖**
- 维持性能红线（列表/树只返回 `NoteMeta` 无正文）、IPC snake_case 对齐、vault 原文只读

## Requirements

### Requirement 1：wikilink 跳转逻辑统一

**User Story:** 作为维护者，我想让 wikilink 点击跳转逻辑只有一份实现，以便修 bug 或改行为时只改一处。

#### Acceptance Criteria
1. WHEN 用户在阅读视图/任务 Drawer 点击 `[[wikilink]]` THEN 系统 SHALL 行为与重构前完全一致（搜目标 → 跳转/替换内容）。
2. WHEN 重构完成 THEN `NoteView` 与 `TasksPage` SHALL 不再各自内联跳转逻辑，统一调用 `useWikilinkNavigation`。
3. IF 跳转搜索失败 THEN 系统 SHALL 静默忽略，与现状一致。

### Requirement 2：笔记打开操作统一

**User Story:** 作为维护者，我想用一个便捷调用打开笔记，以免 10+ 处重复写字段映射且易写错。

#### Acceptance Criteria
1. WHEN 任意列表项被点击打开笔记 THEN 系统 SHALL 行为与重构前一致（复用 `useTabsStore.openNote`）。
2. WHEN 重构完成 THEN 各页面/组件 SHALL 通过 `openNoteFromMeta` 打开笔记，不再重复字段映射。
3. IF NoteMeta/SearchResult 字段缺失 THEN 系统 SHALL 保持现有降级（title null → 用 file_name，由 store 现有逻辑兜底）。

### Requirement 3：命令面板独立组件

**User Story:** 作为维护者，我想让 App.tsx 专注于外壳布局，以降低单文件复杂度。

#### Acceptance Criteria
1. WHEN 用户 Ctrl/⌘+P 触发命令面板 THEN 系统 SHALL 行为与重构前一致（搜索 → 跳转）。
2. WHEN 重构完成 THEN `CommandPalette` SHALL 独立为 `components/CommandPalette.tsx`，App.tsx 仅引入使用。
3. WHEN App.tsx 重构 THEN 其余职责（面板布局/拖拽/索引/监听）SHALL 保持不变。

### Requirement 4：纯函数工具层

**User Story:** 作为维护者，我想让散落各组件的纯函数集中到 utils，以便复用与单测。

#### Acceptance Criteria
1. WHEN 重构完成 THEN `dateKey`/`extractOutline`/`makeCompare`/`childDirs`/`fileIcon` SHALL 集中到 `utils/`（按域分文件）。
2. WHEN 迁移后 THEN 各原调用点 SHALL 行为不变（函数签名/返回值一致）。
3. IF 出现新的同类纯函数 THEN 它 SHALL 放入对应 utils 文件而非组件内联。

### Requirement 5：NoteView 拆分

**User Story:** 作为维护者，我想把 205 行的 NoteView 拆成编辑/预览独立组件，以便各自独立维护。

#### Acceptance Criteria
1. WHEN 用户切换阅读/编辑 THEN 系统 SHALL 行为与重构前一致（含 CodeMirror 实时预览、保存、备份提示）。
2. WHEN 重构完成 THEN `NoteView` SHALL 作容器，组合 `NoteEditor`（编辑模式）与 `NotePreview`（阅读模式）。
3. WHEN 保存笔记 THEN 系统 SHALL 维持现有写 vault + `.helmose/backup` 备份 + 增量重索引流程不变。
4. IF 笔记加载失败 THEN 系统 SHALL 维持现有 loading/空态兜底。

### Requirement 6：文件树加载竞态修复

**User Story:** 作为用户，我想文件树在密集文件变化时数据一致，不出现旧数据覆盖新数据。

#### Acceptance Criteria
1. WHEN watcherTick 快速连续变化 THEN `FilePanel` SHALL 丢弃过期的 fetch 响应，仅采用最新结果（与 `useAllNotesMeta` 的 cancelled flag 模式一致）。
2. WHEN FilePanel 卸载 THEN pending fetch SHALL 不再 setState。
3. WHEN 重构完成 THEN 文件树/搜索/排序的用户可见行为 SHALL 不变。

### Requirement 7：非功能性（行为不变 + 红线维持）

#### Acceptance Criteria
1. WHEN 重构完成 THEN 所有用户可见功能 SHALL 与重构前逐项一致（无行为回归）。
2. WHEN 任何重构发生 THEN 系统 SHALL 维持性能红线（列表/树只返回 NoteMeta 无正文）。
3. WHEN 任何重构发生 THEN 系统 SHALL 维持 IPC snake_case 对齐、vault 原文只读（编辑功能维持现有备份保护）。
4. WHEN 重构完成 THEN 客观裁判 SHALL 全绿（`cargo check` + `cargo test` + `npm run build`）。

## Non-Functional Requirements

### Code Architecture and Modularity
- **单一职责**：组件 / hook / utils 各司其职
- **消除重复**：wikilink 跳转、openNote 映射各只一份
- **清晰分层**：pages / components / hooks / utils / stores / api / types

### Performance
- 重构不引入额外渲染开销；utils 纯函数无副作用

### Security
- 维持 vault 只读（编辑维持 `.helmose/backup` 备份）；无新增注入面

### Reliability
- 维持各处 catch + console.error（不静默）；竞态修复提升数据一致性

### Usability
- 用户可见行为零回归
