# Project Structure · {{projectName}}

> 本模板为 Helmose 项目定制版（覆盖 `templates/structure-template.md`）。
> 这是 steering 文档，定义目录结构与编码规范，是 spec 写作的对齐基准。

## Directory Organization

```
helmose/
├── src-tauri/                    # Rust 后端（Tauri v2）
│   └── src/
│       ├── main.rs               # 入口 + invoke_handler 注册所有命令
│       ├── commands/             # IPC 命令层（按领域拆分，#[tauri::command]）
│       │   ├── mod.rs            #   pub mod 暴露各领域
│       │   ├── vault.rs          #   vault 注册/onboarding
│       │   ├── index.rs          #   全量/增量索引
│       │   ├── library.rs        #   文档库浏览（list_dirs/list_notes_meta/get_note_content）
│       │   ├── scaffold.rs       #   脚手架（新建 vault 骨架）
│       │   └── ...               #   其他领域（projects/events/tasks 等）
│       ├── services/             # 业务/解析层（commands 调它）
│       │   ├── contract/mod.rs   #   ★ 结构契约单一真相源（目录/type/映射）
│       │   ├── indexer/          #   索引器（纯解析不写库）
│       │   ├── database_sqlite.rs#   SQLite 派生缓存实现
│       │   └── utils/exclude.rs  #   ★ 排除规则单一契约（EXCLUDE_DIRS）
│       ├── models/               # DTO（#[derive(Serialize)]，snake_case）
│       └── utils/                # 工具函数（dates/hash 等）
├── frontend/                     # React 前端
│   └── src/
│       ├── App.tsx               # 外壳（Ribbon/布局）
│       ├── pages/                # 页面（Today/Library/Graph/Calendar/Tasks/Projects/Journal/Settings）
│       ├── components/           # 组件（FilePanel/NoteEditor/CommandPalette/SidePanel/...）
│       ├── stores/               # Zustand 状态（tabs/vault/theme）
│       ├── api/index.ts          # ★ IPC 封装集中点（invoke 调用）
│       ├── types/index.ts        # ★ TS 类型集中点（snake_case 对齐 Rust serde）
│       └── utils/                # 前端工具（date/note）
├── .spec-workflow/               # spec-workflow 资产（specs/steering/templates）
└── CLAUDE.md                     # AI 协作指令（铁律摘要）
```

## Naming Conventions

### Files
- **Rust 模块**：`snake_case.rs`（如 `database_sqlite.rs`）。
- **React 组件**：`PascalCase.tsx`（如 `FilePanel.tsx`）。
- **React 页面/store/util**：`PascalCase.tsx` / `camelCase.ts`（如 `tabs.ts`）。

### Code
- **Rust 命令/函数**：`snake_case`（如 `list_notes_meta`）。
- **Rust DTO 字段**：`snake_case`（serde 默认，**IPC 返回保持 snake_case**）。
- **TS 类型/接口**：`PascalCase`；TS 变量/函数 `camelCase`。
- **常量**：`UPPER_SNAKE_CASE`（如 `TOP_LEVEL_DIRS`、`EXCLUDE_DIRS`）。
- **测试名**：Helmose 风格用**中文**（如 `空目录生成完整骨架()`、`已有_vault_拒绝()`）。

## Import Patterns

- **Rust**：跨模块用 `crate::` 绝对路径（如 `crate::services::contract`）；模块经 `mod.rs` `pub mod` 暴露。
- **前端**：类型集中 `types/index.ts`；API 集中 `api/index.ts`（`invoke` 封装）。

## Code Structure Patterns

### Rust 命令标准流程（新增命令）
1. `models/` 加 DTO（`#[derive(Serialize)]`，snake_case）。
2. `commands/<领域>.rs` 写 `#[tauri::command] fn xxx(...) -> Result<T, String>`，`State<'_, Database>` 取库，涉及 note_type/目录复用 `services::contract`。
3. `commands/mod.rs` 加 `pub mod <领域>;`。
4. `main.rs` 的 `invoke_handler!` 注册。
5. `frontend/src/types/index.ts` + `api/index.ts` 对齐。
6. 跑 `cargo check` + `pnpm build` 全绿。

### React 页面模式
hooks → 早返回 → JSX；类型进 `types/index.ts`；IPC 进 `api/index.ts`；注释中文。

## Module Boundaries（架构铁律）

1. **vault 唯一真相源**：SQLite 是派生缓存，删库可从 vault 全量重建。
2. **vault 原文只读**：写 vault 必须「用户动作 + `.helmose/backup/` 备份」。
3. **IPC 边界**：参数名 `camelCase ↔ snake_case` 自动转；**返回值 JSON 字段保持 snake_case**，前端 TS 对齐（`rel_path`/`note_type`/`last_indexed`）。
4. **分层解析契约驱动**：`services/contract/mod.rs` 是目录/type/映射唯一契约点；新增 vault 目录改 `contract::TYPE_DIR_PAIRS`/`TOP_LEVEL_DIRS`。
5. **排除目录单一契约**：`utils/exclude.rs` 是唯一排除规则定义点，`commands/index.rs`/`library.rs`/`indexer/incremental.rs` 共用。

## Code Size Guidelines
- 单文件聚焦一个领域；超 ~400 行考虑按子领域拆分（如 indexer 按 frontmatter/incremental/tasks/events 拆）。
- Rust 命令文件按领域独立（一领域一文件）。

## Documentation Standards
- **代码注释一律中文**（与现有代码库一致）。
- 文件顶部用 `// ===` 分隔块注释说明模块职责。
- 危险/铁律操作在注释里标 **★** 或「铁律」。
