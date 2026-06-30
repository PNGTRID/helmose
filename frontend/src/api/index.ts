// Tauri 命令封装（invoke）。Tauri v2 自动 camelCase↔snake_case 转换参数名。

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { AgentExport, Backlink, GraphData, IndexStats, Note, NoteContent, NoteMeta, Project, ScaffoldStats, SearchResult, TagCount, Task, Vault, VaultInput } from '../types';

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

/** 反向链接：哪些笔记链接了本笔记 */
export async function getBacklinks(noteId: string): Promise<Backlink[]> {
  return invoke<Backlink[]>('get_backlinks', { noteId });
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

/** 查询项目（可按 status 筛选） */
export async function getProjects(vaultId: string, status?: string): Promise<Project[]> {
  return invoke<Project[]>('get_projects', { vaultId, status: status ?? null });
}
