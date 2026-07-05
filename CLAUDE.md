# Helmose · 项目协作指令（CLAUDE.md）

> AI 协作时必读。Helmose = AI 驱动的人生知识库桌面应用（Tauri v2 + Rust + React）。

## 一句话定位

**人读 + Agent 读双导向**的本地人生数据底座。直接读写 Obsidian 式 markdown vault，内置 AI 当教练/秘书/第二大脑，并产出机器可读状态给外部智能体。

## 技术栈速览

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri v2（Rust 后端 + React 前端） |
| 后端 | Rust（edition 2021）：rusqlite 0.32 / walkdir 2.5 / pulldown-cmark 0.11 / gray_matter / notify（增量索引已启用）/ sha2 / tauri-plugin-notification（任务到期桌面通知）/ tauri-plugin-updater |
| 前端 | React 19 + TypeScript 5.9 + Vite 7 + antd 6 + Zustand 5 + react-router-dom 7 + TipTap 3（WYSIWYG 富文本编辑，已替换 CodeMirror）+ @dnd-kit（四象限拖拽） |
| 数据 | 本地 markdown（vault，真相源）+ SQLite（`<app_data_dir>/helmose.db`，派生缓存） |

详细见 `.spec-workflow/steering/tech.md`。

## 开发与验证命令（客观裁判）

```bash
# 前端依赖（pnpm；本机 npm 损坏、install 不建 .bin，统一用 pnpm）
cd frontend && pnpm install

# 开发（前端 + Tauri 后端）
cd frontend && npm run tauri:dev

# 仅前端（浏览器，无 Rust 后端）
cd frontend && npm run dev

# —— 验证（客观裁判，改完代码必跑）——
cd src-tauri && cargo check          # Rust 类型 + 借用检查
cd src-tauri && cargo test           # Rust 单测（含真实 vault smoke test）
cd frontend && pnpm build         # = tsc -b && vite build（前端类型 + 构建）
```

全量 Tauri 构建（产安装包）：`cd frontend && npm run tauri:build`。

## 架构铁律（不可违反）

1. **vault 是唯一真相源**。SQLite 是派生缓存——删库可从 vault 全量重建。永远不要把 SQLite 当主存。
2. **vault 原文只读**。索引/查询/浏览一律只读 md 文件；任何写 vault（编辑、Agent inbox 写回）必须有用户明确动作 + 保护机制。**绝不在用户没要求时改动 vault 原文**。
3. **IPC 边界**：Tauri v2 自动转参数名 `camelCase ↔ snake_case`；**返回值 JSON 字段保持 snake_case**（Rust serde 默认），前端 TS 接口必须对齐（如 `rel_path`、`note_type`、`last_indexed`）。
4. **分层解析（契约驱动）**：`services/contract/mod.rs` 内置 ~/wiki/规范.md 契约（10 个顶层目录 + 12 种 type（含 log）+ type→dir 映射），`infer_note_type`（frontmatter.type 优先 + 路径最长前缀反查）+ `infer_layer`（按 type 结构化程度判 L1/L2/L3）取代旧 `layers.rs`。新增 vault 目录结构时改 `contract::TYPE_DIR_PAIRS` / `TOP_LEVEL_DIRS`，否则 `note_type` 反查不到会降级为 `None`（默认 L2）。
5. **排除目录单一契约**：`utils/exclude.rs` 是唯一排除规则定义点（`EXCLUDE_DIRS = ["6-原始资料", "专家团"]` + 隐藏目录），`commands/index.rs`、`commands/library.rs`、`services/indexer/incremental.rs` 共用 `is_excluded_*`。新增排除目录只改这一处，避免"索引视图"与"浏览视图"漂移。

## 性能红线（硬约束）

vault 规模约 **1.9 万 md 文件**。以下规则必须遵守：

- ❌ **禁止**任何命令一次性返回所有笔记的 `raw_content`（全文）。1.9 万 × 全文 = IPC/内存必爆。
- ✅ 列表/树只返回**元数据**（`NoteMeta`，无正文）；单篇预览才取全文（`get_note_content`）。
- ✅ `list_all_notes_meta`（全量元数据，无正文）、`search_notes`（FTS5 snippet 高亮，无全文）同样遵守——只回元数据或 snippet，绝不回 `raw_content`。
- ✅ 目录树用 `list_dirs`（只扫目录，轻）；文件列表按目录懒加载（`list_notes_meta(dir_prefix)`）。
- 新增查询命令时，先想"会不会一次拉太多"，必要时分页/懒加载/去正文。

## 编码规范

- **注释一律中文**（与现有代码库一致）。
- Rust 命令：`#[tauri::command] fn xxx(...) -> AppResult<T>`（= `Result<T, AppError>`，定义在 `models/error.rs`，9 variant + 自定义 Serialize 输出 `{code, message}`）。错误优先具体 variant：业务错用构造器（`AppError::not_found/invalid_input/conflict/precondition_failed(...)`），底层错用 `#[from]` 裸 `?`（rusqlite→`Db` / io→`Io` / serde→`Serde` / tauri→`Internal` 自动）；**慎用 `.map_err(|e| e.to_string())?`**（经 `From<String>` 走 `Internal` 兜底，丢 variant）。前端 `api/index.ts` invoke 包装把 reject 归一化成 AppError 对象（`toString()=message` 兜底零破），`utils/notifyError.ts` 按 code 分流消费。
- Rust 模块经 `mod.rs` 暴露；跨模块用 `crate::` 绝对路径。
- React 页面：hooks → 早返回 → JSX；类型集中 `types/index.ts`；API 集中 `api/index.ts`。
- 改代码前**先读后写**，理解现有约定再动手（如 `SqliteDatabase::query_map` 返回 `Vec`、`query_row` 返回 `Option`）。
- 不添加用户没要求的功能/重构/改进。

## 新增 Tauri 命令的标准流程

1. `models/` 加/改 DTO（`#[derive(Serialize)]`，字段 snake_case）。
2. `commands/<领域>.rs` 写 `#[tauri::command]`，`State<'_, Database>` 取库。涉及 note_type / 目录判定时复用 `services::contract`（勿自写前缀映射）。
3. `commands/mod.rs` 加 `pub mod <领域>;`。
4. `main.rs` 的 `invoke_handler!` 注册命令。
5. `frontend/src/types/index.ts` 加对齐类型；`api/index.ts` 加 `invoke` 封装。
6. 跑 `cargo check` + `pnpm build` 全绿。

## 已知后续项（backlog）

✅ **已落地**：

- 全库搜索 `search_notes`（FTS5，命令 + 前端命令面板已接）。
- 增量索引（`notify` 监听 + `start_watcher` 命令，App 启动自动起）。
- Agent 状态导出 `export_life_state`（写 `app_data_dir/agent/{LIFE-STATE.md, state.json}`）。
- 脚手架 `scaffold_vault`（新建 Life OS 目录骨架）。
- 笔记编辑写回 `save_note_content`（写前备份到 `.helmose/backup`）。
- 关系图谱 / 反向链接（`get_graph_data` / `get_backlinks`）。
- **wikilink `[[x]]` 可点跳转**（后端 `render_wikilinks` 渲染为 `<a class="helmose-wikilink" data-target>` + 前端 `useWikilinkNavigation` 点击全库搜跳转 + CSS 紫色双下划线，已含测试）。
- **projects 深度结构化**（`get_projects` 返回 priority/is_mainline/含 top-3 兜底/okr_priority/last_activity 全字段；indexer 两层提取）。
- **events 解析**（从笔记「关键事件/时间线」section 提取 bullet 填 events 表 + `list_events` 命令；日历/今日页消费）。
- **tasks due_date 解析**（bullet 内 `📅` / `due:` / `截止:` / `deadline` 标记 → due_date 列；TasksPage 分组 + TodayPage 今日待办按此筛）。
- **任务标记文字化（Postel 法则：读宽容、写规范）**——独立自建定位 + Obsidian 用户零摩擦切入：
  - **读侧 indexer 三格式全兼容**（`services/indexer/tasks.rs`）：due（📅 / due: / 截止: / deadline）/ priority（`⭐×N` Helmose老 / `⏫🔼🔽` Obsidian Tasks标准→3/2/1 / `priority:N` Helmose文字，N=1-3，3=最高）/ urgency 三态（`🔥`/`urgency:high`=显式 high 强制 / `urgency:low`=显式 low 压制 due_date 派生 / 无标记=`""` 未设由前端 due_date 派生；mid 仅派生不入 bullet，Blocker #1 方案 B：manual low 可覆盖派生 high，治「今天到期拖不进不紧急象限」）/ repeat（`🔁 every X` Helmose老 / `repeat:X` Helmose文字）。三种格式命中即停，统一 `split_*` 清理。
  - **写侧默认 Helmose 文字契约**（独立演进，对 Agent 可读性更友好）：`buildTaskBullet`（`utils/quickAdd.ts`，写侧唯一拼装源）+ `set_task_priority/urgency_inner`（`commands/library.rs`，加 `marking_style: Option<String>` 参数，None 默认 helmose）按风格输出；切风格时剥全格式不残留。
  - **双模式开关**：`stores/markingStyle.ts`（localStorage `helmose-marking-style` 持久化，默认 `helmose`）+ Settings 页「任务标记风格」Segmented；`obsidian` 模式写侧对齐 Obsidian Tasks 插件（📅/⏫🔼🔽/🔁/🔥，双端互通），`getMarkingStyle()` 供非组件场景读。
  - **存量迁移**：priority/repeat 读侧全兼容，老 emoji bullet 不动即可用；**urgency 三态有一次性重索引**（`App.tsx` localStorage `helmose-urgency-3state-v1` 标记，首次启动强制 `index` 把存量无标记 `urgency="low"` 刷新为 `""` 未设，否则会被误当显式 low 压制派生）。批量转换工具 `migrate_task_markers`（dry-run + 备份 + 手动触发）为可选 backlog，**未实现**（碰 vault 原文高风险，读侧已兼容无必要，需时再做）。
- **创建笔记 `create_note`**（用户按钮触发写 vault + 增量索引 + 路径防穿越 + 不覆盖；TodayPage「今日笔记」动线）。
- **前向链接 `get_forward_links`**（SidePanel 双向链接完整：反链 + 前向）。
- **标签精确筛选 `list_notes_by_tag`**（tags JSON 数组精确匹配，替代 FTS 全文搜的宽泛）。
- **暗色模式**（`stores/theme.ts` + antd `darkAlgorithm` + CSS `html.dark` 变量 + StatusBar 切换 + localStorage 持久化）。
- **ErrorBoundary**（content 区错误捕获，单页崩不白屏 + 重试/重载）。
- **FilePanel 虚拟列表**（antd Tree `virtual` + ResizeObserver 测高，1.9 万节点只渲染可见行）。
- **自动更新框架**（`tauri-plugin-updater` + `check_update` 命令 + SettingsPage 按钮；pubkey/endpoints 占位 `TODO_REPLACE_AT_RELEASE`，发布时配真实值）。
- **重置安装 `reset_app`**（DROP 派生表 + 清 agent 缓存 + 移除 vault 注册，回 Onboarding；绝不碰 vault 原文）。
- **今日计划页 `PlannerPage`**（三栏：收集箱/分类/迷你日历 + 四象限+输入条 + 详情面板；视觉照搬根目录 `task-planner-preview.html`；分类软方案 = localStorage 自定义分类 + 项目/文件夹/tag 三选一映射 + `stores/plannerCategories.classifyTask` 推导，不落库不改 schema；描述用 Obsidian Tasks 缩进行惯例存任务行下方缩进纯文本，不污染 `task.text`；四象限拖拽写回复用 `set_task_priority`+`set_task_urgency`；右栏「更多」菜单标今日/清期限/复制任务）。
- **行级就地写入（inline-crud）**（`commands/library.rs`，全经 `save_note_content_inner` 收口 = 备份 + 重索引，不自写 fs::write）：
  - `insert_line_after`（指定 1-based 去fm正文行号后插新行；子计划新增用，缩进 checkbox 子任务由 indexer 按最近非缩进父归属 `parent_task_id`）。
  - `update_line` / `delete_line` / `append_bullet`（行级改/删/尾追加）。
  - `patch_frontmatter`（就地改单/多个 fm 字段，不动正文）/ `set_tag`（增删 tag 数组元素）。
- **任务字段就地写入（M3）**：`set_task_status` / `set_task_priority` / `set_task_urgency`（命令注册在 `library.rs`；priority/urgency 加 `marking_style` 参数，None 默认 helmose 文字契约；四象限拖拽 + 任务卡状态切换复用此组命令写回）。
- **WYSIWYG 富文本编辑（TipTap v3）**（`components/RichEditor.tsx` + `RichEditorToolbar`，替换旧 CodeMirror）：所见即所得（标题/粗体/列表/任务复选框/表格/链接），对外仍是 markdown 字符串（`@tiptap/markdown` 双向转换），全链路零改动；`NoteEditor` 包装它只编辑「去 fm 正文」，保存走 `save_note_body`；含 `unescapeWikilink` 还原 `@tiptap/markdown` 对 `[[wikilink]]` 成对括号的转义（防双链/反链/图谱断链 + 防污染 vault 原文）。
- **笔记正文写回 `save_note_body`**（`commands/library.rs`）：读盘取原 frontmatter → 拼接新正文 → 备份 + 写盘 + 增量索引；**不丢 type/tags/created 等 fm**（区别于 `save_note_content` 整篇覆盖，WYSIWYG 编辑专用）。
- **OKR 全链路**（M1）：`services/indexer/okrs.rs` 从 strategy/project 文档的 KR section 提取填 `okrs` 表；`commands/okrs.rs::list_okrs`（可按 quarter 过滤，排序 quarter DESC→P0 在前）；前端项目页 ProgressView 消费。
- **项目进度聚合 `get_project_progress`**（M5，`commands/projects.rs`）：运行时聚合项目下任务完成率，**不入 frontmatter**（纯派生展示）。
- **任务到期提醒（M2，`commands/reminders.rs`）**：`ensure_reminders`（扫 tasks 表 due_date 未来 N 天未完成任务，按「截止前一天 9:00」幂等生成 reminders）+ `fire_due_reminders`（前端 setInterval 60s 调，查到期未发 → `tauri-plugin-notification` 桌面通知 + 标 fired）；查询/标 fired 已拆纯函数可单测。
- **移动 / 重命名笔记（M1，`commands/note_move.rs`）**：`move_note` / `rename_note`（路径安全校验禁 `..` + 索引层同步）+ `apply_ref_updates`（扫描含 `old_path` 的路径型引用 `[文本](old_path)` / `[[old_path]]`，**用户授权后**逐条经 `save_note_content_inner` 收口写回；按文件名匹配的反链由 links 表自动维护，不进此列表）。
- **AI 配置 `settings`（M4，`commands/settings.rs`）**：`get_ai_settings` / `set_ai_settings` 存 `app_data_dir/config.json`（不入 vault 不入 git，Unix 0600 收紧权限）；**api_key 不进 config.json，走系统钥匙串**（B4，见下 `services/secrets.rs`，keyring v3），config.json 只存 provider/enabled 等非敏感字段；`read_ai_settings`（容错版，供 ai 命令壳复用避免漂移）+ `upsert_ai_generation_inner` / 读缓存（降级链兜底）。
- **AI 教练层（M4，`commands/ai.rs` + `services/ai/`）**——v0.2 提前部分落地：
  - **抽象层** `services/ai/`：`AiClient` trait（Dyn-safe，provider 切换零业务改动）+ `providers/`（Claude / OpenAI，留 Ollama 本地扩展点）+ `complete_with_budget`；数据最小化（只接聚合摘要字符串，user 硬上限 4k 字符截断，绝不发 vault 原文）+ 30s 超时 + `AiError`（Network/HttpStatus/Parse）绝不 panic。
  - **三个命令**：`ai_mainline`（主线判定，写 `life_state_snapshots.mainline_project`）/ `ai_coach`（每日建议，写 `today_focus`）/ `ai_tomorrow`（明日一句）。
  - **降级链**：未配 key/`build_client`→None → 本地启发式（复用 indexer/projects top-3 口径）→ `ai_generations` 缓存 → 空态；结果带 `source=ai|heuristic` 标降级。
  - **明日一句编辑 `update_tomorrow_sentence`**（前端 `saveTomorrowEdit` 复用同一收口逻辑）。
- **B3 watcher 生命周期（`services/watcher.rs` 重构为 WatcherManager）**：start/stop/stop_if_watching（stop_flag + recv_timeout 轮询 + join 超时保护），接 reset_app/delete_vault 停 watcher——修复 reset 后旧 watcher 把删除事件往空库写的「数据回潮」bug（8 测试）。
- **B4 keychain（`services/secrets.rs`）**：api_key 从 config.json 明文挪到系统钥匙串（keyring v3，删 credential 用 `delete_credential` 非 `delete_password`）；老 key 惰性迁移（`plan_migration`/`strip_api_key_from_json` 纯逻辑可单测）；前端零改动（接口面 provider/has_key/enabled + `setApiKey` 不变，7 测试）。
- **B6/B7/B15 三项小修复**：B6 修 7 处 `.ok()` 吞错（`incremental.rs` 加事务内 `query_optional` helper 区分 `QueryReturnedNoRows` vs 真错，替代 6 处 `tx.query_row().ok()`；`library.rs` repeat_rule 查询去掉多余 `.ok().flatten()`——为 B1 AppError 错误码化铺路）/ B7 `delete_vault_inner` 删 notes 前补 `DELETE FROM notes_fts WHERE rowid IN (SELECT rowid FROM notes WHERE vault_id=?1)` 清 contentless FTS 孤儿（唯一漏清路径；含测试断言 FTS 清零）/ B15 前端 10 处散落 localStorage 收口到 `utils/safeLocalStorage`（App/Onboarding/CommandPalette/FilePanel/AiCoachCard/drafts/recentlyOpened + projectView/taskView/theme 三 store；消除裸 `JSON.parse(localStorage)` 崩溃风险 + 统一容错）。

- **B1/B14 AppError 错误码化端到端**（`models/error.rs`）：9 variant（NotFound/InvalidInput/Conflict/PreconditionFailed/Db/Io/Serde/Secrets/Internal，thiserror + 自定义 Serialize 输出 `{code, message}` + `From<rusqlite/io/serde/String/tauri>`）；62 命令签名 `Result<T, String>` → `AppResult<T>`；显式业务 Err 映射具体 variant（非法→InvalidInput / 已存在→Conflict / not found→NotFound / 源文件丢失→PreconditionFailed），透传型 `.map_err(|e| e.to_string())?` 改裸 `?` 让 `#[from]` 生效（Db/Io/Serde）。前端 `api/index.ts` invoke 包装 reject 归一化成 AppError 对象（`toString()=message` 阶段 1 兼容零破），`utils/notifyError.ts` 按 code 分流（业务错显文案 / 系统错统一「失败请重试」），40 处 `message.error(\`${e}\`)` 收口到 `notifyError`。NotFound 保留 `Ok(None)` 查询契约（前端 null 判断不变），AI 降级链不破坏。B6 `query_optional` 为真错上抛铺路。

- **Phase C 批1 质量加固（17 项，客观裁判全绿；详见 `docs/phase-c-backlog.md`）**：clippy 清零 + ci clippy 门禁（B16-18）；get_notes 去 raw_content（性能红线）+ tasks/events 加索引（vault/project/note）+ incremental/vault `.map_err`→裸 `?`（B14 收尾）；devtools 改 debug-only + panic hook（logging.rs）+ set_api_key 校验 + main println→debug（安全 P0）；export_life_state 去 root_path + watcher 4 处日志脱敏降 debug + index_vault eprintln→tracing::error（信息泄露）；backup_dir_of 抽函数（可维护）；noImplicitOverride 开启（ErrorBoundary/AppError override）+ chunkSizeWarningLimit:1500（构建）；extract_due_from_line/replace_or_append_due +2 纯函数测试（toggle 重复任务推进写回）。剩 28 项待做（含 P0 updater/签名/Sentry 需决策）见 docs。

🚧 **待办**：

- 静默吞 `.catch(() => null)` 15 处评估（核心数据加载如 NoteView 笔记内容/反链、CommandPalette 搜索、GraphPage 图谱可接入 `notifyError` 让用户感知失败；后台探测如 `shouldReindex`/`startWatcher` 保留静默）——B14 收尾，改静默吞会变行为需产品判断，未做（toString=message 兜底已保证不崩）。
- Agent inbox 写回（状态导出已做，写回未做）。
- 真实 updater endpoint/pubkey（M5 占位，发布时配）。
- events 的 `project_id` 关联（event→project 映射未做）。
- 前向链接的 dangling 提示（当前只显示已解析的）。
- AI 提醒可配置（当前 `reminders.rs` 固定 LEAD_DAYS=1 / REMIND_HOUR=9，后续接 settings）。
- AI provider 扩展（`services/ai/providers` 留 Ollama 本地扩展点，未接）。
- bundle 瘦身（manualChunks 拆 vendor + chunkSizeWarningLimit 已消警告；antd 1.15MB 单 chunk 疑全量打包，待核查按需引入，见 `docs/phase-c-backlog.md` §二 P2）。

## 工作区状态

- 已 `git init`，主分支 `main`；CI 见 `.github/workflows/ci.yml`（backend cargo check+test、frontend pnpm build+test）。用户没主动要求，绝不执行 commit/push/branch。
- 默认 vault 候选 `~/wiki`（作者真实 vault，1.9 万 md）；smoke test 可用 `HELMOSE_TEST_VAULT` 环境变量指定路径。
