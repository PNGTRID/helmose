# Project Structure

## Directory Organization

```
helmose/
├── README.md                    # 项目简介 + 开发命令
├── CLAUDE.md                    # 项目级 AI 协作指令（架构铁律/规范/性能红线/backlog）
├── task-planner-preview.html    # PlannerPage 视觉参考稿（照搬实现）
├── package.json                 # 根便捷脚本入口（dev/build/check/test 聚合，转发 frontend 与 src-tauri）
├── pnpm-lock.yaml
├── .github/workflows/ci.yml     # CI：backend cargo check+test / frontend pnpm build+test / coverage
├── scripts/ci-local.sh          # 本地复跑 CI 的脚本
├── .serena/                     # Serena 语义代码工具配置（语言服务器索引）
├── .spec-workflow/              # spec-workflow 规范体系
│   ├── steering/                # 长期生效的项目级文档（product/tech/structure）
│   ├── specs/                   # 各功能的 spec（requirements/design/tasks + Implementation Logs）
│   └── templates/               # 文档模板
├── frontend/                    # React + TypeScript 前端（vite 构建，pnpm 管理依赖）
│   ├── package.json             # packageManager: pnpm@11
│   ├── pnpm-lock.yaml
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx             # 入口（antd ConfigProvider + zhCN）
│       ├── App.tsx              # 工作台外壳：Ribbon + FilePanel + TabBar + 内容区 + SidePanel + StatusBar
│       ├── index.css            # 全局样式
│       ├── api/index.ts         # Tauri 命令封装（invoke，集中所有命令）
│       ├── types/index.ts       # TS 类型（严格对齐 Rust serde，snake_case）
│       ├── stores/              # Zustand 状态
│       │   ├── vault.ts         # 当前 vault + 索引状态
│       │   ├── tabs.ts          # 标签页 / 面板开关 / 命令面板
│       │   ├── theme.ts         # 暗色模式（antd darkAlgorithm + localStorage 持久化）
│       │   ├── markingStyle.ts  # 任务标记风格（helmose/obsidian，localStorage 持久化）
│       │   ├── plannerCategories.ts  # PlannerPage 分类软方案（自定义分类 + 项目/文件夹/tag 映射 + classifyTask 推导）
│       │   ├── projectView.ts   # 项目页视图切换（grid/list/progress/owner）
│       │   └── taskView.ts      # 任务页视图切换（kanban/list/matrix/timeline）
│       ├── hooks/
│       │   ├── useAllNotesMeta.ts
│       │   ├── useActiveProjects.ts
│       │   └── useWikilinkNavigation.ts
│       ├── utils/               # 纯函数 + 同名 .test.ts（vitest）
│       │   ├── date.ts / note.ts / tree.tsx
│       │   ├── quickAdd.ts          # buildTaskBullet：写侧任务 bullet 唯一拼装源（按 markingStyle 输出）
│       │   ├── taskGrouping.ts      # 任务分组（按状态/优先级/到期日）
│       │   ├── journalTemplates.ts / projectTemplates.ts   # 快捷新建模板
│       │   └── safeLocalStorage.ts  # SSR/隐私模式安全的 localStorage 封装
│       ├── components/          # 组件 + 同位 .css（CSS 按域拆分）
│       │   ├── AppIcon / CategoryModal                            # 应用图标 / Planner 分类编辑弹窗
│       │   ├── Ribbon / FilePanel / SidePanel / TabBar / StatusBar # 外壳五件套（FilePanel 虚拟列表）
│       │   ├── NoteView / NotePreview                             # 笔记查看协调者（组合 Editor+Preview）/ md 渲染
│       │   ├── NoteEditor / NoteEditorDrawer                      # TipTap WYSIWYG 编辑模式（包 RichEditor）/ 抽屉版
│       │   ├── RichEditor / RichEditorToolbar                     # TipTap v3 WYSIWYG 编辑器（替换 CodeMirror）+ 工具栏
│       │   ├── NoteFieldsForm / EventFields / InlineEdit          # frontmatter/事件 字段表单 / 行内编辑
│       │   ├── TaskForm / QuickAddTaskModal                       # 任务表单 / 快捷新建任务
│       │   ├── QuickAddProjectModal / QuickAddEventModal / NewEventModal   # 快捷新建项目/事件
│       │   ├── ForceGraph                                        # 关系图谱（d3-force）
│       │   ├── CommandPalette                                    # Ctrl/⌘+P 命令面板（含全库搜索）
│       │   ├── DataState                                         # 列表三态（loading/error/empty）
│       │   ├── ErrorBoundary                                     # content 区错误捕获（单页崩不白屏）
│       │   ├── ai/AiCoachCard                                    # AI 教练卡片（主线/每日建议/明日一句，调 ai_* 命令）
│       │   ├── tasks/                                            # 任务多视图
│       │   │   ├── KanbanView / ListView / MatrixView / TimelineView
│       │   │   └── TaskCard
│       │   └── projectViews/                                     # 项目多视图
│       │       ├── GridView / ListView / OwnerView / ProgressView
│       │       └── shared.ts                                     # 视图共享工具/类型
│       └── pages/
│           ├── OnboardingPage.tsx   # 选/建 vault 引导
│           ├── TodayPage.tsx        # 今日聚焦（统计 + 待办 + AI 教练卡片）
│           ├── PlannerPage.tsx      # 今日计划页（三栏 + 四象限拖拽 + 详情面板）
│           ├── TasksPage / ProjectsPage / CalendarPage / JournalPage
│           ├── GraphPage.tsx        # 关系图谱页
│           ├── SettingsPage.tsx     # vault 管理 + 任务标记风格 + AI 设置 + 检查更新
│           └── Placeholder.tsx      # 占位页（备用）
└── src-tauri/                   # Rust 后端（Tauri v2）
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json    # Tauri 权限
    └── src/
        ├── main.rs              # 入口：插件注册 + invoke_handler 命令注册（含 ping 探针）
        ├── commands/            # Tauri 命令层（IPC 边界）
        │   ├── mod.rs
        │   ├── vault.rs         # vault CRUD / onboarding / reset_app（重置安装，不碰 vault 原文）
        │   ├── index.rs         # 全量索引 index_vault + start_watcher + should_reindex
        │   ├── notes.rs         # 笔记查询 get_notes / get_notes_stats / get_tags_stats
        │   ├── library.rs       # 文档库 + 笔记/任务就地写入：list_dirs / list_notes_meta / list_all_notes_meta / get_note_content / save_note_content（整篇）/ save_note_body（只改正文不丢 fm）/ toggle_task / set_task_status|priority|urgency / 行级 update_line|delete_line|insert_line_after|append_bullet / patch_frontmatter / set_tag / create_note / create_today_note / delete_note（软删除）/ get_backlinks / get_forward_links / get_graph_data / list_notes_by_tag / list_trash / clear_trash / list_backups / delete_backup / get_tomorrow_sentence
        │   ├── tasks.rs         # 任务查询 get_tasks
        │   ├── projects.rs      # 项目查询 get_projects + 进度聚合 get_project_progress（运行时聚合，不入 fm）
        │   ├── events.rs        # 事件查询 list_events
        │   ├── okrs.rs          # M1 OKR 查询 list_okrs（可按 quarter 过滤，排序 quarter DESC→P0 在前）
        │   ├── reminders.rs     # M2 到期提醒 ensure_reminders（幂等生成）+ fire_due_reminders（发桌面通知 + 标 fired）
        │   ├── note_move.rs     # M1 移动/重命名 move_note / rename_note + apply_ref_updates（路径型引用用户授权后批量更新）
        │   ├── settings.rs      # M4 AI 设置 get_ai_settings / set_ai_settings（存 app_data_dir/config.json，Unix 0600）+ ai_generations 缓存读写
        │   ├── ai.rs            # M4 AI 教练 ai_mainline / ai_coach / ai_tomorrow + update_tomorrow_sentence（降级链：LLM→启发式→缓存→空态）
        │   ├── search.rs        # 全库搜索 search_notes（FTS5）
        │   ├── scaffold.rs      # 脚手架 scaffold_vault（新建 Life OS 骨架 + 12 种 type 填写引导模板）
        │   ├── life_state.rs    # Agent 状态导出 export_life_state（写 app_data_dir/agent/）
        │   └── update.rs        # 自动更新 check_update（tauri-plugin-updater）
        ├── models/              # DTO（与 SQLite schema 对齐，供 IPC 序列化）
        │   ├── mod.rs
        │   ├── vault.rs
        │   ├── note.rs          # Note / NoteMeta（轻量，无正文）/ NoteContent（含 HTML）/ SearchResult（FTS 命中）/ Backlink / GraphData
        │   ├── task.rs / event.rs / project.rs / okr.rs / reminder.rs
        │   ├── ai.rs            # AiSettings（key 不入 vault 不入 git）/ AiMainline（含 source=ai|heuristic）/ AiGeneration
        │   ├── note_move.rs     # 移动/重命名 + RefLoc（路径型引用命中位置）
        │   ├── life_state.rs
        │   └── scaffold.rs
        ├── services/            # 服务层
        │   ├── mod.rs
        │   ├── database.rs      # Database（统一访问 + schema 初始化）
        │   ├── database_sqlite.rs  # SqliteDatabase（rusqlite 封装，WAL/Mutex）
        │   ├── contract/        # 结构契约（取代旧 layers.rs）
        │   │   └── mod.rs       # 规范.md 契约：顶层目录 / 12 种 type（含 log）/ type→dir / infer_note_type / infer_layer
        │   ├── ai/              # M4 AI 抽象层（provider 切换零业务改动）
        │   │   ├── mod.rs       # AiClient trait（Dyn-safe）+ AiError + complete_with_budget
        │   │   ├── client.rs    # build_client（未配 key→None）/ 30s 超时 / user 4k 截断
        │   │   └── providers/   # 具体 provider 实现（mod.rs / claude.rs / openai.rs，留 Ollama 扩展点）
        │   ├── watcher.rs       # notify 文件监听（驱动增量索引）
        │   └── indexer/         # 解析引擎（分层调度，纯解析不写库）
        │       ├── mod.rs       # parse_file：拼装 ParsedNote（含 content_hash）
        │       ├── frontmatter.rs
        │       ├── incremental.rs  # 增量索引（按 content_hash 判变）
        │       ├── projects.rs     # 项目维度解析（priority / mainline / top-3 兜底 / okr_priority / last_activity）
        │       ├── events.rs       # 关键事件 / 时间线 bullet 提取
        │       ├── tasks.rs        # 任务 + due_date（📅 / due: / 截止: / deadline）+ 标记三格式兼容
        │       ├── okrs.rs         # M1 OKR / KR section 提取（strategy/project 文档）
        │       ├── tomorrow.rs     # 明日一句提取
        │       ├── sections.rs     # section 切分
        │       └── wikilinks.rs    # [[wikilink]] 解析
        └── utils/
            ├── mod.rs
            ├── dates.rs         # 日期归一化 / ISO 周
            ├── exclude.rs       # 排除目录单一契约（EXCLUDE_DIRS + is_excluded_*）
            ├── hash.rs          # sha256 content_hash
            └── logging.rs
```

## Naming Conventions

### Files
- **Rust**：`snake_case.rs`（如 `library.rs`、`database_sqlite.rs`）。
- **React 组件**：`PascalCase.tsx`（如 `NoteView.tsx`）；组件同位样式 `PascalCase.css`（如 `Ribbon.css`）。
- **非组件 TS**：`camelCase.ts` 或 `index.ts`（如 `vault.ts`、`api/index.ts`）；单测同名 `.test.ts`。

### Code
- **Rust**：`snake_case` 函数/变量/模块；`PascalCase` 类型/结构体。命令函数用 `snake_case`（Tauri 自动转 camelCase 给前端）。
- **TypeScript**：`PascalCase` 接口/类型/组件；`camelCase` 变量/函数。
- **JSON/IPC 字段**：`snake_case`（对齐 Rust serde 默认，如 `rel_path`、`note_type`、`last_indexed`）。

### 注释语言
- **代码注释一律中文**（与现有代码库一致）。文档亦中文。

## Import Patterns

### Rust
- 模块树经 `mod.rs` 暴露；跨模块用 `crate::` 绝对路径（如 `crate::services::Database`、`crate::services::contract`、`crate::services::ai`、`crate::models::NoteMeta`、`crate::utils::exclude`）。
- 命令层依赖 `models` + `services` + `utils`，不跨命令文件互相依赖；`commands/ai.rs` 复用 `commands/settings.rs::read_ai_settings` 避免配置解析双拷贝漂移。

### TypeScript
- 顺序：外部依赖 → 相对路径模块 → 类型导入（`import type`）→ 样式。
- API 封装集中在 `api/index.ts`，页面/组件经 `import * as api from "../api"` 调用。
- 类型集中在 `types/index.ts`，与 Rust DTO 1:1 对齐。

## Code Structure Patterns

### Rust 命令文件（`commands/*.rs`）
1. 模块文档注释（职责）
2. `use` 导入（`crate::models::*` / `crate::services::Database` / `crate::services::contract` / `crate::utils::exclude` / `rusqlite::params` / `tauri::State`）
3. 内部辅助函数（如 `vault_root`、`row_to_*`、`*_inner` 纯函数核心逻辑——可绕过 Tauri State 直接集成测试）
4. `#[tauri::command]` 函数：参数 + `State<'_, Database>` → `Result<T, String>`
5. 错误统一 `.map_err(|e| e.to_string())?` 转成 String 给前端。
6. 复杂命令拆「`*_inner` 纯函数核心 + 命令壳」两层（见 `ai.rs` / `note_move.rs` / `okrs.rs` / `reminders.rs`），命令壳只解包 State/AppHandle 转调 inner，业务逻辑可单测。

### 前端工作台（`App.tsx` + `components/`）
- **Obsidian 式外壳**：`Ribbon`（左侧图标条）+ `FilePanel`（可拖拽宽的文件树，虚拟列表）+ `TabBar`（标签页）+ 内容区（按 `active.type` 分派 NoteView / 各 Page）+ `SidePanel`（可拖拽宽的反向/前向链接）+ `StatusBar`（底栏）+ `CommandPalette`（Ctrl/⌘+P）。
- **tab 驱动，非路由切换**：`stores/tabs` 管理打开的标签；`App.tsx` 的 `renderContent()` 按 `active.type`（note/graph/today/tasks/projects/calendar/journal/planner/settings）渲染。
- **三态统一**：列表页用 `DataState` 组件统一 loading/error/empty。
- **视图多态**：任务页（`components/tasks/`：kanban/list/matrix/timeline）、项目页（`components/projectViews/`：grid/list/owner/progress）由各自 store 切换。
- 组件顺序：hooks（useState/useEffect/useMemo）→ 早返回 → JSX。

## Module Boundaries

- **`commands` ↔ `services`/`models`/`utils`**：命令层只做"取参 → 调服务/查库 → 返回 DTO"，不写业务解析逻辑。
- **`services::contract`**：纯静态数据 + 纯函数（顶层目录 / type / type→dir / `infer_*`），不写库；是 `indexer` 与 `commands::scaffold` 的**单一真相源**。
- **`services::ai`**：只暴露 `AiClient` trait + `build_client` + `complete_with_budget`；业务命令（`commands/ai.rs`）只依赖 trait，provider 切换零改动；trait 只接聚合摘要字符串，绝不接 vault 原文。
- **`services/indexer`**：纯解析，不写库（写库在 `commands/index.rs`），便于单测与复用。
- **`commands::library` 的写回收口**：所有写 vault 操作（`save_note_content` / `save_note_body` / 行级 CRUD / `patch_frontmatter` / `set_tag` / `note_move::apply_ref_updates`）统一经 `save_note_content_inner` = 备份（`.helmose/backup`）+ 写盘 + 重索引，禁止自写 `fs::write`。
- **`utils::exclude`**：排除规则唯一定义点，`index.rs` / `library.rs` / `incremental.rs` 共用，禁止各处重抄。
- **前端 `api` ↔ `stores`/`pages`/`components`**：`api` 只封装 `invoke`；状态在 `stores`；页面/组件消费 store + api。
- **依赖方向**：单向，前端 → IPC → commands → services/models/utils；禁止反向。

## Code Size Guidelines
- 单文件聚焦单一职责；命令文件按领域拆分（vault/index/notes/library/tasks/projects/okrs/reminders/note_move/settings/ai/search/scaffold/life_state/update）。
- 组件文件控制在 ~300 行内；超过则拆子组件（CSS 同步拆同位 `.css`）。多视图（tasks/projectViews）按视图一文件拆分 + `shared.ts` 收口共享工具。
- 函数短小，命令函数内的 SQL + 映射逻辑尽量扁平；复杂业务拆 `*_inner` 纯函数 + 命令壳两层。

## Documentation Standards
- 关键决策与"为什么"写在代码注释或 steering 文档，不只写"是什么"。
- `#[cfg(test)] mod tests` 内嵌单元测试（见 `indexer/mod.rs`、`contract/mod.rs`、`utils/exclude.rs`、`commands/ai.rs`、`commands/note_move.rs`）。
- 每个新功能产出 `.spec-workflow/specs/<feature>/` 的 requirements/design/tasks。
