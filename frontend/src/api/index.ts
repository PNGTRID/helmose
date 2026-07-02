// Tauri 命令封装（invoke）。Tauri v2 自动 camelCase↔snake_case 转换参数名。

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getMarkingStyle } from '../stores/markingStyle';
import type { AgentExport, AiCoachResult, AiMainline, AiSettings, AiTomorrowResult, Backlink, BackupInfo, Event, GraphData, IndexStats, MoveResult, Note, NoteContent, NoteMeta, Okr, Project, ProjectProgress, RefLoc, Reminder, ScaffoldStats, SearchResult, TagCount, Task, UpdateStatus, Vault, VaultInput } from '../types';

export async function ping(): Promise<string> {
  return invoke<string>('ping');
}

export async function addVault(input: VaultInput): Promise<Vault> {
  return invoke<Vault>('add_vault', { input });
}

export async function listVaults(): Promise<Vault[]> {
  return invoke<Vault[]>('list_vaults');
}

export async function getDefaultVault(): Promise<Vault | null> {
  return invoke<Vault | null>('get_default_vault');
}

export async function deleteVault(vaultId: string): Promise<void> {
  await invoke<void>('delete_vault', { vaultId });
}

/** 重置 Helmose：清派生缓存（SQLite 全表 + app_data/agent 导出），移除 vault 注册，不碰 vault 原文。
 *  重置后前端 load() → getDefaultVault 返回 null → 回 Onboarding。 */
export async function resetApp(): Promise<void> {
  await invoke<void>('reset_app');
}

export async function indexVault(vaultId: string): Promise<IndexStats> {
  return invoke<IndexStats>('index_vault', { vaultId });
}

/** 脚手架：在空目录生成知识库骨架（00~09 目录 + 11 种 type 模板 + 根目录文件） */
export async function scaffoldVault(targetPath: string): Promise<ScaffoldStats> {
  return invoke<ScaffoldStats>('scaffold_vault', { targetPath });
}

export async function getNotes(
  vaultId: string,
  noteType?: string,
  limit?: number
): Promise<Note[]> {
  return invoke<Note[]>('get_notes', {
    vaultId,
    noteType: noteType ?? null,
    limit: limit ?? null,
  });
}

export async function getNotesStats(
  vaultId: string
): Promise<Record<string, number>> {
  return invoke<Record<string, number>>('get_notes_stats', { vaultId });
}

export async function getTasks(
  vaultId: string,
  done?: boolean,
  limit?: number,
  /** M3：状态精确筛选（'todo' | 'doing' | 'done'） */
  status?: string,
  /** M3：按项目 ID 精确筛选 */
  projectId?: string,
  /** M3：优先级下限（>= priorityMin） */
  priorityMin?: number
): Promise<Task[]> {
  return invoke<Task[]>('get_tasks', {
    vaultId,
    done: done ?? null,
    limit: limit ?? null,
    status: status ?? null,
    projectId: projectId ?? null,
    priorityMin: priorityMin ?? null,
  });
}

/** 打开文件夹选择对话框，返回选中路径或 null */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath,
  });
  return typeof selected === 'string' ? selected : null;
}

// ============================================================
// 文档库（Obsidian 式浏览）：目录树 / 列表 / 单篇预览
// 列表只取元数据（无正文），单篇才取全文 —— 1.9 万文件不爆 IPC
// ============================================================

/** 列出 vault 所有目录（相对路径扁平数组，"" = 根），供前端构建文件树 */
export async function listDirs(vaultId: string): Promise<string[]> {
  return invoke<string[]>('list_dirs', { vaultId });
}

/** 列出某目录「直接子」的笔记元数据。dirPrefix 省略/空串 = vault 根 */
export async function listNotesMeta(
  vaultId: string,
  dirPrefix?: string,
  limit?: number
): Promise<NoteMeta[]> {
  return invoke<NoteMeta[]>('list_notes_meta', {
    vaultId,
    dirPrefix: dirPrefix ?? null,
    limit: limit ?? null,
  });
}

/** 列出 vault 所有笔记元数据（无正文），前端一次性构建完整目录+文件树 */
export async function listAllNotesMeta(vaultId: string): Promise<NoteMeta[]> {
  return invoke<NoteMeta[]>('list_all_notes_meta', { vaultId });
}

/** 按标签精确筛选笔记（tags JSON 数组含该 tag 元素，非 FTS 全文搜） */
export async function listNotesByTag(
  vaultId: string,
  tag: string,
  limit?: number
): Promise<NoteMeta[]> {
  return invoke<NoteMeta[]>('list_notes_by_tag', {
    vaultId,
    tag,
    limit: limit ?? null,
  });
}

/** 取单篇笔记正文 + 渲染后的 HTML（预览用） */
export async function getNoteContent(noteId: string): Promise<NoteContent> {
  return invoke<NoteContent>('get_note_content', { noteId });
}

// ============================================================
// 全库搜索（FTS5 trigram，支持中文短语）
// ============================================================

/** 全库搜索笔记（跨目录）。返回元数据 + 高亮片段，不含全文 */
export async function searchNotes(
  vaultId: string,
  query: string,
  limit?: number
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('search_notes', {
    vaultId,
    query,
    limit: limit ?? null,
  });
}

// ============================================================
// Agent 状态导出（聚合 vault 状态 → app_data_dir/agent）
// ============================================================

/** 导出 Agent 状态（LIFE-STATE.md + state.json），返回写出路径 + 摘要 */
export async function exportLifeState(vaultId: string): Promise<AgentExport> {
  return invoke<AgentExport>('export_life_state', { vaultId });
}

// ============================================================
// Obsidian 式能力：编辑 / 反向链接 / 图谱 / 标签 / 文件监听
// ============================================================

/** 保存笔记内容（写回 vault 原文 + 自动备份 + 增量重索引）。
 *  注意：content 会原样写盘，含 fm 才保留 fm；WYSIWYG 编辑正文应改用 saveNoteBody。 */
export async function saveNoteContent(
  noteId: string,
  content: string
): Promise<NoteContent> {
  return invoke<NoteContent>('save_note_content', { noteId, content });
}

/** 保存笔记正文（保留原 frontmatter）：读盘取原 fm → 拼接新正文 → 备份+写盘+索引。
 *  WYSIWYG 编辑器只编辑正文（raw_content 已去 fm），用此命令保存不会丢 fm。
 *  返回 NoteContent.raw_content = 正文（与 getNoteContent 一致）。 */
export async function saveNoteBody(
  noteId: string,
  body: string
): Promise<NoteContent> {
  return invoke<NoteContent>('save_note_body', { noteId, body });
}

/** 切换任务完成态（改 checkbox [ ]↔[x] 写回 vault + 索引；source_line 1-based） */
export async function toggleTask(
  noteId: string,
  sourceLine: number,
  done: boolean
): Promise<NoteContent> {
  return invoke<NoteContent>('toggle_task', { noteId, sourceLine, done });
}

/** 就地改写笔记某一行（task/event 文本编辑；sourceLine 1-based，基于去 fm 正文） */
export async function updateLine(
  noteId: string,
  sourceLine: number,
  newText: string
): Promise<NoteContent> {
  return invoke<NoteContent>('update_line', { noteId, sourceLine, newText });
}

/** 就地删除笔记某一行（task/event 单条删除；删前 save 已备份到 .helmose/backup） */
export async function deleteLine(
  noteId: string,
  sourceLine: number
): Promise<NoteContent> {
  return invoke<NoteContent>('delete_line', { noteId, sourceLine });
}

/** 在指定行（1-based 去fm正文行号）之后插入新行。
 *  子计划新增用：父任务行后插缩进 checkbox 子任务（indexer 按「最近非缩进父」归属）。 */
export async function insertLineAfter(
  noteId: string,
  afterLine: number,
  text: string
): Promise<NoteContent> {
  return invoke<NoteContent>('insert_line_after', { noteId, afterLine, text });
}

/** 向指定 section 末尾追加 bullet（asTask=true 任务 `- [ ]`，false 事件 `-`） */
export async function appendBullet(
  noteId: string,
  section: string,
  text: string,
  asTask: boolean
): Promise<NoteContent> {
  return invoke<NoteContent>('append_bullet', { noteId, section, text, asTask });
}

/** 改 frontmatter 指定键（value 支持 string/number/bool；保留其余原文不破坏） */
export async function patchFrontmatter(
  noteId: string,
  key: string,
  value: string | number | boolean
): Promise<NoteContent> {
  return invoke<NoteContent>('patch_frontmatter', { noteId, key, value });
}

/** 操作 frontmatter tags 数组（value=null 删除该前缀 tag；mainline 用 value===tagPrefix 表无值 tag） */
export async function setTag(
  noteId: string,
  tagPrefix: string,
  value: string | null
): Promise<NoteContent> {
  return invoke<NoteContent>('set_tag', { noteId, tagPrefix, value });
}

/** 删除笔记（软删除到 .helmose/trash 可恢复 + DB 级联清除），返回 trash 路径 */
export async function deleteNote(noteId: string): Promise<string> {
  return invoke<string>('delete_note', { noteId });
}

/** 创建新笔记（写 vault 原文 + 增量索引；用户按钮触发；不覆盖已存在、路径防穿越）。
 *  relPath 相对 vault 根。返回新笔记 NoteContent（含渲染 HTML + 新 note id）。 */
export async function createNote(
  vaultId: string,
  relPath: string,
  content: string
): Promise<NoteContent> {
  return invoke<NoteContent>('create_note', { vaultId, relPath, content });
}

/** 今日笔记（已存在则打开，无则用日志模板创建）。TodayPage 按钮 + Ctrl+J 快捷键共用。 */
export async function createTodayNote(vaultId: string): Promise<NoteContent> {
  return invoke<NoteContent>('create_today_note', { vaultId });
}

/** 反向链接：哪些笔记链接了本笔记 */
export async function getBacklinks(noteId: string): Promise<Backlink[]> {
  return invoke<Backlink[]>('get_backlinks', { noteId });
}

/** 前向链接：本笔记链接了哪些笔记（已解析的，不含 dangling） */
export async function getForwardLinks(noteId: string): Promise<Backlink[]> {
  return invoke<Backlink[]>('get_forward_links', { noteId });
}

/** 图谱数据（nodes + edges，按度数 top N 截断） */
export async function getGraphData(
  vaultId: string,
  limit?: number
): Promise<GraphData> {
  return invoke<GraphData>('get_graph_data', {
    vaultId,
    limit: limit ?? null,
  });
}

/** 全部标签计数（按次数倒序） */
export async function getTagsStats(vaultId: string): Promise<TagCount[]> {
  return invoke<TagCount[]>('get_tags_stats', { vaultId });
}

/** 启动文件监听（增量索引），幂等 */
export async function startWatcher(vaultId: string): Promise<void> {
  await invoke<void>('start_watcher', { vaultId });
}

/** 检测是否需要重新索引（磁盘 md 数 vs notes 数差异 >10%） */
export async function shouldReindex(vaultId: string): Promise<boolean> {
  return invoke<boolean>('should_reindex', { vaultId });
}

/** 检查应用更新（占位 endpoint 态返回「未配置更新源」友好状态） */
export async function checkUpdate(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>('check_update');
}

/** 列出 vault 的 .helmose/backup 下所有备份（按时间倒序） */
export async function listBackups(vaultId: string): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>('list_backups', { vaultId });
}

/** 删除单个备份（防穿越，只删 .helmose/backup/<name>） */
export async function deleteBackup(vaultId: string, name: string): Promise<void> {
  await invoke<void>('delete_backup', { vaultId, name });
}

/** 列出 .helmose/trash 下软删除的笔记 */
export async function listTrash(vaultId: string): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>('list_trash', { vaultId });
}

/** 清空 .helmose/trash（永久删除），返回清除数 */
export async function clearTrash(vaultId: string): Promise<number> {
  return invoke<number>('clear_trash', { vaultId });
}

/** 取某日的「明日一句」（前一日日志写下的次日寄语），无则 null */
export async function getTomorrowSentence(vaultId: string, dateIso: string): Promise<string | null> {
  return invoke<string | null>('get_tomorrow_sentence', { vaultId, dateIso });
}

/** 查询项目（可按 status / 主线 / 优先级 筛选；后端排序：主线置顶→priority→最近活跃） */
export async function getProjects(
  vaultId: string,
  status?: string,
  byMainline?: boolean,
  byPriority?: boolean
): Promise<Project[]> {
  return invoke<Project[]>('get_projects', {
    vaultId,
    status: status ?? null,
    byMainline: byMainline ?? null,
    byPriority: byPriority ?? null,
  });
}

// ============================================================
// M3 任务字段就地写入（status / priority / urgency）
// 三命令改 bullet 行内容写回 vault（备份+重索引），返回新 NoteContent。
// source_line==null（聚合 section 任务）不支持，后端会 Err。
// ============================================================

/** 改任务状态（todo/doing/done）。看板跨列拖拽 / 行内 status 切换触发。 */
export async function setTaskStatus(
  noteId: string,
  sourceLine: number,
  status: string
): Promise<NoteContent> {
  return invoke<NoteContent>('set_task_status', { noteId, sourceLine, status });
}

/** 改任务优先级（0-3，0=清空 ⭐）。四象限拖拽 / 行内 ⭐ 切换触发。 */
export async function setTaskPriority(
  noteId: string,
  sourceLine: number,
  priority: number
): Promise<NoteContent> {
  return invoke<NoteContent>('set_task_priority', { noteId, sourceLine, priority, markingStyle: getMarkingStyle() });
}

/** 改任务紧急度（'high' 加 🔥，其他删 🔥）。四象限拖拽 / 行内 🔥 切换触发。
 *  注：派生（按 due_date 推导）只在前端，本命令只对手动 🔥 增删。 */
export async function setTaskUrgency(
  noteId: string,
  sourceLine: number,
  urgency: string
): Promise<NoteContent> {
  return invoke<NoteContent>('set_task_urgency', { noteId, sourceLine, urgency, markingStyle: getMarkingStyle() });
}

// ============================================================
// M5 项目进度聚合（运行时聚合，不入 frontmatter）
// ============================================================

/** 取所有项目的进度（total/done/due_overdue）。ProjectsPage 进度视图触发。 */
export async function getProjectProgress(vaultId: string): Promise<ProjectProgress[]> {
  return invoke<ProjectProgress[]>('get_project_progress', { vaultId });
}

/** 查询事件（可按 event_date 区间 [from, to] 过滤、按 project_id 过滤） */
export async function listEvents(
  vaultId: string,
  from?: string,
  to?: string,
  projectId?: string
): Promise<Event[]> {
  return invoke<Event[]>('list_events', {
    vaultId,
    from: from ?? null,
    to: to ?? null,
    projectId: projectId ?? null,
  });
}

/** M1：查询 OKR（可按 quarter 过滤；排序 quarter DESC、priority P0 在前） */
export async function listOkrs(
  vaultId: string,
  quarter?: string
): Promise<Okr[]> {
  return invoke<Okr[]>('list_okrs', {
    vaultId,
    quarter: quarter ?? null,
  });
}

// ============================================================
// M2：到期提醒（ensure 扫 due 任务生成 + fire 到期发桌面通知）
// ============================================================

/** 扫 tasks 表 due_date 未来 N 天的未完成任务 → 生成 reminders（幂等：同 task_id 已存在跳过）。
 *  返回新生成的 reminder 数量。 */
export async function ensureReminders(vaultId: string): Promise<number> {
  return invoke<number>('ensure_reminders', { vaultId });
}

/** 查到期未发的 reminder → 发桌面通知 + 标 fired=1。返回本次触发数量。
 *  由 App.tsx 启动后 setInterval 60s 调用。 */
export async function fireDueReminders(): Promise<number> {
  return invoke<number>('fire_due_reminders');
}

/** 占位类型导出（前端如有 reminders 列表 UI 可用）。 */
export type { Reminder };

/** M1：移动笔记到目标目录（保持文件名）。索引层同步 + 返回路径型引用列表。 */
export async function moveNote(
  noteId: string,
  targetDir: string
): Promise<MoveResult> {
  return invoke<MoveResult>('move_note', { noteId, targetDir });
}

/** M1：重命名笔记（保持目录）。索引层同步 + 返回路径型引用列表。 */
export async function renameNote(
  noteId: string,
  newFileName: string
): Promise<MoveResult> {
  return invoke<MoveResult>('rename_note', { noteId, newFileName });
}

/** M1：应用路径型引用更新（move 后用户授权改其他笔记原文，返回更新的笔记数） */
export async function applyRefUpdates(
  refLocations: RefLoc[]
): Promise<number> {
  return invoke<number>('apply_ref_updates', { refLocations });
}

// ============================================================
// M4：AI 教练层（命令封装，对齐后端 snake_case）
// ============================================================

/** 读 AI 设置（api_key 在返回值里，仅前端设置页用） */
export async function getAiSettings(): Promise<AiSettings> {
  return invoke<AiSettings>('get_ai_settings');
}

/** 写 AI 设置（合并到 config.json 的 ai 子对象，保留其他字段） */
export async function setAiSettings(settings: AiSettings): Promise<AiSettings> {
  return invoke<AiSettings>('set_ai_settings', { settings });
}

/** AI 主线判定（未配 key 自动走启发式，source 标降级） */
export async function aiMainline(vaultId: string): Promise<AiMainline> {
  return invoke<AiMainline>('ai_mainline', { vaultId });
}

/** AI 每日教练建议（未配 key 自动走启发式，source 标降级） */
export async function aiCoach(vaultId: string): Promise<AiCoachResult> {
  return invoke<AiCoachResult>('ai_coach', { vaultId });
}

/** AI 明日一句（写回当日笔记「明日一句」section；未配 key 走启发式） */
export async function aiTomorrow(vaultId: string): Promise<AiTomorrowResult> {
  return invoke<AiTomorrowResult>('ai_tomorrow', { vaultId });
}

/** 编辑明日一句后写回（后端在「明日一句」section 内 update_line / append_bullet 收口：
 *  备份 + 重索引；前端不再处理文本，避免无 section 约束的全局 replaceFirst 误伤）。 */
export async function updateTomorrowSentence(
  noteId: string,
  newSentence: string
): Promise<AiTomorrowResult> {
  return invoke<AiTomorrowResult>('update_tomorrow_sentence', { noteId, newSentence });
}
