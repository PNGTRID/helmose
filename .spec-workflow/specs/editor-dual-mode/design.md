# Design Document · editor-dual-mode

## Overview

把笔记编辑器从「阅读/编辑」两态重构为 Obsidian 式**双可编辑模式**（可视化默认 ⇄ md 源码），并在可视化模式补上 wikilink 可点跳转、重排顶栏修复复制/删除错位、增补工具栏高频按钮。**纯前端重构，后端零改动**（无新命令、无 schema 变更、无 indexer 变更），保存链路沿用 `saveNoteBody`，守铁律 2。

核心架构变化：
- `NoteView`（协调者）**顶栏瘦身**：删「阅读/编辑」Segmented，模式切换下沉到 `NoteEditor`；顶栏只剩「左元信息 / 右[复制+删除]操作组」，复制删除相邻 → 错位自动修复。
- `NoteEditor`（共用组件，NoteView + NoteEditorDrawer 都受益）**升级为双模式协调者**：自持 `mode` state（默认 visual），条件渲染可视化 `<RichEditor>` 或 md 源码 `<textarea>`，**共享同一份 `draft`**。
- 可视化模式新增 **`WikilinkDecorations` Tiptap Extension**（ProseMirror Decoration 装饰层），让 `[[x]]` 显示为彩色可点链接，复用现有 `.helmose-wikilink` CSS + `useWikilinkNavigation` hook。

### 附加编辑增强（4 簇，用户追加）

本期一并纳入 4 项编辑增强（用户多选确认）：

- **簇 A · 状态栏 + Esc**：编辑器底部实时显示字数/字符/行数；Esc 退出编辑。
- **簇 B · 输入快捷 + 纯文本粘贴**：`---`→分隔线（StarterKit 默认 input rule，零代码）、Ctrl+Shift+V 粘贴纯文本防格式污染。
- **簇 C · 大纲点击跳转（适配）**：现状 `SidePanel.scrollIntoOutline` 用 `.md-preview h${level}` 选择器，RichEditor 挂 md-preview 类 → 可视化模式**天然兼容、零改动**；md 源码模式降级不跳。
- **簇 D · 自动保存草稿**：draft debounce 3s 存 localStorage（按 noteId），意外关闭后弹窗恢复；**不写 vault**（守铁律 2）；保存成功后清理。

详细设计见 [附加编辑增强详细设计（4 簇）](#附加编辑增强详细设计4-簇)。

## Steering Document Alignment

### Technical Standards (tech.md)

- **前端栈对齐**：TipTap 3（WYSIWYG）+ antd 6 + Zustand 5。本次新增的 md 源码模式用原生 `<textarea>`（不回引已清理的 CodeMirror，符合 4bc02ba 提交的依赖清理方向）；wikilink 装饰用 ProseMirror 原生 Decoration（`@tiptap/pm/state`，已装）。
- **IPC 边界**：无新 IPC。前端类型不动（`NoteContent` 现有字段够用：可视化用 Tiptap 渲染 draft，md 源码用 `raw_content`/draft）。
- **分层解析契约**：不动 `services/contract`、不动 indexer、不动 `render_wikilinks`（后端阅读态 HTML 渲染保留，只是前端 `NoteView` 不再消费它）。
- **性能红线**：编辑器只处理当前单篇正文（`getNoteContent` 单篇拉取已保证），双模式切换不重新拉内容（draft 在内存）。

### Project Structure (structure.md)

- 组件放 `frontend/src/components/`（与 `RichEditor.tsx`/`RichEditorToolbar.tsx` 同目录），新扩展 `WikilinkDecorations.ts` 同目录。
- 样式：`RichEditor.css` 加 md 源码 textarea 段；wikilink 样式复用 `index.css:215`（不新建）。
- 注释中文；Tiptap 扩展经 `extensions: []` 注册；React 组件 hooks → 早返回 → JSX。

## Code Reuse Analysis

### Existing Components to Leverage

- **`useWikilinkNavigation`**（[hooks/useWikilinkNavigation.ts](../../../frontend/src/hooks/useWikilinkNavigation.ts)）：可视化模式点击跳转**直接复用**。其 `handleClick` 基于 DOM 委托（`closest('.helmose-wikilink')` → 读 `dataset.target` → `searchNotes` → `openNoteFromMeta`）。只要装饰生成的 span 带 `helmose-wikilink` class + `data-target` 属性，外层 `<div onClick={handleClick}>` 即可工作。
- **`.helmose-wikilink` CSS**（[index.css:215-227](../../../frontend/src/index.css#L215-L227)）：紫色 + 虚线下划线 + 浅紫底 + hover 反色。选择器 `.md-preview .helmose-wikilink`，而 RichEditor 编辑区挂双类 `tiptap-content md-preview`（[RichEditor.tsx:75](../../../frontend/src/components/RichEditor.tsx#L75)）→ **直接命中，零 CSS 新增**。
- **`RichEditor` 受控架构**（value/onChange + `unescapeWikilink` + Cmd+S handleKeyDown）：双模式的可视化侧**零改动**，只在 `extensions` 数组追加 `WikilinkDecorations`。
- **`RichEditorToolbar` 的 `TBtn`/`HTBtn` 封装**：新增「清除格式」「分隔线」按钮复用现有 button wrapper（统一 size/active/Tooltip）。
- **`api.saveNoteBody`**（[api/index.ts](../../../frontend/src/api/index.ts)）：两种模式保存都走它（读盘拼回 frontmatter + 备份 + 重索引），**不新增写法**。
- **antd `Segmented`/`Space`/`Popconfirm`/`Button`/`Tooltip`**：顶栏与编辑器内部布局复用现有 antd 用法。

### Integration Points

- **`NoteEditor` 被 `NoteView` + `NoteEditorDrawer` 共用**：双模式改造后，抽屉内编辑（日志/今日/项目长文就地编辑）**自动获得双模式**，无需 `NoteEditorDrawer` 额外改动（mode 自包含在 NoteEditor）。
- **后端 `getNoteContent`**：仍返回 `html` 字段，前端不再用它渲染正文（AC-5.3 兼容保留，不清扫后端降风险）。
- **`render_wikilinks`（后端）**：不动。可视化模式的 wikilink 装饰是**前端独立实现**（ProseMirror Decoration），与后端阅读态 HTML 渲染互不干扰。

## Architecture

### 双模式数据流

```mermaid
graph TD
    NV[NoteView 协调者<br/>顶栏: 元信息 + 复制/删除组] -->|rawContent| NE[NoteEditor<br/>mode state 默认 visual]
    NE -->|mode=visual| RE[RichEditor<br/>Tiptap WYSIWYG + WikilinkDecorations]
    NE -->|mode=markdown| TA[textarea 等宽<br/>显示 ## ** [[]] 原文]
    RE <-->|value/onChange 共享| DRAFT[(draft state<br/>同一份草稿)]
    TA <-->|value/onChange 共享| DRAFT
    DRAFT -->|保存 Cmd+S/按钮| SAVE[api.saveNoteBody<br/>读盘拼fm+备份+索引]
```

### Modular Design Principles

- **单一职责**：
  - `NoteView` = 内容加载 + 顶栏元信息/操作组（不再管编辑模式）。
  - `NoteEditor` = 双模式协调（mode state + 条件渲染 + 共享 draft + 保存）。
  - `RichEditor` = 可视化渲染（受控 Tiptap，注册 wikilink 装饰）。
  - `WikilinkDecorations` = wikilink 装饰扩展（独立文件，单一能力）。
  - `RichEditorToolbar` = 富文本工具栏（可视化模式独有）。
- **组件隔离**：md 源码 textarea 是原生元素（不需新组件），直接在 NoteEditor 内联渲染。
- **工具层模块化**：`WikilinkDecorations` 是纯 Tiptap Extension，无 React 依赖，可独立测试。

### 关键技术决策

#### 决策 1：wikilink 可点用 ProseMirror Decoration（非自定义 Mark/Node）

| 方案 | 实现 | 回归风险 | 编辑体验 | 选择 |
|---|---|---|---|---|
| 自定义 Mark | `@tiptap/core` Mark.create + 接管 `[[x]]` parse/serialize | **高**（要对抗 @tiptap/markdown 对 `[` 的转义，可能破坏 `unescapeWikilink` + 双链索引） | 好 | ❌ |
| 自定义 Node（atom） | inline atom node | 中（序列化） | 差（atom 不可拆，选中整块删） | ❌ |
| **Decoration 装饰层** | ProseMirror plugin + DecorationSet | **低**（不改文档模型，序列化/索引全不动） | 好（编辑底层 `[[x]]` 字符，装饰跟随） | ✅ |

**Decoration 方案细节**：
- `Extension.create({ name: 'wikilinkDecorations' })` + `addProseMirrorPlugins`。
- plugin 用 `@tiptap/pm/state` 的 `Plugin`/`PluginKey`/`Decoration`/`DecorationSet`。
- `decorations(state)` 钩子扫描 `state.doc`，对每个 text 节点跑正则 `/\[\[([^\]\|]+)(?:\|([^\]]+))?\]\]/g`，命中则 `Decoration.inline(from, to, { class: 'helmose-wikilink', attrs: { 'data-target': target } })`。
- **跳过 codeBlock**：扫描时判断文本节点祖先非 `pre`/`codeBlock`（对齐后端 `render_wikilinks` 代码块不替换）。
- 装饰输出 `<span class="helmose-wikilink" data-target="x">[[x|别名]]</span>`，点击 → `closest('.helmose-wikilink')` 命中 → `dataset.target` → 复用 `useWikilinkNavigation`。
- **范围折中（记 backlog）**：`[[ ]]` 符号也彩色显示（不隐藏），整体可点。Obsidian live preview 会隐藏符号只显示链接文字，那需 `Decoration.widget` 替换 DOM，编辑边界处理复杂，本次不做。

#### 决策 2：模式切换 UI 下沉到 NoteEditor（非 NoteView 顶栏）

- mode state + Segmented 都在 `NoteEditor` 内部 → `NoteView` + `NoteEditorDrawer` 共用方自动获得双模式，零重复。
- `NoteView` 顶栏**删掉 Segmented**（顺带让顶栏更干净 + 复制/删除错位修复更彻底）。

#### 决策 3：模式切换时 RichEditor 卸载重挂（非 CSS 隐藏）

- 切到 md 源码 → RichEditor 卸载；切回 → 用最新 draft 重新挂载。
- 代价：撤销栈重置（可接受，模式切换是"换视图"语义）。
- 收益：不长期持有两个编辑器实例（省内存 + 避开双编辑器状态同步复杂性）。
- 性能：单篇正文 Tiptap parse 小于 100ms（满足 AC）。

#### 决策 4：共享 draft 单 state

- 单个 `draft` string，可视化 RichEditor 的 `onChange` 与 md textarea 的 `onChange` 都 `setDraft`。
- 切换模式 draft 不变，只是换渲染层读 draft。**切换零丢字**（AC-1.3）。
- 可视化→md：RichEditor 已把 md 写入 draft（含 `unescapeWikilink` 还原），textarea 直接显示。
- md→可视化：textarea 改了 draft（用户手写 `[[x]]`），RichEditor 用该 md 初始化，Tiptap parse + 装饰渲染。

## Components and Interfaces

### Component 1：`NoteEditor`（改造，双模式协调者）

- **Purpose：** 持有 mode + 共享 draft，条件渲染可视化/md 源码，统一保存。
- **Interfaces（Props 不变）：** `{ noteId, rawContent, onSave, onCancel }`（NoteView/NoteEditorDrawer 调用方零改动）。
- **内部 state：**
  - `draft: string`（初始化 rawContent，去 fm 正文）
  - `mode: 'visual' | 'markdown'`（默认 'visual'）
  - `saving: boolean`
- **布局：**
  ```
  ┌─ 顶部行 ──────────────────────────────────────┐
  │ [左: Segmented 可视化/md化]    [右: 取消/保存] │
  ├─ 编辑区 ──────────────────────────────────────┤
  │ mode=visual:  RichEditorToolbar + RichEditor  │
  │ mode=markdown: <textarea className=md-source> │
  └───────────────────────────────────────────────┘
  ```
- **Reuses：** `RichEditor`（visual）、antd `Segmented`/`Button`/`Space`、`api.saveNoteBody`。

### Component 2：`WikilinkDecorations`（新建，Tiptap Extension）

- **Purpose：** 可视化模式给 `[[x]]`/`[[x|y]]` 文本套彩色可点装饰。
- **Interfaces：** Tiptap Extension（`Extension.create`），无外部 API，经 `RichEditor` 的 `extensions: []` 注册。
- **Dependencies：** `@tiptap/core`（Extension.create）、`@tiptap/pm/state`（Decoration/DecorationSet/Plugin）。
- **Reuses：** `.helmose-wikilink` CSS、`useWikilinkNavigation`（外层 onClick）。
- **关键约束：**
  - 只装饰 `[[ ]]` 区间，不改文档内容/结构（序列化零影响）。
  - 跳过 codeBlock（代码块内 `[[y]]` 不装饰，对齐后端）。
  - target 取首段（`[[a|b]]` → `data-target="a"`），与后端 `render_wikilinks` 一致。

### Component 3：`RichEditor`（小改）

- **Purpose：** 可视化渲染（不变），追加 wikilink 装饰扩展 + 外层点击委托。
- **改动：**
  - `extensions` 数组追加 `WikilinkDecorations`。
  - 外层 `<div className="rich-editor">` 加 `onClick={handleClick}`（handleClick 来自 `useWikilinkNavigation`）。
- **Reuses：** 现有受控架构、`unescapeWikilink`、Cmd+S、Placeholder、TaskList/Table 全保留。

### Component 4：`RichEditorToolbar`（增补按钮）

- **Purpose：** 可视化模式富文本工具栏。
- **改动（AC-4.1）：** 新增：
  - 「清除格式」：`editor.chain().focus().unsetAllMarks().clearNodes().run()`（回段落）。
  - 「分隔线」：`editor.chain().focus().setHorizontalRule().run()`（StarterKit 自带 horizontalRule，无新依赖）。
- **Reuses：** `TBtn` wrapper、StarterKit 能力。
- **md 源码模式：** NoteEditor 在 md 模式不渲染本组件（AC-4.2 自动满足）。

### Component 5：`NoteView`（顶栏重排 + 删只读态）

- **Purpose：** 内容加载 + 顶栏元信息/操作组。
- **改动：**
  - 删 `editing` state + 「阅读/编辑」Segmented（不再有只读态）。
  - 始终渲染 `<NoteEditor>`（去掉 `editing ? NoteEditor : NotePreview` 分支）。
  - 顶栏布局重排：左 `<span flex:1 省略>` 元信息；右 `<Space>` 操作组（复制按钮 + 删除 Popconfirm），复制删除相邻。
  - 删 `import NotePreview`。
- **Reuses：** 现有 `onDelete`/`onSave`/元信息计算逻辑。

## 附加编辑增强详细设计（4 簇）

### 簇 A · 编辑器状态栏 + Esc 退出

**状态栏**：`NoteEditor` 编辑区下方加 `<div className="editor-statusbar">`，显示「字数 N · 字符 M · 行 L」：
- 字数 = `draft.replace(/\s/g,'').length`（与 NoteView 顶栏口径一致）
- 字符 = `draft.length`
- 行 = `draft.split('\n').length`
- 两种模式都显示（基于 draft 计算，与渲染层无关）。
- 样式归 `RichEditor.css`（`.editor-statusbar`：等宽小字、faint 色、右对齐、顶部细分隔）。

**Esc 退出**：
- 可视化：`RichEditor` 的 `editorProps.handleKeyDown` 加分支 `if (event.key === 'Escape') { event.preventDefault(); escRef.current?.(); return true; }`，`escRef` 透传 `onCancel`（仿现有 `saveRef` 透传模式，避免重建 editor）。
- md 源码：`<textarea onKeyDown>` 加 Esc → `onCancel`。

### 簇 B · 输入快捷 + 纯文本粘贴

**`---` 转分隔线**：StarterKit v3 默认含 HorizontalRule input rule（已确认），**零代码**。工具栏「分隔线」按钮是其显式入口（双向保障）。

**`- [ ]` 转任务**：TaskList/TaskItem 扩展自带 todoItem input rule（实现时确认；若默认未启用则 `TaskItem.configure` 显式开）。工具栏「任务列表」按钮兜底。

**Ctrl/Cmd+Shift+V 纯文本粘贴**：`RichEditor` 的 `editorProps.handlePaste` 加分支：
```ts
handlePaste(view, event) {
  if (event.shiftKey) {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text) {
      event.preventDefault();
      view.dispatch(view.state.tr.insertText(text));
      return true;
    }
  }
  return false; // 非 Shift → 走默认粘贴
}
```
防网页/Word 富文本格式污染 vault 正文。

### 簇 C · 大纲点击跳转（双模式适配，零改动）

**现状已兼容**：`SidePanel.scrollIntoOutline`（[SidePanel.tsx:36-44](../../../frontend/src/components/SidePanel.tsx#L36-L44)）用 `document.querySelectorAll('.md-preview h${level}')` 文本匹配 + `scrollIntoView`。RichEditor 编辑区挂双类 `tiptap-content md-preview`，可视化模式 heading 命中选择器 → **跳转天然工作，SidePanel 零改动**。

**md 源码模式降级**：textarea 无 heading DOM，`querySelectorAll` 空集，函数自然 return 不跳转、不报错。记 backlog「md 源码模式按行号定位 textarea 滚动」（可选后续）。

### 簇 D · 自动保存草稿（localStorage，守铁律 2）

`NoteEditor` 内部三段闭环：

1. **debounce 写**：`useEffect([draft])` debounce 3s → `localStorage.setItem('helmose-draft-'+noteId, draft)`，try/catch 静默（localStorage 满或禁用不炸）。
2. **挂载恢复提示**：`useEffect([noteId])` 读 localStorage 草稿，若存在且 `!== rawContent` → setState `pendingRecover` 标记 → 渲染 antd `Modal`「检测到上次未保存的草稿（N 字），是否恢复？」
   - 恢复 → `setDraft(stored)` + 关 Modal。
   - 丢弃 → `localStorage.removeItem` + 关 Modal（保持 rawContent）。
3. **保存后清理**：`save` 成功（`saveNoteBody` resolve）→ `localStorage.removeItem('helmose-draft-'+noteId)`（已落盘）。

**守铁律**：全程只读写 localStorage，不经任何 fs/IPC 写 vault。保存仍只走 `saveNoteBody`（用户主动触发）。`debounce` 用 `setTimeout` + cleanup（不引入 lodash，保持依赖清洁）。

**文件改动**：仅 `NoteEditor.tsx`（加状态栏 JSX + Esc + localStorage 三段 effect）+ `RichEditor.css`（`.editor-statusbar` 样式）。

## Data Models

**无新数据模型**（无 IPC/DB/schema 变更）。

```
// NoteEditor 内部 state（不外泄）
mode: 'visual' | 'markdown'   // 默认 'visual'
draft: string                 // 共享草稿（去 fm 正文，与 rawContent 同源）
```

**新增依赖（package.json）：**
```
"@tiptap/core": "^3.27.1"   // 已作为传递依赖在 .pnpm，custom Extension 必需，pnpm 严格模式显式声明
```
（`@tiptap/pm` 已在 package.json，无需新增。）

## Error Handling

| 场景 | 处理 | 用户感知 |
|---|---|---|
| 模式切换丢字 | 不存在（单 state 共享，无同步） | — |
| wikilink 跳转 target 未命中 | `useWikilinkNavigation` 已静默（与现状阅读态一致） | 无反应（不报错） |
| wikilink 装饰正则未命中 | 不装饰，显示纯文本 `[[x]]`（优雅降级） | 看到原文，仍可编辑 |
| 保存失败 | `message.error`（沿用现状） | 错误 toast |
| md 源码手写 wikilink 格式错（如 `[[x`） | 正则不匹配 → 不装饰 → 切可视化显示纯文本 | 看到原文，用户自行修正 |
| Cmd+S 在 md 源码模式 | textarea onKeyDown 拦截 → save | 保存成功 |

## Testing Strategy

### 客观裁判（项目实际配置）

- `cd frontend && pnpm build`（= `tsc -b && vite build`）：TypeScript 类型 + 构建（前端主裁判，本次纯前端）。
- `cd src-tauri && cargo check`：后端零改动，确认无回归（守「不破坏现有」）。
- 现有 `RichEditor.test.ts`（`unescapeWikilink` 单测）：跑过，确保双模式改造不破坏转义还原。

### Unit Testing

- `unescapeWikilink` 现有测试维持绿（md 源码→可视化链路依赖它）。
- `WikilinkDecorations` 的正则匹配逻辑可选单测（构造 `[[x]]`/`[[x|y]]`/代码块内 `[[y]]`，断言装饰区间数与 target）—— 若 `pnpm build` + 手动验证足够，可后置。

### Integration / E2E

- 项目无前端 E2E 框架（无 vitest UI / playwright）。靠客观裁判 + **手动验证清单**：
  1. 打开笔记 → 默认可视化，`[[x]]` 彩色可点 → 点击跳转。
  2. 编辑 → 切 md 化 → 看到 `## ** [[x]]` 原文 → 编辑 → 切回可视化 → 字不丢、格式正确。
  3. 顶栏复制/删除相邻 → 复制弹"已复制路径" → 删除弹确认 → 确认后关 tab。
  4. 工具栏新按钮：清除格式（选中文本→点→回段落）、分隔线（插入 `<hr>`）。
  5. NoteEditorDrawer（抽屉编辑）同样有双模式 + wikilink 可点。
  6. Cmd+S 两种模式都保存。

## Constraints（铁律与边界，重申）

- **铁律 2**：保存唯一经 `saveNoteBody` → `save_note_content_inner`（备份 + 重索引），不新增任何写盘旁路。
- **不破坏 wikilink 索引**：可视化模式序列化链路保留 `unescapeWikilink`，indexer 正则仍认 `[[x]]`。
- **不回引重依赖**：md 源码用原生 textarea；新增的 `@tiptap/core` 是 tiptap 自家核心包（已在 .pnpm），非重依赖。
- **后端零改动**：不动 `render_wikilinks`、不动 indexer、不动 IPC、不动 schema。
- **范围克制**：不做「按 type 路由的可视化形态」（OKR 进度条/项目看板，属 Future Vision）；不做「widget 隐藏 `[[ ]]` 符号」（Decoration widget，复杂度高，记 backlog）。

## backlog（本期不做，显式列出防 scope creep）

- 可视化模式用 `Decoration.widget` 隐藏 `[[ ]]` 符号、只显示链接文字（Obsidian live preview 完整效果）。
- 按 note_type 路由的可视化编辑形态（OKR 进度条写回 / 项目看板写回）——属 product.md Future Vision。
- `WikilinkDecorations` 正则匹配的独立单测（若手动验证充分则后置）。
- md 源码模式的语法高亮（明确决策不做，保持轻量）。
- md 源码模式大纲点击跳转（按 heading 行号定位 textarea 滚动）—— 簇 C 在 md 模式降级，可视化模式已满足主流场景。
