// ============================================================
// 数据库服务 - 统一访问层 + Schema 初始化
// 索引库与 vault 文件分离：SQLite 放 app_data_dir，是派生缓存（删了能重建）
// ============================================================

use super::SqliteDatabase;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
pub struct Database {
    sqlite: Arc<SqliteDatabase>,
    path: PathBuf,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        let path = db_path.clone();
        let sqlite = SqliteDatabase::new(db_path)
            .map_err(|e| format!("Failed to create database: {:?}", e))?;
        Ok(Self { sqlite: Arc::new(sqlite), path })
    }

    pub fn sqlite(&self) -> &SqliteDatabase {
        &self.sqlite
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// 初始化 schema（幂等，按 ; 拆分逐条执行）
    pub fn init_schema(&self) -> Result<(), String> {
        for stmt in SCHEMA.split(';') {
            let stmt = stmt.trim();
            if stmt.is_empty() {
                continue;
            }
            self.sqlite
                .execute(stmt, &[])
                .map_err(|e| format!("schema init failed: {:?} | sql: {}", e, &stmt[..stmt.len().min(80)]))?;
        }
        // 老库 migration（CREATE TABLE IF NOT EXISTS 不会给已存在的表加列）
        self.migrate()?;
        Ok(())
    }

    /// 幂等 migration：检查列是否存在，缺则 ALTER ADD COLUMN。新库 SCHEMA 自带列会跳过。
    fn migrate(&self) -> Result<(), String> {
        // events.source_line（inline-crud 新增，供事件就地编辑/删除定位原文行）
        let cols: Vec<String> = self
            .sqlite()
            .query_map("PRAGMA table_info(events)", &[], |r| r.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        if !cols.iter().any(|c| c == "source_line") {
            self.sqlite()
                .execute("ALTER TABLE events ADD COLUMN source_line INTEGER", &[])
                .map_err(|e| format!("migrate events.source_line failed: {:?}", e))?;
        }
        Ok(())
    }
}

/// 完整 Schema：vaults / notes / tasks / events / projects / okrs / entities
/// / links / tomorrow_sentences / life_state_snapshots + notes_fts(FTS5 trigram)
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_indexed TEXT,
  indexing_state TEXT NOT NULL DEFAULT 'idle',
  is_obsidian_shared INTEGER NOT NULL DEFAULT 0,
  exclude_patterns TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  title TEXT,
  note_type TEXT,
  layer INTEGER NOT NULL,
  date_iso TEXT,
  week_iso TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  frontmatter TEXT NOT NULL DEFAULT '{}',
  raw_content TEXT,
  mtime INTEGER NOT NULL,
  content_hash TEXT,
  UNIQUE(vault_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(note_type);
CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date_iso);
CREATE INDEX IF NOT EXISTS idx_notes_vault ON notes(vault_id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  vault_id TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  source TEXT NOT NULL,
  source_line INTEGER,
  project_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  vault_id TEXT NOT NULL,
  title TEXT,
  event_time TEXT,
  event_date TEXT,
  content TEXT,
  output TEXT,
  project_id TEXT,
  raw_bullet TEXT,
  source_line INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT,
  priority REAL,
  is_mainline INTEGER NOT NULL DEFAULT 0,
  okr_priority TEXT,
  home_rel_path TEXT,
  last_activity TEXT
);

CREATE TABLE IF NOT EXISTS okrs (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  quarter TEXT,
  objective TEXT NOT NULL,
  priority TEXT NOT NULL,
  kr_text TEXT,
  target_value TEXT,
  current_value TEXT,
  raw_row TEXT
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  name TEXT NOT NULL,
  entity_type TEXT,
  note_id TEXT REFERENCES notes(id),
  UNIQUE(vault_id, name)
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_text TEXT NOT NULL,
  target_note_id TEXT REFERENCES notes(id),
  alias TEXT,
  is_dangling INTEGER NOT NULL DEFAULT 0,
  link_type TEXT
);
CREATE INDEX IF NOT EXISTS idx_links_src ON links(source_note_id);
CREATE INDEX IF NOT EXISTS idx_links_tgt ON links(target_note_id);

CREATE TABLE IF NOT EXISTS tomorrow_sentences (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  vault_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  sentence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS life_state_snapshots (
  date_iso TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  mainline_project TEXT,
  sideline_projects TEXT NOT NULL DEFAULT '[]',
  today_focus TEXT,
  pending_tasks_count INTEGER,
  top_tasks TEXT NOT NULL DEFAULT '[]',
  okr_health TEXT,
  raw_md_path TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title, raw_content, tags,
  content='notes', content_rowid='rowid',
  tokenize='trigram'
);
"#;
