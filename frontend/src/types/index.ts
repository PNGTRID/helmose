// 前端类型 —— 严格对齐 Rust src/models/* 的 serde 序列化（snake_case）

export type IndexingState = 'idle' | 'scanning' | 'parsing' | 'error';

/** 后端 AppError 错误码（对齐 src-tauri/src/models/error.rs 的 variant 名）。
 *  后端返 Result<T, AppError>，AppError 经 IPC 序列化为 {code, message}。 */
export type AppErrorCode =
  | 'NotFound'
  | 'InvalidInput'
  | 'Conflict'
  | 'PreconditionFailed'
  | 'Db'
  | 'Io'
  | 'Serde'
  | 'Secrets'
  | 'Internal';

export interface Vault {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
  last_indexed: string | null;
  indexing_state: IndexingState;
  is_obsidian_shared: boolean;
  exclude_patterns: string[];
}

export interface VaultInput {
  name: string;
  root_path: string;
  is_obsidian_shared: boolean;
}

export interface Note {
  id: string;
  vault_id: string;
  rel_path: string;
  file_name: string;
  title: string | null;
  note_type: string | null;
  layer: number;
  date_iso: string | null;
  week_iso: string | null;
  tags: string[];
  frontmatter: Record<string, unknown>;
  raw_content: string;
  mtime: number;
  content_hash: string | null;
}

export interface Task {
  id: string;
  note_id: string;
  vault_id: string;
  text: string;
  done: boolean;
  due_date: string | null;
  source: string;
  source_line: number | null;
  project_id: string | null;
  created_at: string;
  completed_at: string | null;
  /** M3：状态（todo | doing | done）。done 是派生（status === 'done'）。 */
  status: string;
  /** M3：优先级 0-3（0=未设，⭐ 数 1-3）。 */
  priority: number;
  /** M3：紧急度（low | mid | high，🔥 = high）。派生（按 due_date 推导）只在前端。 */
  urgency: string;
  /** M2：重复规则（day/week/month/Mon-Sun）。null=非重复。 */
  repeat_rule: string | null;
  /** M2：父任务 id（缩进子任务指向最近非缩进父）。null=顶层任务。 */
  parent_task_id: string | null;
}

/** M2：到期提醒（对齐 reminders 表，snake_case） */
export interface Reminder {
  id: string;
  task_id: string;
  note_id: string;
  vault_id: string;
  /** 触发时间 ISO8601 */
  remind_at: string;
  fired: boolean;
  task_text: string;
  due_date: string | null;
  created_at: string;
}

export interface IndexStats {
  notes: number;
  tasks: number;
  wikilinks: number;
  dangling: number;
  elapsed_ms: number;
}

/** 笔记元数据（轻量，不含正文）—— 文档库列表/树用 */
export interface NoteMeta {
  id: string;
  rel_path: string;
  file_name: string;
  title: string | null;
  note_type: string | null;
  date_iso: string | null;
  tags: string[];
  mtime: number;
}

/** 单篇笔记内容（含渲染 HTML + frontmatter）—— 预览/编辑用 */
export interface NoteContent {
  id: string;
  rel_path: string;
  title: string | null;
  /** 笔记类型（字段表单按它分支） */
  note_type: string | null;
  /** tags 数组（字段表单读 status/mainline） */
  tags: string[];
  /** 原始 frontmatter（字段表单读 priority/okr/created） */
  frontmatter: Record<string, unknown>;
  /** 去 frontmatter 后的正文 */
  raw_content: string;
  html: string;
}

/** 全库搜索命中（FTS5）—— 元数据 + 高亮片段 + bm25 相关度，不含全文 */
export interface SearchResult {
  id: string;
  rel_path: string;
  file_name: string;
  title: string | null;
  note_type: string | null;
  date_iso: string | null;
  tags: string[];
  /** 命中片段，关键词用 <b> 高亮 */
  snippet: string;
  /** bm25 得分（越小越相关） */
  rank: number;
}

/** Agent 状态导出结果（写出路径 + 摘要） */
export interface AgentExport {
  md_path: string;
  json_path: string;
  date_iso: string;
  pending_tasks: number;
  total_notes: number;
}

/** 反向链接：源笔记 + 链接文本。
 *  同时复用为前向链接（source = 目标 note 元数据）。
 *  is_dangling：前向链接独有——target 解析不到笔记（[[不存在的笔记]]）时为 true，
 *  此时 source.id 为空、source.file_name 用 target_text 占位（前端按 is_dangling 渲染灰色「未解析」）。
 *  反向链接恒为 false（target = note_id 本身，必然已解析）。 */
export interface Backlink {
  source: NoteMeta;
  target_text: string;
  alias: string | null;
  is_dangling: boolean;
}

/** 图谱节点 */
export interface GraphNode {
  id: string;
  label: string;
  note_type: string | null;
}

/** 图谱边（source → target） */
export interface GraphEdge {
  source: string;
  target: string;
}

/** 图谱数据 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** 标签计数（[tag, count] 元组，对齐 Rust serde tuple 序列化） */
export type TagCount = [string, number];

/** 业务项目（frontmatter type:project） */
export interface Project {
  id: string;
  vault_id: string;
  note_id: string;
  name: string;
  status: string | null;
  priority: number | null;
  is_mainline: boolean;
  okr_priority: string | null;
  home_rel_path: string | null;
  last_activity: string | null;
  /** M5：负责人（frontmatter.owner，无则 null） */
  owner: string | null;
}

/** M5：项目进度聚合（运行时聚合，不入 frontmatter）。 */
export interface ProjectProgress {
  /** 项目 ID（projects.id） */
  project_id: string;
  /** 项目名（前端展示用） */
  name: string;
  /** 关联任务总数 */
  total: number;
  /** 已完成数（status === 'done'） */
  done: number;
  /** 逾期未完成数（due_date < 今天 且 status !== 'done'） */
  due_overdue: number;
}

/** 事件（笔记「关键事件 / 时间线」section 的 bullet） */
export interface Event {
  id: string;
  note_id: string;
  vault_id: string;
  title: string | null;
  /** HH:MM 或 HH:MM-HH:MM */
  event_time: string | null;
  /** YYYY-MM-DD（来自笔记 date_iso） */
  event_date: string | null;
  content: string | null;
  output: string | null;
  project_id: string | null;
  raw_bullet: string | null;
  /** bullet 在全文的行号（1-based），供就地编辑/删除定位 */
  source_line: number | null;
}

/** M1：OKR（strategy / project 文档的「关键结果」section 提取） */
export interface Okr {
  id: string;
  vault_id: string;
  source_note_id: string;
  /** 形如 2026Q3（来自 frontmatter.quarter 或 section 标题） */
  quarter: string | null;
  /** 目标 */
  objective: string;
  /** P0 / P1 / P2 / P3（缺省 P2） */
  priority: string;
  /** 关键结果 bullet 文本 */
  kr_text: string | null;
  /** 目标值（含可选单位「万千亿」字样） */
  target_value: string | null;
  /** 当前进度值 */
  current_value: string | null;
  /** 原始行内容（与 kr_text 同源） */
  raw_row: string | null;
}

/** M1：路径型引用位置（move_note 检测 / apply_ref_updates 入参） */
export interface RefLoc {
  /** 引用所在笔记的 id（待更新的文档） */
  note_id: string;
  /** 引用所在行号（1-based） */
  line: number;
  /** 旧路径（出现在原文里） */
  old_path: string;
  /** 新路径（替换目标） */
  new_path: string;
}

/** M1：移动/重命名笔记结果 */
export interface MoveResult {
  /** 移动后的 note id（content_hash 不变 → 通常不变） */
  note_id: string;
  /** 新相对路径 */
  new_rel_path: string;
  /** 旧相对路径 */
  old_rel_path: string;
  /** 检测到的路径型引用，需 apply_ref_updates 授权后改原文 */
  refs_to_update: RefLoc[];
}

/** 脚手架生成统计（onboarding「创建知识库」） */
export interface ScaffoldStats {
  root_path: string;
  dirs_created: number;
  templates_created: number;
  root_files_created: number;
}

/** 更新检查结果（check_update 命令） */
export interface UpdateStatus {
  available: boolean;
  version: string | null;
  message: string;
}

/** 备份文件信息（.helmose/backup/ 下） */
export interface BackupInfo {
  name: string;
  size: number;
  mtime: string;
}

// ============================================================
// M4：AI 教练层（types 对齐后端 snake_case DTO）
// ============================================================

/** AI 配置（对外视图，不含 key：key 走 setApiKey 单独命令，永不全量回读，防 XSS 窃取 + devtools 暴露） */
export interface AiSettings {
  /** "claude" | "openai"（未知 → build_client None，走降级） */
  provider: string;
  /** 是否已配置 API key（后端按 config.json 的 api_key 是否为空算，明文 key 不回前端） */
  has_key: boolean;
  /** 是否启用 AI（false → build_client None） */
  enabled: boolean;
}

/** AI 主线判定结果。source 标降级链：ai / heuristic / cached */
export interface AiMainline {
  project_name: string;
  reason: string;
  source: string;
}

/** AI 每日教练建议。source 标降级链：ai / heuristic / cached */
export interface AiCoachResult {
  text: string;
  source: string;
}

/** AI 明日一句结果（写回当日笔记「明日一句」section + tomorrow_sentences 表） */
export interface AiTomorrowResult {
  sentence: string;
  source: string;
  note_id: string;
}

/** 迁移计划项（migrate_task_markers 输入，前端算好目标 priority/urgency 传入；字段 snake_case 对齐后端） */
export interface MigratePlan {
  note_id: string;
  source_line: number;
  priority: number;
  urgency: string;
}

/** 单条迁移预览（before/after 行文本，dry-run 展示） */
export interface MigrateItem {
  note_id: string;
  rel_path: string;
  source_line: number;
  before: string;
  after: string;
}

/** 迁移预览/结果（applied 区分是否写盘） */
export interface MigratePreview {
  note_count: number;
  item_count: number;
  items: MigrateItem[];
  applied: boolean;
}
