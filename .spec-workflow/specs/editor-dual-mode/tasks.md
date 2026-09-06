# editor-dual-mode · Tasks

> 本 spec：笔记编辑器从「阅读/编辑」两态重构为 Obsidian 式**双可编辑模式**（可视化默认 ⇄ md 源码），可视化模式 wikilink 可点跳转（ProseMirror Decoration 装饰层，不改文档模型），顶栏重排修复复制/删除错位，工具栏补按钮，并加 4 簇增强（状态栏+Esc、输入快捷+纯文本粘贴、大纲跳转适配、草稿自动存 localStorage）。
> 性质：**纯前端重构**，后端零改动（无新命令/无 schema/无 indexer 变更）。保存唯一走 `saveNoteBody`，守铁律 2。
> **执行顺序**：1(加依赖) → 2(WikilinkDecorations 扩展) → 3(RichEditor 改造) → 4,5(并行：工具栏补按钮 + CSS 样式) → 6(NoteEditor 双模式+状态栏+Esc+草稿) → 7(NoteView 顶栏重排+删只读态) → 8(删 NotePreview) → 9(客观裁判收口)。
> **验证命令**：`cd frontend && pnpm build`（= tsc -b && vite build，前端主裁判）+ `cd src-tauri && cargo check`（后端零改动确认无回归）。每批改完全绿才继续。
> **铁律**：中文注释；保存唯一经 `saveNoteBody`（绝不新增 fs/IPC 写盘旁路）；草稿缓存只读写 localStorage（不碰 vault）；不回引 CodeMirror 等重依赖；改前先读后写。

## P0 · 基础设施（前置）

- [x] 1. 加 `@tiptap/core` 依赖
  - File: frontend/package.json（dependencies 加 `@tiptap/core@^3.27.1`）
  - 描述：pnpm 加 `@tiptap/core`（Tiptap 自家核心包，自定义 Extension 必需，pnpm 严格模式下传递依赖不能直接 import）。版本对齐已装的 3.27.1（已在 .pnpm 作传递依赖，pnpm add 只建 link 不重下）。
  - 关键：用 `cd frontend && pnpm add @tiptap/core@^3.27.1`（CLAUDE.md：本机 npm 损坏，统一 pnpm）；加完确认 `package.json` + `pnpm-lock.yaml` 更新。
  - _Leverage: 已装 `@tiptap/pm` 同版本（在 package.json），`@tiptap/react`/`starter-kit` 传递依赖 `@tiptap/core`_
  - _Requirements: 无 AC 直接对应（基础设施前置），支撑 AC-2.1_
  - _Prompt: Implement the task for spec editor-dual-mode, first run spec-workflow-guide to get the workflow guide then implement the task. Role: 前端工程环境工程师。Task: 在 frontend 目录跑 `pnpm add @tiptap/core@^3.27.1`，确认 package.json dependencies 含该包且版本 ^3.27.1，pnpm-lock.yaml 更新。Restrictions: 用 pnpm 不用 npm（本机 npm 损坏）；不升级其他 tiptap 包；不动 lockfile 里无关条目。Success: frontend 目录 `pnpm build` 不报 cannot find module @tiptap/core。记 log（taskId=1）。标记 tasks.md 本 task [-]→[x]。_

## P1 · 核心双模式 + wikilink + 编辑器改造

- [x] 2. 新建 `WikilinkDecorations` Tiptap Extension（ProseMirror 装饰层）
  - File: frontend/src/components/WikilinkDecorations.ts（新建）
  - 描述：Tiptap Extension，`addProseMirrorPlugins` 注册一个 plugin，用 `@tiptap/pm/state` 的 `Decoration`/`DecorationSet`/`Plugin`/`PluginKey` 扫描 doc 文本，对 `[[target]]`/`[[target|别名]]` 命中区间套 `Decoration.inline` 并附 `class='helmose-wikilink'` 与 `data-target` 属性（target 取首段，与后端 `render_wikilinks` 一致）。
  - 关键：**不改文档模型**（只装饰视图层）→ 序列化/索引全不动；**跳过 codeBlock**（扫描时排除 codeBlock/pre 祖先，对齐后端代码块不替换）；正则用 `/\[\[([^\]\|]+)(?:\|([^\]]+))?\]\]/g`；plugin state 的 apply 在 `tr.docChanged` 时重算装饰，否则复用旧值；导出默认 Extension（name 为 wikilinkDecorations）。
  - _Leverage: `@tiptap/core` 的 Extension.create；`@tiptap/pm/state`（已装）；后端 `render_wikilinks` 正则口径（src-tauri/src/commands/library.rs:1829-1855）；`.helmose-wikilink` CSS（index.css:215，class 名 JS closest 选择禁止改）_
  - _Requirements: AC-2.1, AC-2.3_
  - _Prompt: Implement the task for spec editor-dual-mode, first run spec-workflow-guide. Role: Tiptap/ProseMirror 扩展工程师。Task: 新建 frontend/src/components/WikilinkDecorations.ts，实现一个 Tiptap Extension（name=wikilinkDecorations），通过 addProseMirrorPlugins 注册一个 ProseMirror Plugin（用 PluginKey）：plugin state init/apply 用 buildDecos 函数生成 DecorationSet（tr.docChanged 才重算，否则复用）；buildDecos 遍历 doc 的 text 节点，跑正则匹配 wikilink，对每个命中区间建 Decoration.inline，attrs 带 class=helmose-wikilink 与 data-target=首段；跳过 codeBlock/pre 祖先节点（node.type.name 等于 codeBlock 或祖先为 pre）；plugin props.decorations 返回该 DecorationSet。详细正则与 Decoration API 见 design.md「决策 1」与「簇」。Restrictions: 绝不改文档内容（只用 Decoration 视图层）；中文注释；不引入新依赖（仅 @tiptap/core + @tiptap/pm/state）；class 名固定 helmose-wikilink（JS closest 选择 + CSS 命中，禁止改名）；target 取首段对齐后端 render_wikilinks。Success: cd frontend && pnpm build 绿；逻辑验证（可用单测或手动）：含 `[[张三]] 和 [[Picboil|出海工具]]` 的 doc，装饰数=2 且 data-target 分别为 张三/Picboil；代码块内 `[[y]]` 不装饰。记 log（taskId=2，artifacts 里 functions 列出 buildDecos 与 Extension 工厂）。标记本 task [-]→[x]。_

- [x] 3. RichEditor 注册 WikilinkDecorations + 外层 onClick + Esc 退出 + 纯文本粘贴
  - File: frontend/src/components/RichEditor.tsx
  - 描述：① extensions 数组追加 `WikilinkDecorations`；② 外层 `<div className="rich-editor">` 加 `onClick={handleClick}`（handleClick 来自 `useWikilinkNavigation`）；③ `editorProps.handleKeyDown` 加 Esc 分支（用 `escRef` 透传 onCancel，仿现有 `saveRef` 模式）；④ `editorProps.handlePaste` 加 Ctrl/Cmd+Shift+V 纯文本插入分支（dispatch insertText）。
  - 关键：escRef/saveRef 都用 ref 透传避免重建 editor；handlePaste 仅 `event.shiftKey` 时拦截（否则 return false 走默认）；Props 加可选 onCancel；onClick 委托到 `.helmose-wikilink` 由 hook 处理。详细 handleKeyDown/handlePaste 代码见 design.md「簇 A」「簇 B」。
  - _Leverage: 现有 saveRef 透传模式（RichEditor.tsx:45-46，escRef 同构）；useWikilinkNavigation（hooks/useWikilinkNavigation.ts）；unescapeWikilink 保留不动_
  - _Requirements: AC-2.2, AC-2.4, AC-6.3（可视化 Esc）, AC-7.2, AC-7.3_
  - _Prompt: Implement the task for spec editor-dual-mode, first run spec-workflow-guide. Role: React/Tiptap 前端工程师。Task: 改 RichEditor.tsx：(1) import WikilinkDecorations 与 useWikilinkNavigation，extensions 数组追加 WikilinkDecorations；(2) Props 加可选 onCancel，新增 escRef（ref 透传模式，仿现有 saveRef）并在 handleKeyDown 加 Esc 分支（preventDefault + 调 escRef.current + return true）；(3) editorProps 加 handlePaste：仅当 event.shiftKey 时取剪贴板 text/plain 并 dispatch insertText（preventDefault + return true），否则 return false 走默认粘贴；(4) 外层 div 加 onClick 为 useWikilinkNavigation 的 handleClick。handlePaste/handleKeyDown 的精确实现见 design.md「簇 A」「簇 B」代码块。Restrictions: 不改 unescapeWikilink；不改现有 Cmd+S；中文注释；escRef 透传不重建 editor；handlePaste 非 Shift 必须返回 false 走默认粘贴。Success: pnpm build 绿；可视化模式 `[[x]]` 显示彩色（CSS 命中）且点击触发全库搜跳转；Esc 退出编辑；Ctrl+Shift+V 粘贴纯文本。记 log（taskId=3，artifacts functions 列 handlePaste 与 handleKeyDown 改动）。标记本 task [-]→[x]。_

- [x] 4. RichEditorToolbar 补「清除格式」「分隔线」按钮
  - File: frontend/src/components/RichEditorToolbar.tsx
  - 描述：在现有工具栏合适分组加两个 `TBtn`：「清除格式」（链式 unsetAllMarks + clearNodes，回段落）+「分隔线」（setHorizontalRule，StarterKit 自带 horizontalRule）。配 Divider 分隔。
  - 关键：用 `ClearOutlined` 与 `MinusOutlined` 图标；Tooltip 文案；无 active 态（瞬时动作）。
  - _Leverage: 现有 TBtn wrapper；StarterKit HorizontalRule（已确认 v3 含）；unsetAllMarks/clearNodes 是 Tiptap 内置命令_
  - _Requirements: AC-4.1_
  - _Prompt: Implement the task for spec editor-dual-mode, first run spec-workflow-guide. Role: React 前端工程师。Task: RichEditorToolbar.tsx 在合适分组（加 antd Divider 分隔）追加两 TBtn：清除格式（icon=ClearOutlined，title=清除格式，onClick 调 editor.chain().focus().unsetAllMarks().clearNodes().run()）与分隔线（icon=MinusOutlined，title=分隔线，onClick 调 editor.chain().focus().setHorizontalRule().run()）。import 加 ClearOutlined 与 MinusOutlined。Restrictions: 复用 TBtn 不另写 button；中文 Tooltip；不加 active 态（瞬时动作）；不引入新依赖。Success: pnpm build 绿；可视化模式选含粗体/标题文本点清除格式回段落；点分隔线插入水平线。记 log（taskId=4）。标记本 task [-]→[x]。_

- [x] 5. RichEditor.css 补 md 源码 textarea + 状态栏样式
  - File: frontend/src/components/RichEditor.css
  - 描述：加 md 源码 textarea 样式（等宽字体、全宽、min-height 360px、padding 16px 20px、border 同 rich-editor、outline none、resize vertical）与状态栏样式（font-size 12、faint 色、右对齐、顶部细分隔、等宽）。暗色用 token 自动跟随。
  - 关键：textarea 字号 14px / 行高 1.7，与可视化编辑区协调；用现有 `var(--ob-*)` token 不写死色值。精确 CSS 见 design.md「簇 A」「文件改动」。
  - _Leverage: 现有 .rich-editor .tiptap-content 样式口径（padding/min-height 对齐）；var(--ob-*) token 体系_
  - _Requirements: AC-6.1（状态栏视觉支撑）_
  - _Prompt: Implement the task for spec editor-dual-mode, first run spec-workflow-guide. Role: CSS 前端工程师。Task: RichEditor.css 末尾追加两段（精确值见 design.md「簇 A」）：md 源码 textarea 选择器（width 100%、min-height 360px、padding 16px 20px、等宽字体 SFMono/Menlo/Consolas、font-size 14px、line-height 1.7、颜色与背景用 var(--ob-text)/var(--ob-bg)、border 1px solid var(--ob-border)、border-radius 6px、outline none、resize vertical）与状态栏选择器（font-size 12px、color var(--ob-text-faint)、text-align right、padding 4px 12px、border-top 1px solid var(--ob-border)、等宽字体）。选择器类名按 design.md。Restrictions: 颜色全用 var(--ob-*) token（暗色自动跟随）；不写死色值；中文注释段头说明用途。Success: pnpm build 绿；md 源码模式 textarea 等宽铺满；状态栏右对齐小字。记 log（taskId=5）。标记本 task [-]→[x]。_

- [x] 6. NoteEditor 双模式协调 + 状态栏 + Esc（textarea 侧）+ 草稿 localStorage
  - File: frontend/src/components/NoteEditor.tsx
  - 描述：① 加 mode state（默认 visual）与 pendingRecover state；② 顶部行改为左 antd Segmented（可视化/md化）右 取消/保存 Space；③ 条件渲染：visual 渲染 RichEditor（传 onCancel/onSaveShortcut），markdown 渲染 textarea（共享 draft，textarea onKeyDown 处理 Esc 与 Cmd+S）；④ 底部加状态栏（字数/字符/行，基于 draft）；⑤ 草稿 localStorage 三段闭环（debounce 3s 写 + 挂载恢复 Modal + save 成功清理）。详细 JSX 与逻辑见 design.md「簇 A」「簇 D」。
  - 关键：**单 draft state 两模式共享**（切换零丢字）；textarea 的 onKeyDown：Esc 调 onCancel、Cmd/Ctrl+S preventDefault 后调 save；字数用 `draft.replace(/\s/g,'').length`、字符用 `draft.length`、行用 `draft.split('\n').length`；localStorage key 为 `helmose-draft-${noteId}` 全 try/catch 静默；挂载时若 stored 且不等于 rawContent 弹 antd Modal（恢复/丢弃）；save 成功后 removeItem；debounce 用 setTimeout + cleanup（不引入 lodash）。
  - _Leverage: api.saveNoteBody（不变）；antd Segmented/Space/Button/Modal；现有 save 逻辑；RichEditor 已支持 onCancel/onSaveShortcut（task 3 加）_
  - _Requirements: AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-6.1, AC-6.2, AC-6.3, AC-9.1, AC-9.2, AC-9.3, AC-9.4_
  - _Prompt: Implement the task for spec editor-dual-mode, first run spec-workflow-guide. Role: React 前端工程师。Task: 改 NoteEditor.tsx：(1) 加 mode state（'visual'/'markdown'，默认 'visual'）与 pendingRecover state（string|null）；(2) 顶部行左 antd Segmented（可视化/md化 两选项，value=mode，onChange setMode），右 Space 放取消与保存两 Button（沿用现有 onCancel 与 save）；(3) 编辑区条件渲染：visual 模式渲染 RichEditor（传 value=draft、onChange=setDraft、onSaveShortcut=save、onCancel=onCancel），markdown 模式渲染外层 div（class rich-editor-md-source）内 textarea（value=draft、onChange 用 setDraft(e.target.value)、onKeyDown 用自写 onTaKeyDown：Esc 调 onCancel、Cmd/Ctrl+S preventDefault 后调 save）；(4) 底部加状态栏 div（class editor-statusbar，文本：字数=去空白长度、字符=长度、行=split 换行长度，基于 draft 计算）；(5) 草稿三段闭环：useEffect 监听 draft 用 setTimeout 3s 写 localStorage（key=helmose-draft-+noteId，try/catch，cleanup clearTimeout）；useEffect 监听 noteId 挂载时 try 读 stored，若 stored 且不等于 rawContent 则 setPendingRecover(stored)；render 中若 pendingRecover 非 null 则显示 antd Modal（标题：检测到未保存的草稿，okText 恢复 onOk 用 setDraft(pendingRecover)+清 pendingRecover，cancelText 丢弃 onCancel 用 localStorage.removeItem+清 pendingRecover）；save 成功（saveNoteBody resolve 后）try localStorage.removeItem。精确 JSX 与 effect 见 design.md「簇 A」「簇 D」。Restrictions: 单 draft 共享不丢字；localStorage 全 try/catch 不炸；中文注释；不引入 lodash（setTimeout 手写 debounce）；绝不写 vault（只 localStorage + saveNoteBody）；Props 签名不变（noteId/rawContent/onSave/onCancel）。Success: pnpm build 绿；切模式字不丢；Esc 两模式都退出；状态栏实时更新；编辑后 3s localStorage 有值；重开提示恢复；保存后清。记 log（taskId=6，artifacts components 列 NoteEditor 改造）。标记本 task [-]→[x]。_

- [x] 7. NoteView 顶栏重排 + 删只读态（始终编辑）
  - File: frontend/src/components/NoteView.tsx
  - 描述：① 删 editing state + 顶部「阅读/编辑」Segmented + import NotePreview；② onSave 不再 setEditing(false)（无只读态可退，只更新 content）；③ 顶栏布局重排：左元信息 span（flex 1 + overflow hidden + ellipsis + minWidth 0），右 Space 操作组（复制按钮 + 删除 Popconfirm），复制删除相邻；④ 始终渲染 NoteEditor（不再 editing 三元分支）；⑤ 删 import NotePreview。
  - 关键：顶栏外层 flex + 左 flex 1 省略 + 右 Space 收拢，复制删除相邻（修复错位）；onCancel 用 closeTab（note: + noteId）（关闭 tab，因为不再回只读态）；保留元信息文案（路径/日期/字数/时长/双链数）。精确布局见 design.md「Component 5」。
  - _Leverage: 现有 onDelete/onSave；antd Space/Popconfirm；NoteEditor（task 6 改造后含双模式）_
  - _Requirements: AC-1.1（默认可视化由 NoteEditor mode=visual 满足）, AC-3.1, AC-3.2, AC-3.3, AC-5.2_
  - _Prompt: Implement the task for spec editor-dual-mode, first run spec-workflow-guide. Role: React 前端工程师。Task: 改 NoteView.tsx：(1) 删 editing state 与 import NotePreview 与顶部阅读/编辑 Segmented；(2) onSave 去掉 setEditing(false)，只 setContent 与 setActiveNoteData；(3) onCancel 改为调 closeTab（参数 note:+noteId）（无只读态，取消即关 tab）；(4) 顶栏布局：外层 div flex + alignItems center + gap 8，左侧 span 用 inline style（flex 1、minWidth 0、overflow hidden、textOverflow ellipsis、whiteSpace nowrap、fontSize 12、color 用 var(--ob-text-faint)）放元信息文案，右侧 antd Space（size 4）放复制 button 与删除 Popconfirm（两个 button 必须在同一 Space 内相邻）；(5) 主体始终渲染 NoteEditor（传 noteId、rawContent=content.raw_content、onSave、onCancel）。Restrictions: 删干净 NotePreview 引用（task 8 删文件）；复制/删除必须在同一 Space 内相邻（修错位）；保留元信息文案；中文注释。Success: pnpm build 绿；复制/删除按钮相邻不再错位；默认进可视化（NoteEditor mode=visual）；无只读态。记 log（taskId=7，artifacts components 列 NoteView 改造）。标记本 task [-]→[x]。_

- [x] 8. 删除 NotePreview.tsx（清死码）
  - File: frontend/src/components/NotePreview.tsx（删除）
  - 描述：双模式上线后只读 HTML 态不再需要，NoteView 已不引用（task 7），且 grep 确认无其他引用 → 删除该文件。
  - 关键：删除前 `grep -rn "NotePreview" frontend/src/` 确认仅自身定义（task 7 已删 NoteView 引用）；若仍有残留引用先修。
  - _Leverage: 无（清死码）_
  - _Requirements: AC-5.2_
  - _Prompt: Implement the task for spec editor-dual-mode, first run spec-workflow-guide. Role: 前端清理。Task: 先 grep -rn NotePreview frontend/src/ 确认零引用（除自身定义），无则删 frontend/src/components/NotePreview.tsx。Restrictions: 删前必须确认零引用（task 7 已删 NoteView 引用）；若发现残留引用先修再删。Success: grep NotePreview 在 frontend/src 零命中；pnpm build 绿。记 log（taskId=8）。标记本 task [-]→[x]。_

## P2 · 收口

- [x] 9. 客观裁判全绿（前端主裁判 + 后端无回归确认）
  - File: 全量验证（不改代码，跑裁判；有红修到绿）
  - 描述：跑 `cd frontend && pnpm build`（tsc -b + vite build，前端类型+构建）+ `cd src-tauri && cargo check`（后端零改动确认无回归）+ 现有 RichEditor.test 维持绿。有红把错误喂回修复，loop until dry。
  - 关键：tsc 读输出确认（不只信 exit code）；后端 cargo check 必须零变动确认；重点检查 WikilinkDecorations 的 ProseMirror 类型、NoteEditor 的 antd Modal/Segmented 类型、RichEditor 的 editorProps 类型。
  - _Leverage: CLAUDE.md 验证命令_
  - _Requirements: 全部 AC 的客观验证_
  - _Prompt: Implement the task for spec editor-dual-mode, first run spec-workflow-guide. Role: QA 客观裁判。Task: 跑 cd frontend && pnpm build（读完整输出，不只 exit code）与 cd src-tauri && cargo check。有 TS 错误/构建失败则定位修复重跑，loop until 全绿。重点检查：WikilinkDecorations 的 ProseMirror 类型、NoteEditor 的 antd Modal/Segmented 类型、RichEditor 的 editorProps 类型。Restrictions: 不为过裁判降级 tsconfig 严格度；不改后端代码（后端零改动，cargo check 仅确认无回归）；修复遵循中文注释与现有风格。Success: pnpm build 与 cargo check 全绿；RichEditor.test 维持绿。记 log（taskId=9，summary 写修了哪些裁判红）。标记本 task [-]→[x]。_

## backlog（本期不做，显式列出防 scope creep）

- 可视化模式用 Decoration.widget 隐藏双方括号符号、只显示链接文字（Obsidian live preview 完整效果）。
- 按 note_type 路由的可视化编辑形态（OKR 进度条写回 / 项目看板写回）——属 product.md Future Vision。
- WikilinkDecorations 正则匹配的独立单测（若手动验证充分则后置）。
- md 源码模式的语法高亮（明确决策不做，保持轻量）。
- md 源码模式大纲点击跳转（按 heading 行号定位 textarea 滚动）—— 簇 C 在 md 模式降级，可视化模式已满足主流场景。
- bundle 拆分（manualChunks 拆 vendor）。
- **六维审查遗留（本期未修，记录防丢失）**：
  - 可视化模式 Esc 退出与 Tiptap 内置 mark 退出冲突（粗体输入中按 Esc 会退出编辑器而非退 mark）—— AC-6.3 优先保留 Esc 退出，Tiptap bold 默认 toggle 少触发，待场景多了再优化（检测活跃 mark 时让 Tiptap 先处理）。
  - RichEditor isExternalUpdate 用 setTimeout(0) 重置在异步 setContent 路径下有竞态窗口（现有代码，现状 99 测试绿，未动防回归）—— 可改为 onUpdate 内消费即翻 false。
  - WikilinkDecorations 每次 docChanged 全量重算（遍历 doc）—— 超大文档可用 DecorationSet.map 增量映射优化（单篇正文规模当前可接受）。
  - unescapeWikilink 对字面双方括号转义的信任边界（用户极少写字面 `[[ ]]`，触发概率低）—— 根因解是从 Tiptap 序列化层关闭 `[]` 转义。
