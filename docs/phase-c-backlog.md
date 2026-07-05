# Phase C 质量加固 backlog

> 2026-07-04。基于多代理 6 维度并行分析(6 agent / 423k tokens / 46 项候选,每项含文件:行号证据)。
> 标记:✅ 本轮已落地 / 📋 待做 / ❌ 不建议。优先级:P0 发布前 / P1 短期 / P2 长期。
> 范围:质量加固类;功能扩展(Agent inbox 写回 / events→project / 前向链接 dangling / AI 提醒可配置 / Ollama)仍留 CLAUDE.md backlog。

---

## 一、本轮已落地 ✅(17 项,客观裁判全绿)

### 安全 / 性能红线(P0)
1. ✅ **get_notes 去 raw_content**([notes.rs](../src-tauri/src/commands/notes.rs)) — SELECT 去全文列,row_to_note 给空串。消除"1.9 万×全文爆 IPC"潜在炸弹(性能红线)。单篇正文仍走 get_note_content。
2. ✅ **devtools 改 debug-only**([Cargo.toml](../src-tauri/Cargo.toml)) — 去掉 `features=["devtools"]`,release 不暴露 webview Inspector(防用户数据被读)。开发期 cfg(debug_assertions) 自动启用。
3. ✅ **panic hook**([logging.rs](../src-tauri/src/utils/logging.rs)) — 捕获 setup/run 期 `.expect` panic 转 `tracing::error`,否则用户侧"双击没反应"。未来 Sentry send_event 接入点。
4. ✅ **set_api_key 校验**([settings.rs](../src-tauri/src/commands/settings.rs)) — trim/空拒/长度>256 拒,防 IPC 绕过前端写超长串进 keyring。
5. ✅ **main.rs println → debug**(main.rs:38) — 防 release 经 stdout 泄露 db 绝对路径。

### 信息泄露
6. ✅ **export_life_state 去 root_path**([life_state.rs](../src-tauri/src/commands/life_state.rs)) — state.json 给外部 agent,移除宿主绝对路径(保留 id+name)。
7. ✅ **watcher 4 处日志改 debug + 脱敏**([watcher.rs](../src-tauri/src/services/watcher.rs)) — 监听启停/index 失败日志去 root/path 绝对路径,降 debug 级。
8. ✅ **index_vault 失败 eprintln → tracing::error**([index.rs](../src-tauri/src/commands/index.rs)) — 全量索引失败(用户最高感知)走统一日志 + `AppError::from(e)` 保 Db variant。

### 性能
9. ✅ **tasks/events 加索引**([database.rs](../src-tauri/src/services/database.rs)) — `idx_tasks_{vault,project,note}` + `idx_events_{vault,project}`。get_tasks/list_events/get_project_progress/ensure_reminders 的 `WHERE vault_id` 免全表扫。IF NOT EXISTS 老库 migrate 幂等。

### B14 错误码收尾
10. ✅ **incremental.rs:402 + vault.rs:147 `.map_err(|e| e.to_string())?` → 裸 `?`** — 让 `#[from] rusqlite::Error` 生效转 Db variant(纯改错无行为变)。

### 可维护性
11. ✅ **backup 路径抽 `backup_dir_of`**([library.rs](../src-tauri/src/commands/library.rs)) — save_note_content_inner/list_backups/delete_backup 三处统一。

### TS 严格性
12. ✅ **noImplicitOverride**([tsconfig.json](../frontend/tsconfig.json)) — ErrorBoundary `override state/componentDidCatch/render` + AppError `override toString`。注:`static getDerivedStateFromError` 不加(React.Component 未声明)。

### 构建
13. ✅ **chunkSizeWarningLimit:1500**([vite.config.ts](../frontend/vite.config.ts)) — 消除 antd 1.15MB 触发的 rollup 500KB 噪音警告(桌面本地加载可接受)。antd 按需瘦身见 §二 P2。

### 测试覆盖
14. ✅ **extract_due_from_line / replace_or_append_due 纯函数测试**([tasks.rs](../src-tauri/src/services/indexer/tasks.rs)) — +2 测试,覆盖 📅/due:/截止: 三格式提取 + emoji 替换/文本替换/追加三分支写回(toggle 重复任务推进核心)。

### CI 门禁
15. ✅ **ci.yml clippy 门禁**([ci.yml](../.github/workflows/ci.yml)) — `cargo clippy --all-targets -- -D warnings`(B16-18)。fmt 门禁待 fmt 全量后加。
16. ✅ **clippy 清零**(B16-18) — 20+24 warning → 0。
17. ✅ **前端 localStorage 收口**(B15) — 10 处 → utils/safeLocalStorage。

**客观裁判**:cargo check 0 warning / cargo test **231 passed**(原 229 + 新 2)/ clippy 0 warning / pnpm build 成功。

---

## 二、待做 📋(按优先级)

### P0 · 发布前(均需用户产品决策)
- 📋 **updater pubkey/endpoints 配真实值**([tauri.conf.json:50](../src-tauri/tauri.conf.json)) — 现 `TODO_REPLACE_AT_RELEASE` 占位。需 `tauri signer generate` + 配 endpoints。**[需决策:发布源]**
- 📋 **macOS 签名/公证**([tauri.conf.json:30](../src-tauri/tauri.conf.json) bundle.macOS) — 未签名 .app 被 Gatekeeper 拦。需 Apple Developer 账号 + CI `APPLE_ID/PASSWORD/TEAM_ID`。**[需决策:是否申请账号]**
- 📋 **Sentry 错误上报**(前端 invoke + ErrorBoundary + Rust panic hook 三点) — 发布后排障现场。**[需决策:provider 选型 + 是否上报]**;脱敏:vault 路径→`<vault>`、raw_content/snippet 永不上报。

### P1 · 性能(M,低-中风险)
- 📋 **apply_global_passes O(P×N) 优化**([projects.rs:120](../src-tauri/src/services/indexer/projects.rs)) — last_activity_for 每 project 线性扫全库。建 `HashMap<parent_dir, max_mtime>` 一次 O(N) 预算,每 project O(1)。
- 📋 **should_reindex 全量 WalkDir 优化**([index.rs:446](../src-tauri/src/commands/index.rs)) — 每启启动扫 1.9 万文件。方案:vaults 表加 `md_count` 列,先比计数差异超阈值才扫盘。
- 📋 **incremental upsert projects HashMap 缓存**([incremental.rs:310](../src-tauri/src/services/indexer/incremental.rs)) — 单笔记 `#project:名` 逐条查 → 事务开头一次查全 vault 建 HashMap。S effort。
- 📋 **get_graph_data SQL 聚合**([library.rs:1745](../src-tauri/src/commands/library.rs)) — 全量拉 links 内存再截断 → SQL GROUP BY COUNT 取 top N + 二次查边。或加 `LIMIT 5000` 兜底。

### P1 · 可观测性(M,低风险,发布排障基础)
- 📋 **logging.rs 升级 env filter + 可选文件 sink**([logging.rs](../src-tauri/src/utils/logging.rs)) — 现 7 行默认 fmt,无 EnvFilter/无 `helmose.log` 落盘。加 `with_env_filter` + release appender 写 `app_data_dir/logs/`。Sentry 前置。
- 📋 **前端 logger 抽象**([frontend/src/utils/logger.ts](../frontend/src/utils/logger.ts) 新建) — 收口 13 文件 24 处 `console.*`。ErrorBoundary 接 `logger.error` + 预留 `captureException(sentry)` 钩子。
- 📋 **indexer/database 补 tracing**(index.rs/incremental.rs/database.rs) — 18/21 核心模块零 tracing。优先 `index_vault_inner` 起止 + incremental 文件级失败 warn(聚合防刷)。

### P1 · 发布安全(med risk,需回归)
- 📋 **withGlobalTauri 关闭**([tauri.conf.json:25](../src-tauri/tauri.conf.json)) — release 暴露 `window.__TAURI__`(XSS 可直调写 vault 命令)。grep 确认无直读后关。**[med risk]**
- 📋 **capabilities fs:default 收紧**([capabilities/default.json:11](../src-tauri/capabilities/default.json)) — fs plugin 权限偏宽。前端未直接用 plugin-fs,可改最小权限或移除。**[med risk]**
- 📋 **CSP connect-src 对齐**([tauri.conf.json:27](../src-tauri/tauri.conf.json)) — 配 updater endpoint / Ollama 时校准白名单。

### P1 · 静默吞错收尾(**改行为需决策**)
- 📋 **NoteView/FilePanel/CommandPalette 静默吞 → notifyError** — 核心数据加载失败(笔记正文/反链/目录树/搜索)从"空数据/永久 Spin"改"toast 提示"。**[需决策:改 UI 行为]**

### P1/P2 · 测试覆盖(加测试,低风险)
- 📋 **AI cached 降级分支测试**([ai.rs:256](../src-tauri/src/commands/ai.rs)) — heuristic 空 → 读 ai_generations 缓存 → source='cached' 分支零覆盖。
- 📋 **ensure_reminders 幂等测试**([reminders.rs](../src-tauri/src/commands/reminders.rs)) — 抽 `ensure_reminders_inner` 纯函数 + 测首次 N/二次 0/非法 due 跳过。
- 📋 **ErrorBoundary 前端测试**([ErrorBoundary.tsx](../frontend/src/components/ErrorBoundary.tsx)) — @testing-library/react 测 children 渲染 + 抛错 fallback + 重试。需确认 testing-library 已装。
- 📋 **apply_ref_updates 负向测试**([note_move.rs:426](../src-tauri/src/commands/note_move.rs)) — 行漂移保护分支无负向测试。setup ref.md + 改盘第3行模拟用户编辑。
- 📋 **watcher process_events 排除/改名测试**([watcher.rs:241](../src-tauri/src/services/watcher.rs)) — 排除目录事件跳过 + md 改名(旧删+新增)场景。
- 📋 **PlannerPage 四象限拖拽纯函数测试**([PlannerPage.tsx:226](../frontend/src/pages/PlannerPage.tsx)) — 抽 `computeQuadWriteback` 纯函数 + 5 组合测试(Blocker #1 方案 B 核心)。

### P2 · TS 严格性
- 📋 **noUncheckedIndexedAccess**([tsconfig.json](../frontend/tsconfig.json)) — 核心 TS 项,16 文件 / ~50 处。ForceGraph 仿真 13 处 `nodes[i]` 改 `const n=nodes[i]; if(!n) continue;`;Map.entries 解构替 entry[0]。**建议独立分支**(改动面大)。L effort。
- 📋 **exactOptionalPropertyTypes**([tsconfig.json](../frontend/tsconfig.json)) — 估 <5 报错,先开看。`field?: T` 区分缺省 vs undefined。

### P2 · 可维护性
- 📋 **library.rs 10+ `ok_or_else(|| format!("not found"))` → `AppError::not_found`** — 现 From<String> 丢 NotFound variant,前端 notifyError 当系统错。med risk(改 code 影响分流)。
- 📋 **upsert_rel 336 行巨函数拆分**([incremental.rs:71](../src-tauri/src/services/indexer/incremental.rs)) — 抽 `rebuild_tasks/links/projects/events/okrs(&Transaction)` 私有函数。纯重构。L effort。
- 📋 **魔法字符串收口**(library.rs `todo/doing/done`/`helmose/obsidian` + SettingsPage) — 抽常量。M effort。
- 📋 **main.rs setup `.expect` → Result** — 启动 panic 改 Tauri 报错弹窗(panic hook 已捕获,此项进阶)。

### P2 · 性能(L,大改动)
- 📋 **get_tags_stats 索引期预算**([notes.rs:86](../src-tauri/src/commands/notes.rs)) — 现 1.9 万行 tags JSON 全量拉内存。建 `tag_counts` 表索引期维护。
- 📋 **TasksPage/CalendarPage 虚拟化** — 500 条任务/事件清单直渲。改 antd List virtual(FilePanel 同模式)。M effort。
- 📋 **antd 按需引入核查** — 1.15MB 单 chunk 疑似全量打包。核查 `from 'antd'` 裸 import + babel-plugin-import 配置。

### ❌ 不建议做
- ❌ **noPropertyAccessFromIndexSignature** — 代码库无索引签名类型,开启 0 收益。

---

## 三、待用户决策清单(发布前阻塞)
1. **updater**:发布源(GitHub Releases / 自建)?
2. **macOS 签名**:是否申请 Apple Developer 账号?
3. **Sentry**:provider + 是否上报(脱敏后)?
4. **静默吞 3 处**:核心数据加载失败改 toast(改 UI 行为)?
5. **noUncheckedIndexedAccess**:独立分支推进(改动面大)?
