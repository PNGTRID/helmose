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

        // M3：tasks 加 status / priority / urgency 三列；旧数据 done=1 反填 status='done'
        let task_cols: Vec<String> = self
            .sqlite()
            .query_map("PRAGMA table_info(tasks)", &[], |r| r.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        if !task_cols.iter().any(|c| c == "status") {
            self.sqlite()
                .execute(
                    "ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'",
                    &[],
                )
                .map_err(|e| format!("migrate tasks.status failed: {:?}", e))?;
        }
        if !task_cols.iter().any(|c| c == "priority") {
            self.sqlite()
                .execute(
                    "ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
                    &[],
                )
                .map_err(|e| format!("migrate tasks.priority failed: {:?}", e))?;
        }
        if !task_cols.iter().any(|c| c == "urgency") {
            self.sqlite()
                .execute(
                    "ALTER TABLE tasks ADD COLUMN urgency TEXT NOT NULL DEFAULT 'low'",
                    &[],
                )
                .map_err(|e| format!("migrate tasks.urgency failed: {:?}", e))?;
        }
        // done=1 反填 status='done'（幂等：只在新增 status 列那次跑过即可，多次执行也无副作用）
        self.sqlite()
            .execute("UPDATE tasks SET status='done' WHERE done=1 AND status<>'done'", &[])
            .map_err(|e| format!("migrate tasks backfill status failed: {:?}", e))?;

        // M5：projects 加 owner 列
        let proj_cols: Vec<String> = self
            .sqlite()
            .query_map("PRAGMA table_info(projects)", &[], |r| r.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        if !proj_cols.iter().any(|c| c == "owner") {
            self.sqlite()
                .execute("ALTER TABLE projects ADD COLUMN owner TEXT", &[])
                .map_err(|e| format!("migrate projects.owner failed: {:?}", e))?;
        }

        // M2：tasks 加 repeat_rule / parent_task_id 两列（重复任务 + 子任务嵌套）。
        // 新库 SCHEMA 自带两列（下方 CREATE TABLE），此处只给老库 ALTER；幂等：列已存在则跳过。
        let task_cols2: Vec<String> = self
            .sqlite()
            .query_map("PRAGMA table_info(tasks)", &[], |r| r.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        if !task_cols2.iter().any(|c| c == "repeat_rule") {
            self.sqlite()
                .execute("ALTER TABLE tasks ADD COLUMN repeat_rule TEXT", &[])
                .map_err(|e| format!("migrate tasks.repeat_rule failed: {:?}", e))?;
        }
        if !task_cols2.iter().any(|c| c == "parent_task_id") {
            self.sqlite()
                .execute("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT", &[])
                .map_err(|e| format!("migrate tasks.parent_task_id failed: {:?}", e))?;
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
  completed_at TEXT,
  -- M3：状态/优先级/紧急度（新库自带；旧库由 migrate() ALTER 补）
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 0,
  urgency TEXT NOT NULL DEFAULT 'low',
  -- M2：重复规则（如 "day"/"week"/"month"/"Mon"-"Sun"）+ 父任务 id（子任务缩进指向）
  repeat_rule TEXT,
  parent_task_id TEXT
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
  last_activity TEXT,
  -- M5：负责人（新库自带；旧库由 migrate() ALTER 补）
  owner TEXT
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

-- M2：到期提醒（应用运行时轮询 + 桌面通知）。
-- 冗余 task_text/due_date：发通知时免 join；fired=0/1 控制只发一次。
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  fired INTEGER NOT NULL DEFAULT 0,
  task_text TEXT NOT NULL,
  due_date TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_at ON reminders(remind_at);

-- M4：AI 生成结果缓存（省 token + 防重复调用）。
-- UNIQUE(vault_id, date_iso, feature)：同日同 feature 重复生成 → upsert 覆盖。
-- feature ∈ {"mainline", "coach", "tomorrow"}。
CREATE TABLE IF NOT EXISTS ai_generations (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  feature TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(vault_id, date_iso, feature)
);
"#;
