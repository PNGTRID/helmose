# Tasks Document · 前端组件化重构

> 状态：**已执行完成（2026-06-30，/ruiqin 执行）**。客观裁判三件套全绿：cargo check 0 error / cargo test 18 passed / npm run build 绿；用户可见行为零回归。全部 `- [x]`。
> 性质：纯重构，行为不变。每项完成后跑 `npm run build` 确认无回归；全部完成后跑 `cargo check` + `cargo test` + `npm run build`。
> 执行顺序：utils/hooks 基础设施（1-4）→ 接入消除重复（5-7）→ 拆分胖组件（8-10）→ 竞态修复（11）→ 客观裁判（12）。

- [x] 1. 建 `utils/date.ts`（迁入 dateKey）
  - File: `frontend/src/utils/date.ts`（新建）
  - 从 `pages/CalendarPage.tsx` 迁出 `dateKey(s)`，原样保留签名/返回值；CalendarPage 改为 import
  - Purpose: 纯函数集中第 1 步（日期域）
  - _Leverage: `pages/CalendarPage.tsx::dateKey`_
  - _Requirements: 4.1, 4.2_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer | Task: 新建 frontend/src/utils/date.ts，把 pages/CalendarPage.tsx 的 dateKey 函数原样迁入（签名 dateKey(s: string|null): string|null 不变），CalendarPage 改为从 utils/date 导入，覆盖 requirements 4.1/4.2 | Restrictions: 纯重构行为不变，不改 dateKey 逻辑，不引入新依赖 | Success: dateKey 迁入 utils/date.ts，CalendarPage 编译通过且行为不变，npm run build 绿。完成后在 tasks.md 把本任务 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 2. 建 `utils/note.ts`（迁入 extractOutline + openNoteFromMeta）
  - File: `frontend/src/utils/note.ts`（新建）、`stores/tabs.ts`（不改，仅引用）
  - 迁入 `extractOutline(raw)`（从 NoteView）；新增 `openNoteFromMeta(meta)` 内部调 `useTabsStore.getState().openNote(meta)`；NoteView 改为 import extractOutline
  - Purpose: 纯函数集中（笔记域）+ 消除 openNote 映射重复（Req 2 基础设施）
  - _Leverage: `components/NoteView.tsx::extractOutline`、`stores/tabs.ts::openNote`_
  - _Requirements: 2.2, 4.1, 4.2_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer | Task: 新建 frontend/src/utils/note.ts：迁入 NoteView 的 extractOutline（签名不变），并新增 openNoteFromMeta(meta: {id;title;file_name;rel_path}) 内部调 useTabsStore.getState().openNote；NoteView 改 import extractOutline，覆盖 2.2/4.1/4.2 | Restrictions: 纯重构，openNoteFromMeta 只是 openNote 的便捷封装不得改变跳转语义，不引入新依赖 | Success: utils/note.ts 提供 extractOutline + openNoteFromMeta，NoteView 编译通过行为不变，npm run build 绿。完成后 [ ]→[-]→[x] 并 log-implementation_

- [x] 3. 建 `utils/tree.ts`（迁入 makeCompare/childDirs/fileIcon）
  - File: `frontend/src/utils/tree.ts`（新建）
  - 从 `components/FilePanel.tsx` 迁出 `makeCompare`/`childDirs`/`fileIcon`，原样保留；FilePanel 改为 import
  - Purpose: 纯函数集中（树域）
  - _Leverage: `components/FilePanel.tsx::makeCompare/childDirs/fileIcon`_
  - _Requirements: 4.1, 4.2_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer | Task: 新建 frontend/src/utils/tree.ts，把 FilePanel 的 makeCompare/childDirs/fileIcon 三个纯函数原样迁入（含 SortMode 类型），FilePanel 改为从 utils/tree 导入，覆盖 4.1/4.2 | Restrictions: 纯重构行为不变，函数逻辑/签名不变，不引入新依赖 | Success: 三函数迁入 utils/tree.ts，FilePanel 编译通过行为不变，npm run build 绿。完成后 [ ]→[-]→[x] 并 log-implementation_

- [x] 4. 提取 `useWikilinkNavigation` hook
  - File: `frontend/src/hooks/useWikilinkNavigation.ts`（新建）
  - 封装「closest('.helmose-wikilink') → searchNotes(name,1) → openNote 或 onNavigate」；返回 `handleClick(e)`；opts.onNavigate 可选（TasksPage 替换 Drawer 内容用）
  - Purpose: 消除 wikilink 跳转重复（Req 1 基础设施）
  - _Leverage: `components/NoteView.tsx::onPreviewClick`、`pages/TasksPage.tsx::onDrawerClick`_
  - _Requirements: 1.2, 1.3_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Hooks Developer | Task: 新建 frontend/src/hooks/useWikilinkNavigation.ts，封装点击 .helmose-wikilink 的跳转逻辑（读 dataset.target → api.searchNotes(vault.id,name,1) → 命中则 openNote 或调 opts.onNavigate），签名 useWikilinkNavigation(opts?: {onNavigate?}): {handleClick}，覆盖 1.2/1.3 | Restrictions: 行为与 NoteView.onPreviewClick 现状一致（失败静默），不引入新依赖，未命中不报错 | Success: hook 提供 handleClick，TS 类型正确，npm run build 绿。完成后 [ ]→[-]→[x] 并 log-implementation_

- [x] 5. NoteView / TasksPage 接入 useWikilinkNavigation
  - File: `frontend/src/components/NoteView.tsx`、`frontend/src/pages/TasksPage.tsx`
  - NoteView 删除内联 onPreviewClick，改用 hook（默认 openNote）；TasksPage 删除 onDrawerClick，改用 hook（onNavigate 替换 noteContent）
  - Purpose: 消除 wikilink 跳转重复（落地）
  - _Leverage: `hooks/useWikilinkNavigation`_
  - _Requirements: 1.1, 1.2_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Developer | Task: NoteView 与 TasksPage 移除各自内联的 wikilink 点击逻辑，改为调用 useWikilinkNavigation——NoteView 用默认 openNote 行为，TasksPage 传 onNavigate 替换 Drawer 的 noteContent，覆盖 1.1/1.2 | Restrictions: 用户可见行为零回归（点击 wikilink 跳转/替换与原来一致），不引入新依赖 | Success: 两文件不再内联跳转逻辑，行为不变，npm run build 绿。完成后 [ ]→[-]→[x] 并 log-implementation_

- [x] 6. 各页面/组件接入 openNoteFromMeta
  - File: `components/FilePanel.tsx`、`components/SidePanel.tsx`、`pages/CalendarPage.tsx`、`pages/JournalPage.tsx`、`pages/ProjectsPage.tsx`、`pages/TasksPage.tsx`（search 结果项）、`App.tsx`（CommandPalette 内，若尚未随任务 7 迁出）
  - 把所有 `openNote({id,title,file_name,rel_path})` 字段映射替换为 `openNoteFromMeta(meta)`
  - Purpose: 消除 openNote 映射重复（落地）
  - _Leverage: `utils/note.ts::openNoteFromMeta`_
  - _Requirements: 2.1, 2.2, 2.3_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Developer | Task: 把 FilePanel/SidePanel/CalendarPage/JournalPage/ProjectsPage/TasksPage 中所有 openNote({id,title,file_name,rel_path}) 的重复字段映射替换为 openNoteFromMeta(meta)，覆盖 2.1/2.2/2.3 | Restrictions: 纯重构行为不变，openNoteFromMeta 内部仍走 store.openNote，字段降级（title null→file_name）由 store 现有逻辑兜底，不引入新依赖 | Success: 无重复字段映射，所有打开笔记入口行为不变，npm run build 绿。完成后 [ ]→[-]→[x] 并 log-implementation_

- [x] 7. 拆 CommandPalette 出 App.tsx
  - File: `frontend/src/components/CommandPalette.tsx`（新建）、`frontend/src/App.tsx`
  - 把 App.tsx 内的 `CommandPalette` 函数原样迁到独立组件；App.tsx import 并在末尾 `<CommandPalette />`；删除 App 内原函数与相关 import（Input/List/Modal/SearchResult 等若不再用）
  - Purpose: App.tsx 减负（Req 3）
  - _Leverage: `App.tsx::CommandPalette`（[App.tsx:24-93](frontend/src/App.tsx#L24-L93)）_
  - _Requirements: 3.1, 3.2, 3.3_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Developer | Task: 把 App.tsx 内的 CommandPalette 函数原样迁到 components/CommandPalette.tsx（自管 paletteOpen/setPalette，读 useVaultStore/useTabsStore/api.searchNotes），App.tsx 改为 import 并渲染 <CommandPalette />，清理 App 不再用的 import，覆盖 3.1/3.2/3.3 | Restrictions: 命令面板行为零回归（Ctrl/⌘+P、搜索、跳转），App 其余职责（布局/拖拽/索引/监听）不动，不引入新依赖 | Success: CommandPalette 独立，App.tsx 行数显著下降且行为不变，npm run build 绿。完成后 [ ]→[-]→[x] 并 log-implementation_

- [x] 8. 拆 NoteEditor 出 NoteView
  - File: `frontend/src/components/NoteEditor.tsx`（新建）
  - 抽出编辑模式：CodeMirror + marked 实时预览 + 保存/取消按钮 + save 逻辑（写 vault + 备份提示）；props: noteId, rawContent, onSave(updated), onCancel
  - Purpose: NoteView 拆分第 1 步（Req 5）
  - _Leverage: `components/NoteView.tsx` 编辑分支 + `save`_
  - _Requirements: 5.1, 5.3_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Developer | Task: 新建 components/NoteEditor.tsx，封装 NoteView 的编辑分支（CodeMirror + marked 分屏 + save 写 vault + .helmose/backup 提示 + 取消），props {noteId, rawContent, onSave(updated: NoteContent), onCancel}，覆盖 5.1/5.3 | Restrictions: 编辑/保存行为零回归（含备份与增量重索引），save 内部仍调 api.saveNoteContent，不引入新依赖 | Success: NoteEditor 独立可渲染，此时 NoteView 暂未接入也需保证 build 绿（可同步在任务 10 接入），npm run build 绿。完成后 [ ]→[-]→[x] 并 log-implementation_

- [x] 9. 拆 NotePreview 出 NoteView
  - File: `frontend/src/components/NotePreview.tsx`（新建）
  - 抽出阅读模式：dangerouslySetInnerHTML 渲染 html + 内部用 useWikilinkNavigation 处理点击；props: html
  - Purpose: NoteView 拆分第 2 步（Req 5）
  - _Leverage: `components/NoteView.tsx` 阅读分支、`hooks/useWikilinkNavigation`_
  - _Requirements: 5.1, 5.4_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Developer | Task: 新建 components/NotePreview.tsx，封装阅读模式（dangerouslySetInnerHTML 渲染 props.html + 用 useWikilinkNavigation 处理点击），props {html}，覆盖 5.1/5.4 | Restrictions: 阅读视图行为零回归（wikilink 跳转与重构前一致），不引入新依赖 | Success: NotePreview 独立可渲染，npm run build 绿。完成后 [ ]→[-]→[x] 并 log-implementation_

- [x] 10. NoteView 重构为容器
  - File: `frontend/src/components/NoteView.tsx`
  - NoteView 保留：加载 getNoteContent/getBacklinks、阅读/编辑切换 Segmented、outline/backlink 同步（setActiveNoteData）；编辑态渲染 `<NoteEditor>`，阅读态渲染 `<NotePreview>`
  - Purpose: NoteView 拆分收口（Req 5）
  - _Leverage: `components/NoteEditor.tsx`、`components/NotePreview.tsx`_
  - _Requirements: 5.1, 5.2, 5.4_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Developer | Task: 重构 NoteView 为容器——保留加载/切换/outline+backlink 同步逻辑，编辑态渲染 <NoteEditor noteId rawContent onSave onCancel>，阅读态渲染 <NotePreview html>，覆盖 5.1/5.2/5.4 | Restrictions: 阅读/编辑/保存全流程行为零回归，NoteView 行数显著下降，loading/空态兜底保留，不引入新依赖 | Success: NoteView 为容器组合子组件，行为不变，npm run build 绿。完成后 [ ]→[-]→[x] 并 log-implementation_

- [x] 11. FilePanel 竞态修复
  - File: `frontend/src/components/FilePanel.tsx`
  - 给 listDirs+listAllNotesMeta 的 useEffect 加 cancelled flag（cleanup 置 true，then 内 if(!cancelled) 才 setState），与 useAllNotesMeta 模式一致
  - Purpose: 修复文件树加载竞态（Req 6）
  - _Leverage: `hooks/useAllNotesMeta.ts` cancelled 模式（[useAllNotesMeta.ts:22-49](frontend/src/hooks/useAllNotesMeta.ts#L22-L49)）_
  - _Requirements: 6.1, 6.2, 6.3_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Developer | Task: 给 FilePanel 的 listDirs+listAllNotesMeta 的 useEffect 加 cancelled flag（let cancelled=false；cleanup return ()=>{cancelled=true}；then/catch/finally 内 if(!cancelled) 才 setState），参照 useAllNotesImplement 模式，覆盖 6.1/6.2/6.3 | Restrictions: 用户可见行为零回归（树/搜索/排序不变），只加竞态守卫不改业务逻辑，不引入新依赖 | Success: FilePanel fetch 有 cancel 守卫，行为不变，npm run build 绿。完成后 [ ]→[-]→[x] 并 log-implementation_

- [x] 12. 客观裁判全绿 + 行为回归
  - `cd src-tauri && cargo check`（0 error，warning 不增量）
  - `cd src-tauri && cargo test`（18 passed 不回归）
  - `cd frontend && npm run build`（tsc -b + vite build）
  - `npm run tauri:dev` 手动回归：阅读/编辑保存/wikilink 跳转/反链/文件树/命令面板/标签折叠/日历/日志
  - Purpose: 验证无回归（Req 7）
  - _Leverage: CLAUDE.md 验证命令_
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Prompt: Implement the task for spec frontend-componentization, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Engineer | Task: 跑客观裁判三件套（cargo check / cargo test / npm run build）确认全绿且无回归，并对照 requirements 7.1-7.4 列行为回归清单（阅读/编辑保存/wikilink/反链/文件树/命令面板/标签/日历/日志）逐项确认与重构前一致 | Restrictions: 不为通过裁判而改业务逻辑；发现回归立即回退到对应任务修复 | Success: 三件套全绿，回归清单逐项确认，无行为回归。完成后 [ ]→[-]→[x] 并 log-implementation_

## 未列入本期（backlog）
- [ ] DataState 组件（统一 loading/error/empty 三态渲染）
- [ ] index.css 按组件拆分（592 行单文件）
- [ ] 前端测试框架引入（vitest）+ utils 纯函数 co-located 单测
- [ ] CSS 按域拆分 / CSS Module 化
