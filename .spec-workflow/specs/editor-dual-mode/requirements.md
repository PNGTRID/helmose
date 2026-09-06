# Requirements Document · editor-dual-mode

## Introduction

把笔记编辑器从「阅读 / 编辑」两态（阅读=只读 HTML，编辑=WYSIWYG）重构为 Obsidian 式的**双可编辑模式**：

- **可视化**（默认）：TipTap WYSIWYG，所见即所得（标题/粗体/列表/任务复选框/表格已渲染），不显示 `## **` 等标记。
- **md 化**：markdown 源码模式，等宽 `<textarea>` 直接显示并编辑 `## ** [[]]` 原始标记。

两种模式**默认都可编辑**，切换的是「渲染状态」而非「能否编辑」，对齐 Obsidian「实时预览 / 源码模式」心智。配套：

1. 可视化模式下把 `[[wikilink]]` 做成**可点跳转的彩色链接**（当前是纯文本不可点，去掉只读阅读后会成为体验断点）。
2. **修复顶栏复制/删除按钮错位**（现 `justify-between` 把元信息、模式切换、复制、删除 4 元素散开，导致复制与删除不挨着）。
3. 工具栏按钮**按需增补 + 布局优化**（可视化模式补清除格式/分隔线等高频缺失项；md 源码模式隐藏富文本工具栏，纯文本编辑）。

价值：Obsidian 用户零摩擦切入（源码模式与 Obsidian 完全一致）；可视化模式兼顾「看渲染效果 + 直接改」；修复长期顶栏错位视觉债。

## Alignment with Product Vision

对齐 [product.md](../../steering/product.md)：

- **第 3 条 Key Feature**（文档库 TipTap WYSIWYG 编辑写回）：本次把 WYSIWYG 从「编辑态独占」升级为「可视化默认态」，并补齐源码模式，强化「Obsidian 式工作台」定位。
- **Future Vision 第 70 行**（可视化编辑扩展：按 type 路由结构化写回）：双可编辑模式 + wikilink 可点是该愿景的交互层基础（先让「看 + 改」在可视化态闭环，后续才能叠加 OKR 进度条等按 type 路由的可视化形态）。
- **Product Principles 第 4 条**（与 Obsidian 共存而非替代）：md 源码模式直接编辑原始 markdown，与 Obsidian 双向无损互通；可视化模式 wikilink 可点对齐 Obsidian 实时预览体验。
- **Success Metrics「原文零破坏」**：两种模式保存都走现有 `saveNoteBody`（读盘拼回原 frontmatter + 备份 + 重索引），不新增任何写 vault 路径，守住铁律 2。

## Requirements

### Requirement 1：双可编辑模式（可视化 / md 化），默认可视化

**User Story：** 作为 vault 重度用户，我希望编辑器默认进入可视化所见即所得态、并能一键切到 md 源码态，两种状态都能直接编辑，这样我能像 Obsidian 一样按场景切换「看渲染」或「改源码」。

#### Acceptance Criteria

- AC-1.1：WHEN 用户打开一篇笔记 THEN 系统 SHALL 默认以「可视化」模式呈现，正文为 TipTap WYSIWYG 可编辑渲染态（不显示 `## **` 等标记）。
- AC-1.2：WHEN 用户点击模式切换并选择「md 化」THEN 系统 SHALL 切换到等宽字体 `<textarea>`，显示完整 markdown 原始标记（含 `## ** [[]] - [ ]`），且该 textarea 可编辑。
- AC-1.3：WHEN 用户在任一模式编辑后切换到另一模式 THEN 系统 SHALL 保留当前草稿内容（两种模式共享同一份草稿 state，切换不丢字、不重复转义）。
- AC-1.4：IF 用户在可视化模式未手动切换 THEN 系统 SHALL 保持可视化态（不自动跳转 md 化）；反之亦然，切换只由用户主动触发。
- AC-1.5：WHEN 用户在 md 源码模式输入 wikilink `[[x]]` 后切到可视化模式 THEN 系统 SHALL 正常渲染（`unescapeWikilink` 还原转义括号，不破坏双链，守铁律 2）。

### Requirement 2：可视化模式 wikilink 可点跳转

**User Story：** 作为用户，我希望在可视化模式看到 `[[某笔记]]` 时能直接点击跳转（像之前阅读模式那样），而不是面对纯文本无法跳，这样去掉只读阅读态后我仍有便捷的双链导航。

#### Acceptance Criteria

- AC-2.1：WHEN 可视化模式渲染含 `[[target]]` 或 `[[target|别名]]` 的正文 THEN 系统 SHALL 将其渲染为可识别的 wikilink 内联节点（带 `helmose-wikilink` class + `data-target` 属性，target 取首段）。
- AC-2.2：WHEN 用户点击可视化模式中的 wikilink 节点 THEN 系统 SHALL 复用 `useWikilinkNavigation` 行为（全库搜 target → 命中则打开笔记 tab，未命中静默不报错）。
- AC-2.3：WHEN wikilink 文本带别名 `[[target|别名]]` THEN 系统 SHALL 渲染时显示「别名」、跳转用「target」（与后端 `render_wikilinks` 行为一致）。
- AC-2.4：IF 用户在可视化模式编辑 wikilink 文本 THEN 系统 SHALL 允许就地编辑（光标可进入、可改字），编辑后再切 md 源码模式仍是对应的 `[[...]]` 文本。

### Requirement 3：顶栏布局重排（修复复制/删除错位）

**User Story：** 作为用户，我希望顶栏的操作按钮（模式切换、复制、删除）紧凑成组、与左侧元信息明确分区，这样视觉不散、复制和删除按钮不再错位。

#### Acceptance Criteria

- AC-3.1：WHEN 笔记视图渲染顶栏 THEN 系统 SHALL 将顶栏分为左右两组：左侧为元信息（路径 / 日期 / 字数 / 时长 / 双链数），右侧为操作组（模式切换 + 复制 + 删除），两组分别聚合在各自容器内。
- AC-3.2：WHEN 渲染右侧操作组 THEN 系统 SHALL 让「复制」与「删除」按钮相邻（同一 `<Space>`/flex 容器内紧挨），修复现 `justify-between` 把二者撑开的错位。
- AC-3.3：IF 屏幕宽度变窄 THEN 系统 SHALL 优先保证右侧操作组不换行断裂（元信息溢出省略），操作按钮始终可见可点。

### Requirement 4：工具栏按钮增补 + md 源码模式工具栏行为

**User Story：** 作为用户，我希望可视化模式的工具栏覆盖更多高频格式（清除格式、分隔线等），且切到 md 源码模式时工具栏不误导我（源码模式无富文本命令），这样编辑体验完整且不混乱。

#### Acceptance Criteria

- AC-4.1：WHEN 处于可视化模式 THEN 工具栏 SHALL 在现有基础上增补「清除格式」「分隔线（水平线）」等高频缺失按钮（不引入新依赖，复用 StarterKit 已有能力）。
- AC-4.2：WHEN 切换到 md 源码模式 THEN 系统 SHALL 隐藏富文本工具栏（源码模式是纯文本编辑，富文本命令无效，显示会误导）。
- AC-4.3：WHEN 处于 md 源码模式 THEN 系统 SHALL 仍提供「保存 / 取消」操作（与可视化模式一致，保存走同一 `saveNoteBody` 链路）。
- AC-4.4：IF 用户在可视化模式选中文本 THEN 工具栏 SHALL 正确反映当前格式高亮状态（粗体/标题/列表等 active 态），切换 md 源码再切回时高亮仍正确。

### Requirement 5：保存链路统一 + NotePreview 弃用

**User Story：** 作为系统维护者，我希望两种模式的保存都走同一收口、不新增写 vault 路径，且去掉只读阅读态后不留死代码，这样守铁律 2 且代码库干净。

#### Acceptance Criteria

- AC-5.1：WHEN 用户在任一模式触发保存（按钮或 Ctrl/Cmd+S）THEN 系统 SHALL 调用现有 `api.saveNoteBody(noteId, draft)`（读盘拼回 frontmatter + 备份 + 增量索引），不新增任何直接 `fs::write` 或绕过备份的写法。
- AC-5.2：WHEN 双模式上线后 THEN 系统 SHALL 移除 `NotePreview` 在 `NoteView` 中的引用（只读 HTML 态不再需要）；若 `NotePreview` 无其他引用 THEN 删除该组件文件，不留死代码。
- AC-5.3：IF 后端 `getNoteContent` 仍返回 `html` 字段 THEN 前端 SHALL 不再依赖该字段渲染正文（可视化用 Tiptap、md 源码用 `raw_content`），但不清扫后端返回（保持兼容，降风险）。

### Requirement 6：编辑器状态栏（字数/字符/行数）+ Esc 退出

**User Story：** 作为用户，我希望编辑时底部实时看到字数统计、并能按 Esc 快速退出编辑，这样我掌握篇幅进度 + 想退出时不用挪鼠标点取消。

#### Acceptance Criteria

- AC-6.1：WHEN 编辑器渲染 THEN 底部 SHALL 显示状态栏，含字数（去空白字符数）/字符数（含空白）/行数，可视化与 md 源码模式都显示。
- AC-6.2：WHEN draft 变化 THEN 状态栏数字 SHALL 实时更新（无需保存触发）。
- AC-6.3：WHEN 用户在编辑区按 Esc THEN 系统 SHALL 调用 onCancel 退出编辑（等效取消按钮），可视化（Tiptap handleKeyDown）与 md 源码（textarea onKeyDown）都生效。

### Requirement 7：markdown 输入快捷 + 纯文本粘贴

**User Story：** 作为用户，我希望输入 `---` 自动变分隔线、Ctrl+Shift+V 粘贴纯文本，这样我打字快且从网页/Word 粘贴时不把乱格式带进 vault。

#### Acceptance Criteria

- AC-7.1：WHEN 用户在可视化模式空行输入 `---`（或 `***`）后接空格/回车 THEN 系统 SHALL 转为水平分隔线（复用 StarterKit HorizontalRule input rule，已确认 v3 默认含）。
- AC-7.2：WHEN 用户按 Ctrl/Cmd+Shift+V 粘贴 THEN 系统 SHALL 仅插入剪贴板纯文本（text/plain，去除 HTML/富文本格式），防外来格式污染 vault 原文。
- AC-7.3：IF 用户普通粘贴（Ctrl/Cmd+V）THEN 系统 SHALL 保留 Tiptap 默认粘贴行为（不变）。

### Requirement 8：大纲点击跳转（双模式适配）

**User Story：** 作为用户，我希望在可视化模式点侧栏大纲标题能滚动定位（现状已有），双模式改造后仍可用。

#### Acceptance Criteria

- AC-8.1：WHEN 处于可视化模式且用户点击侧栏大纲项 THEN 系统 SHALL 滚动编辑区到对应标题（复用现有 `SidePanel.scrollIntoOutline`；RichEditor 编辑区挂 `.md-preview` 类，选择器 `.md-preview h${level}` 命中）。
- AC-8.2：WHEN 处于 md 源码模式 THEN 大纲点击 SHALL 降级为不跳转（textarea 无 heading DOM，querySelectorAll 空集自然 return），不报错、不崩溃。

### Requirement 9：自动保存草稿（localStorage，不碰 vault）

**User Story：** 作为用户，我希望编辑过程中草稿自动缓存到本地，意外关闭/崩溃后重开能恢复，这样不丢字；且绝不污染 vault 原文。

#### Acceptance Criteria

- AC-9.1：WHEN draft 变化且 3s 内无新改动 THEN 系统 SHALL 把 draft 写入 `localStorage['helmose-draft-{noteId}']`（debounce），**绝不经此路径写 vault**。
- AC-9.2：WHEN 用户打开笔记且 localStorage 存在该 noteId 草稿、且内容与磁盘 rawContent 不同 THEN 系统 SHALL 弹窗「恢复未保存草稿 / 丢弃」，由用户选择。
- AC-9.3：WHEN `saveNoteBody` 保存成功 THEN 系统 SHALL 清除该 noteId 的 localStorage 草稿（已落盘，不再需要缓存）。
- AC-9.4：IF localStorage 不可用或读写抛错 THEN 系统 SHALL 静默降级（try/catch），不影响编辑/保存主流程。

## Non-Functional Requirements

### Code Architecture and Modularity

- **单一职责**：模式切换状态归 `NoteView`/`NoteEditor` 协调层；wikilink 渲染归独立 Tiptap 扩展（不塞进 `RichEditor` 主文件）；工具栏按钮归 `RichEditorToolbar`。
- **可复用**：wikilink 跳转复用 `useWikilinkNavigation`，不另写跳转逻辑；CSS 复用现有 `.helmose-wikilink` 紫色双下划线样式（与后端渲染 HTML 同 class）。
- **最小改动面**：后端零改动（无新命令、无 schema 变更、无 indexer 变更），纯前端重构。
- **依赖收敛**：不重新引入 CodeMirror 等 md 高亮重依赖；md 源码模式用原生 `<textarea>` + 等宽字体。复用已装的 `@tiptap/core` 自定义 wikilink Mark。

### Performance

- 模式切换响应 < 100ms（仅切换渲染层，不重新拉取内容；草稿已在内存）。
- 可视化模式 Tiptap 实例不因模式切换反复销毁重建（切到 md 源码时挂起保留，切回复用，避免 1.9 万字大文档的重复 parse 开销）。
- 不违反性能红线：编辑器只处理当前单篇正文（已由 `getNoteContent` 单篇拉取保证），不一次拉多篇。

### Security

- vault 原文写回唯一入口仍为 `saveNoteBody` → `save_note_content_inner`（备份 + 重索引），不新增旁路。
- 可视化模式 wikilink 跳转的 target 经 `searchNotes` 全库搜（已有能力），不直接拼路径打开，无路径穿越风险。

### Reliability

- 模式切换草稿同步：两种模式共享同一 `draft` state，切换时不丢字、不重复转义、不破坏 wikilink（`unescapeWikilink` 在可视化→onChange 链路保留）。
- 保存失败有明确 `message.error` 反馈（沿用现状），不静默吞错。
- `Ctrl/Cmd+S` 在两种模式都生效（可视化走 Tiptap handleKeyDown，md 源码走 textarea onKeyDown）。

### Usability

- 心智对齐 Obsidian：「可视化≈实时预览」「md 化≈源码模式」，降低 Obsidian 用户学习成本。
- 顶栏操作成组、复制删除相邻，符合常见笔记软件布局预期。
- 工具栏按钮带 Tooltip（沿用 `TBtn` 现有模式），新模式用户可探索。

## Constraints（铁律与边界）

- **铁律 2（vault 原文只读）**：保存唯一经 `saveNoteBody`；两种模式都不直接写盘。
- **铁律 3（IPC snake_case）**：前端类型已对齐 `rel_path`/`note_type` 等，本次无新 IPC，不动。
- **不引入新重依赖**：md 源码用原生 textarea，不回引 CodeMirror。
- **不破坏 wikilink 索引**：可视化模式序列化仍经 `unescapeWikilink`，保证 indexer 正则认得 `[[x]]`。
- **范围克制**：本次不做「按 type 路由的可视化形态」（OKR 进度条/项目看板写回），那属 Future Vision，留 backlog；本次只做交互层双模式 + wikilink 可点 + 顶栏/工具栏打磨。
- **NoteEditorDrawer 同步受益**：`NoteEditor` 被 `NoteView` 与 `NoteEditorDrawer` 共用，双模式改造后抽屉内编辑同样获得双模式能力（无需额外改动）。
