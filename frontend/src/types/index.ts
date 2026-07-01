// 前端类型 —— 严格对齐 Rust src/models/* 的 serde 序列化（snake_case）

export type IndexingState = 'idle' | 'scanning' | 'parsing' | 'error';

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

/** 反向链接：源笔记 + 链接文本 */
export interface Backlink {
  source: NoteMeta;
  target_text: string;
  alias: string | null;
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
