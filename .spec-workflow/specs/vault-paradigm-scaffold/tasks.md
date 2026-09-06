# Tasks Document · vault-paradigm-scaffold（契约地基 + note-id + 脚手架）

> 性质：把 vault-paradigm 总纲的**阶段 0A + 0B + 1** 落地。Rust 后端为主（task 1-5），前端接脚手架（task 6），task 7 全量裁判。
> 执行顺序：契约模块（1）→ layers 改造（2）→ note-id hash（3）→ 脚手架（4）→ EXCLUDE 对齐（5）→ 前端（6）→ 裁判（7）。1 是 2/4 的依赖；2 和 3 都改 parse_file（先 2 后 3，不冲突）；6 依赖 4。
> 验证：每个 Rust task 跑 `cd src-tauri && cargo check` + `cargo test`；前端 task 跑 `cd frontend && npm run build`；task 7 全量三件套。
> 铁律：**绝不改 `~/wiki` vault 原文**（task 1-3/5 纯只读索引侧）；task 4 脚手架只对**空目录**写（新建 vault 豁免），绝不碰已有 vault。

- [x] 1. 契约模块 `services/contract/`
  - File: `src-tauri/src/services/contract/mod.rs`（新建）、`src-tauri/src/services/mod.rs`（加 `pub mod contract;`）
  - 内置规范.md 契约：`TOP_LEVEL_DIRS`（00~09）、`NOTE_TYPES`（11 种）、`type_to_dir`（11 条 type→目录映射）、`infer_note_type(rel_path, fm_type)`（判定优先级：fm_type∈11 种 → 用；否则按 rel_path 最长前缀匹配 type_to_dir 反查；否则 None）、`infer_layer(note_type)`（type→L1/L2/L3，None→L2）
  - Purpose: 契约单一真相源，结束 layers.rs 靠猜（Req 1.1）
  - _Leverage: `~/wiki/规范.md` 映射表（已内置到 design）、待取代的 layers.rs_
  - _Requirements: 1.1, 1.2, 1.3_
  - _Prompt: Implement the task for spec vault-paradigm-scaffold, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Rust 系统程序员 | Task: 新建 `src-tauri/src/services/contract/mod.rs`，按 design Component 1 内置规范.md 契约——`TOP_LEVEL_DIRS` 为 00_收件箱..09_核心知识库（10 个）、`NOTE_TYPES` 为 profile/person/project/strategy/book/course/tool/method/experience/comparison/query（11 种）、`type_to_dir` 严格按 design 的 type→存放目录表（profile→05_/、person→04_.../核心人脉网络/、project→01_/、strategy→01_.../运营策略/、book→06_.../系统学习记录/书籍/、course→06_.../系统学习记录/课程/、tool→06_.../工具与模板库/、method→09_.../方法论/、experience→05_.../经历/、comparison→06_.../市场情报/、query→09_/）、`infer_note_type`（fm_type∈11 种→用；否则取 type_to_dir 中是 rel_path 前缀的最长 dir 对应 type；否则 None）、`infer_layer`（L1=project/strategy/profile/person，L2=book/course/tool/method/comparison，L3=experience/query，None→2）；在 `services/mod.rs` 加 `pub mod contract;`；写单测覆盖 11 种 frontmatter type 判定 + 各目录反查（含最长前缀区分，如 01_.../运营策略/x.md→strategy 而非 project、06_.../市场情报/x.md→comparison）+ 无匹配降级 + layer 映射 | Restrictions: 纯静态数据 + 纯函数，无外部依赖；本任务不改 layers.rs（task 2 改）；不写库；映射严格按 design 表，不自创 | Success: contract 模块编译通过，单测全过，cargo check + cargo test 绿。完成后把本任务 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 2. `layers.rs` 改造（契约驱动 + 删旧编号私货）
  - File: `src-tauri/src/services/indexer/layers.rs`、`src-tauri/src/services/indexer/mod.rs`
  - `type_of`/`layer_of` 改为转调 contract 的 `infer_note_type`/`infer_layer`（parse_file 把 frontmatter.type 传入）；删除所有旧编号硬编码（0-日志/1-我/2-业务/5-经历/4-工具与效率/3-学习/2-创作）+ 私货（1-我/张三→profile）；更新 layers.rs 与 indexer/mod.rs 内嵌 tests 为新体系样本
  - Purpose: 索引按契约判定 note_type/layer（Req 1.2/1.3/1.4）
  - _Leverage: `services/contract/`、indexer/mod.rs::parse_file、layers.rs_
  - _Requirements: 1.2, 1.3, 1.4_
  - _Prompt: Implement the task for spec vault-paradigm-scaffold, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Rust 索引器开发 | Task: 把 `layers.rs::type_of`/`layer_of` 改为转调 `crate::services::contract::{infer_note_type, infer_layer}`——parse_file 处先取 frontmatter.type（用 `fm.data.get("type").as_str()`）连同 rel_path 传给 infer_note_type，layer 用 infer_layer(note_type)；删除 layers.rs 里全部旧编号硬编码与 1-我/张三 私货（layers.rs 可退化为对 contract 的薄 re-export 或保留空壳转调）；更新 layers.rs 内嵌 tests（layer_classification/type_classification）与 indexer/mod.rs 的 parses_l1_experience/parses_l3_log 样本为新体系——experience 经 frontmatter.type 判定（layer=L3），无 frontmatter 的旧 0-日志 路径降级为 note_type=None/layer=L2，相应改断言 | Restrictions: indexer 继续纯解析不写库；保留容错（无匹配 type→None/L2 不报错）；不引入新依赖；index_real_wiki_smoke 必须仍跑通（HELMOSE_TEST_VAULT 默认 ~/wiki） | Success: layers.rs 无旧编号/私货，note_type/layer 全由契约驱动，cargo check + cargo test 绿（含 smoke 不崩）。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 3. content hash 稳定 note id
  - File: `src-tauri/Cargo.toml`（加 `sha2 = "0.10"`）、`src-tauri/src/services/indexer/mod.rs`（content_hash 函数 + parse_file 填值）、`src-tauri/src/commands/index.rs`（id 用 hash + 碰撞消歧）、`src-tauri/src/services/indexer/incremental.rs`（适配 hash id）
  - content_hash(body)：去 BOM → LF 统一（`\r\n`/`\r`→`\n`）→ 去每行 trailing 空白 → 去首尾空白 → sha256 hex；parse_file 填 `Some(content_hash(&fm.content))`；index.rs note id 由 uuid 改为 content_hash（同 vault 内 hash 已被别的 rel_path 占用时，id 加 `#` 与 rel_path 短哈希消歧，content_hash 列仍存纯 hash）；incremental 同步用 hash id
  - Purpose: note id 稳定化，移动不变（Req 2）
  - _Leverage: frontmatter.rs 的 fm.content（已去 frontmatter 正文）、index.rs::index_vault 事务（DELETE 级联自然迁移外键）_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - _Prompt: Implement the task for spec vault-paradigm-scaffold, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Rust 后端开发 | Task: 按 design Component 3 实现 content hash 稳定 id——`Cargo.toml` 加 `sha2 = "0.10"`；在 indexer/mod.rs（或 utils/hash.rs）加 `pub fn content_hash(body: &str) -> String`（规范化：去 BOM → 把 `\r\n` 与 `\r` 统一为 `\n` → 去每行末尾空白 → 去整体首尾空白 → sha256 hex 小写）；parse_file 的 content_hash 字段从 None 改为 `Some(content_hash(&fm.content))`；index.rs 的 index_vault 内 note id 从 `uuid::Uuid::new_v4()` 改为 `p.content_hash.clone()`，并加碰撞消歧——同 vault 内若该 content_hash 已被别的 rel_path 占用，id 用「纯 hash + # + rel_path 短哈希」拼接（举例 `format!` 调用见 design），`notes.content_hash` 列始终存纯 hash；incremental.rs 的 upsert_rel 同步用 content_hash 作 id（与全量一致，读 incremental.rs 后对齐）；单测覆盖规范化稳定性（CRLF/LF 同结果、trailing space 同结果、BOM 同结果、内容微调必变）+ 碰撞消歧后缀 | Restrictions: 无 DDL（notes.content_hash 列已存在）；hash 在 parse_file 算一次缓存，查询不重算；外键靠全量 DELETE 的 ON DELETE CASCADE 自然迁移，无迁移脚本；不碰 vault 原文 | Success: notes.id 为 content_hash、content_hash 列实填，碰撞不崩，cargo check + cargo test 绿（smoke 对真实 vault 不崩）。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 4. 脚手架命令 `commands/scaffold.rs`
  - File: `src-tauri/src/commands/scaffold.rs`（新建）、`src-tauri/src/models/`（加 ScaffoldStats）、`src-tauri/src/commands/mod.rs`（加 `pub mod scaffold;`）、`src-tauri/src/main.rs`（invoke_handler 注册 `scaffold_vault`）
  - 新建 Tauri 命令 scaffold_vault，签名 `(target_path: String, db: State) -> Result<ScaffoldStats, String>`（db 参数带生命周期，参见现有命令写法）：target 不存在→创建；存在且非空→检测是否已有 vault（含 .md 或 00~09 任一目录→已有，返回错误引导索引；非空非 vault→返回错误拒绝）；空目录→mkdir 00~09 + 生成 11 种 type 模板（放 type_to_dir 目录，frontmatter 占位 + 引导）+ 根目录 规范.md/目录.md/README.md 通用模板；返回 ScaffoldStats
  - Purpose: 新用户安装即生成规范结构（Req 3）
  - _Leverage: `services/contract/`（TOP_LEVEL_DIRS/type_to_dir）、vault.rs::default_excludes 思路_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Prompt: Implement the task for spec vault-paradigm-scaffold, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Rust Tauri 命令开发 | Task: 按 design Component 4 新建 `commands/scaffold.rs`，实现 scaffold_vault 命令——参照现有命令（如 vault.rs::add_vault）的 `#[tauri::command]` + `State<'_, Database>` 写法，参数 target_path: String，返回 `Result<ScaffoldStats, String>`。逻辑：①解析 target_path：不存在→`fs::create_dir_all`；存在且非空→扫描是否含 .md 文件或 00~09 任一顶层目录，若是→返回错误「检测到已有 vault，请用打开/索引」，非空且非 vault→返回错误「目标目录非空，拒绝铺文件」；②空目录 mkdir 00~09（contract::TOP_LEVEL_DIRS）；③生成 11 种 type 模板 md（frontmatter 占位 title/created/updated/type/tags/sources + 一行引导文字），每个放 contract::type_to_dir(t) 指定目录；④根目录生成 规范.md/目录.md/README.md 通用模板（通用骨架，无白墨工厂/抖店等私有业务内容）；⑤返回 ScaffoldStats（字段 root_path、dirs_created=10、templates_created=11、root_files_created=3）；在 models 加 ScaffoldStats（带 Serialize，snake_case），commands/mod.rs 加 `pub mod scaffold;`，main.rs invoke_handler 注册 scaffold_vault；单测用临时目录覆盖空目录生成（验证 10 目录+11 模板+3 根文件）+ 非空拒绝 + 已有 vault 拒绝 | Restrictions: 仅对空目录写（新建 vault 豁免，无需备份），绝不碰非空/已有 vault（铁律）；模板通用无私有业务内容；不引入新依赖（用 `std::env::temp_dir` 手工构造临时目录即可，无需 tempfile） | Success: scaffold_vault 注册可用，空目录生成完整骨架，拒绝场景正确，cargo check + cargo test 绿。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 5. EXCLUDE_DIRS 对齐 + 消除漂移
  - File: `src-tauri/src/commands/index.rs`、`src-tauri/src/commands/library.rs`（+ 可选共享常量位置）
  - 确认 EXCLUDE_DIRS（当前为 6-原始资料、专家团）的组件名匹配在新体系仍生效（6-原始资料现处 08_档案库/原始资料/、专家团现处 04_关系与社群资产/，组件名不变）；把 index.rs 与 library.rs 两处重复的 EXCLUDE_DIRS 提取为**单一定义点**（如 `utils/exclude.rs` 或 contract），两文件 import，补注释说明新体系位置
  - Purpose: 排除目录一致性（铁律 5，Req 4）
  - _Leverage: index.rs 与 library.rs 的 EXCLUDE_DIRS/is_excluded_
  - _Requirements: 4.1, 4.2_
  - _Prompt: Implement the task for spec vault-paradigm-scaffold, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Rust 重构 | Task: 按 design Component 5 处理 EXCLUDE_DIRS——先确认组件名匹配在新体系下对 6-原始资料（现 08_档案库/原始资料/6-原始资料/）与 专家团（现 04_关系与社群资产/专家团/）仍正确排除（is_excluded 遍历路径任一组件名，组件名不变→仍生效）；把 index.rs 与 library.rs 各自重复定义的 EXCLUDE_DIRS 常量提取为单一定义点（建议新建 `src-tauri/src/utils/exclude.rs`，暴露 EXCLUDE_DIRS 常量与 is_excluded 函数，两命令文件改为从该模块 import），消除两处漂移；补注释说明两个目录的新体系位置；隐藏目录（以 . 开头）排除保留 | Restrictions: 不改排除行为（保持现状正确），只消除重复定义 + 加注释；index.rs 与 library.rs MUST 一致（架构铁律 5）；不引入新依赖 | Success: EXCLUDE_DIRS 单一定义点，两视图排除行为一致不变，cargo check + cargo test 绿。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 6. 前端 onboarding 接入脚手架
  - File: `frontend/src/pages/OnboardingPage.tsx`、`frontend/src/api/index.ts`、`frontend/src/types/index.ts`
  - types/index.ts 加 ScaffoldStats（对齐 Rust，snake_case）；api/index.ts 加 scaffoldVault(targetPath) 封装 invoke 调 scaffold_vault 命令；OnboardingPage 加「创建我的知识库」入口（选目录 → scaffoldVault → 现有 add_vault + index_vault 流程 → 进主界面；失败/拒绝 message.error），与「打开已有 vault」并列
  - Purpose: 前端落地脚手架（Req 3 前端侧）
  - _Leverage: api/index.ts invoke 模式、OnboardingPage.tsx 现有 add_vault/index_vault 流程_
  - _Requirements: 3.1, 3.3_
  - _Prompt: Implement the task for spec vault-paradigm-scaffold, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React/TypeScript 前端 | Task: types/index.ts 加 ScaffoldStats 接口（字段 root_path、dirs_created、templates_created、root_files_created，snake_case 对齐 Rust）；api/index.ts 加 scaffoldVault(targetPath) 函数，内部 invoke 调用 scaffold_vault 命令并传 targetPath；OnboardingPage 加「创建我的知识库」入口——用 @tauri-apps/plugin-dialog 的 open 选目录（directory 模式）→ 调 scaffoldVault → 成功后走现有 addVault+indexVault 流程进主界面，scaffold 失败/非空拒绝用 antd message.error 显示后端错误信息；与现有「打开已有 vault」入口并列展示 | Restrictions: 不改现有打开 vault 流程；IPC 字段 snake_case 对齐；不引入新前端依赖（dialog 插件已就绪）；遵循 hooks→早返回→JSX 与中文注释约定 | Success: npm run build（tsc -b + vite build）绿，「创建我的知识库」入口类型正确可渲染。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

- [x] 7. 客观裁判全绿 + 行为验证
  - `cd src-tauri && cargo check`（0 error）、`cd src-tauri && cargo test`（含 index_real_wiki_smoke 对 ~/wiki）、`cd frontend && npm run build`
  - 重点验证：①smoke 对真实 1.9 万 vault 不崩且解析 notes 大于 100；②（若 npm run tauri:dev 手跑）projects 看板不再全空（type=project 正确判定）、note id 稳定为 hash；③脚手架命令可调
  - Purpose: 验证无回归（全部 Req）
  - _Leverage: CLAUDE.md 验证命令_
  - _Requirements: All_
  - _Prompt: Implement the task for spec vault-paradigm-scaffold, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Engineer | Task: 跑客观裁判三件套（cd src-tauri 然后 cargo check / cargo test；cd frontend 然后 npm run build）确认全绿且无回归；重点核对：index_real_wiki_smoke 对 ~/wiki（或 HELMOSE_TEST_VAULT）不崩且解析笔记数大于 100、type=project 笔记能被正确判定（projects 不再全空）、notes.id 为 content_hash、content_hash 列实填；若手跑 tauri:dev 再核对脚手架「创建知识库」可用 | Restrictions: 不为通过裁判而改业务逻辑；发现回归立即回退到对应 task 修复并重跑 | Success: 三件套全绿，重点核对项通过，无回归。完成后 [ ]→[-]→[x] 并用 log-implementation 记录_

## 未列入本期（backlog）
- 契约与已有 vault `规范.md` 的自动同步 / 校验命令（design 开放决策 1，留后续 spec）
- note id 增量 watcher 移动感知（留阶段 3 引用完整性子 spec）
- hash 碰撞的副本语义精细化（留阶段 3）
- `~/wiki` 旧编号残留目录的迁移建议（本 spec 只兼容不阻塞，不主动重组）
