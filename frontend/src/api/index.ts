// Tauri 命令封装（invoke）。Tauri v2 自动 camelCase↔snake_case 转换参数名。

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { AgentExport, Backlink, BackupInfo, Event, GraphData, IndexStats, Note, NoteContent, NoteMeta, Project, ScaffoldStats, SearchResult, TagCount, Task, UpdateStatus, Vault, VaultInput } from '../types';

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
  limit?: number
): Promise<Task[]> {
  return invoke<Task[]>('get_tasks', {
    vaultId,
    done: done ?? null,
    limit: limit ?? null,
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

/** 保存笔记内容（写回 vault 原文 + 自动备份 + 增量重索引） */
export async function saveNoteContent(
  noteId: string,
  content: string
): Promise<NoteContent> {
  return invoke<NoteContent>('save_note_content', { noteId, content });
}

/** 切换任务完成态（改 checkbox [ ]↔[x] 写回 vault + 索引；source_line 1-based） */
export async function toggleTask(
  noteId: string,
  sourceLine: number,
  done: boolean
): Promise<NoteContent> {
  return invoke<NoteContent>('toggle_task', { noteId, sourceLine, done });
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

/** 查询事件（可按 event_date 区间 [from, to] 过滤，YYYY-MM-DD） */
export async function listEvents(
  vaultId: string,
  from?: string,
  to?: string
): Promise<Event[]> {
  return invoke<Event[]>('list_events', {
    vaultId,
    from: from ?? null,
    to: to ?? null,
  });
}
