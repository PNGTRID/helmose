# Project Structure

## Directory Organization

```
helmose/
├── README.md                    # 项目简介 + 开发命令
├── CLAUDE.md                    # 项目级 AI 协作指令（架构铁律/规范/性能红线）
├── package.json                 # 根（占位，实际依赖在 frontend/）
├── .spec-workflow/              # spec-workflow 规范体系
│   ├── steering/                # 长期生效的项目级文档（product/tech/structure）
│   ├── specs/                   # 各功能的 spec（requirements/design/tasks）
│   └── templates/               # 文档模板
├── frontend/                    # React + TypeScript 前端（vite 构建）
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx             # 入口
│       ├── App.tsx              # 根组件：Layout + 侧边栏菜单 + 路由
│       ├── index.css            # 全局样式 + markdown 预览样式
│       ├── api/index.ts         # Tauri 命令封装（invoke）
│       ├── stores/vault.ts      # Zustand：当前 vault + 索引状态
│       ├── types/index.ts       # TS 类型（严格对齐 Rust serde，snake_case）
│       └── pages/
│           ├── OnboardingPage.tsx   # 选/建 vault 引导
│           ├── TodayPage.tsx        # 今日聚焦（统计 + 待办）
│           ├── LibraryPage.tsx      # 文档库（Obsidian 式三栏浏览）
│           ├── SettingsPage.tsx     # vault 管理
│           └── Placeholder.tsx      # 占位页（日历/日志/项目/收件箱）
└── src-tauri/                   # Rust 后端（Tauri v2）
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json    # Tauri 权限
    └── src/
        ├── main.rs              # 入口：插件注册 + invoke_handler 命令注册
        ├── commands/            # Tauri 命令层（IPC 边界）
        │   ├── mod.rs
        │   ├── vault.rs         # vault CRUD / onboarding
        │   ├── index.rs         # 全量索引 index_vault
        │   ├── notes.rs         # 笔记查询 get_notes / get_notes_stats
        │   ├── tasks.rs         # 任务查询 get_tasks
        │   └── library.rs       # 文档库：list_dirs / list_notes_meta / get_note_content
        ├── models/              # DTO（与 SQLite schema 对齐，供 IPC 序列化）
        │   ├── mod.rs
        │   ├── vault.rs
        │   ├── note.rs          # Note / NoteMeta（轻量）/ NoteContent（含 HTML）
        │   ├── task.rs
        │   ├── event.rs
        │   └── project.rs
        ├── services/            # 服务层
        │   ├── mod.rs
        │   ├── database.rs      # Database（统一访问 + schema 初始化）
        │   ├── database_sqlite.rs  # SqliteDatabase（rusqlite 封装，WAL/Mutex）
        │   └── indexer/         # 解析引擎（分层调度）
        │       ├── mod.rs       # parse_file：拼装 ParsedNote
        │       ├── frontmatter.rs
        │       ├── layers.rs    # 分层判定（L1/L2/L3 + note_type，按路径前缀）
        │       ├── sections.rs
        │       ├── tasks.rs
        │       └── wikilinks.rs
        └── utils/
            ├── mod.rs
            ├── dates.rs         # 日期归一化 / ISO 周
            └── logging.rs
```

## Naming Conventions

### Files
- **Rust**：`snake_case.rs`（如 `library.rs`、`database_sqlite.rs`）。
- **React 组件**：`PascalCase.tsx`（如 `LibraryPage.tsx`）。
- **非组件 TS**：`camelCase.ts` 或 `index.ts`（如 `vault.ts`、`api/index.ts`）。

### Code
- **Rust**：`snake_case` 函数/变量/模块；`PascalCase` 类型/结构体。命令函数用 `snake_case`（Tauri 自动转 camelCase 给前端）。
- **TypeScript**：`PascalCase` 接口/类型/组件；`camelCase` 变量/函数。
- **JSON/IPC 字段**：`snake_case`（对齐 Rust serde 默认，如 `rel_path`、`note_type`、`last_indexed`）。

### 注释语言
- **代码注释一律中文**（与现有代码库一致）。文档亦中文。

## Import Patterns

### Rust
- 模块树经 `mod.rs` 暴露；跨模块用 `crate::` 绝对路径（如 `crate::services::Database`、`crate::models::NoteMeta`）。
- 命令层依赖 `models` + `services`，不跨命令文件互相依赖。

### TypeScript
- 顺序：外部依赖 → 相对路径模块 → 类型导入（`import type`）→ 样式。
- API 封装集中在 `api/index.ts`，页面经 `import * as api from "../api"` 调用。
- 类型集中在 `types/index.ts`，与 Rust DTO 1:1 对齐。

## Code Structure Patterns

### Rust 命令文件（`commands/*.rs`）
1. 模块文档注释（职责）
2. `use` 导入（`crate::models::*` / `crate::services::Database` / `rusqlite::params` / `tauri::State`）
3. 内部辅助函数（如 `vault_root`、`row_to_*`、`is_excluded`）
4. `#[tauri::command]` 函数：参数 + `State<'_, Database>` → `Result<T, String>`
5. 错误统一 `.map_err(|e| e.to_string())?` 转成 String 给前端。

### React 页面（`pages/*.tsx`）
1. 顶部文档注释（页面职责 + 版本说明）
2. `import`（react → antd → 相对模块 → type）
3. 辅助函数（如 `buildTree`）
4. 默认导出组件：hooks（useState/useEffect/useMemo）→ 早返回 → JSX。

## Module Boundaries

- **`commands` ↔ `services`/`models`**：命令层只做"取参 → 调服务/查库 → 返回 DTO"，不写业务解析逻辑。
- **`services/indexer`**：纯解析，不写库（写库在 `commands/index.rs`），便于单测与复用。
- **前端 `api` ↔ `stores`/`pages`**：`api` 只封装 `invoke`；状态在 `stores`；页面消费 store + api。
- **依赖方向**：单向，前端 → IPC → commands → services/models；禁止反向。

## Code Size Guidelines
- 单文件聚焦单一职责；命令文件按领域拆分（vault/index/notes/tasks/library）。
- 页面文件控制在 ~300 行内；超过则拆子组件。
- 函数短小，命令函数内的 SQL + 映射逻辑尽量扁平。

## Documentation Standards
- 关键决策与"为什么"写在代码注释或 steering 文档，不只写"是什么"。
- `#[cfg(test)] mod tests` 内嵌单元测试（见 `indexer/mod.rs`、`layers.rs`）。
- 每个新功能产出 `.spec-workflow/specs/<feature>/` 的 requirements/design/tasks。
