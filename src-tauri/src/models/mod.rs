// ============================================================
// 数据模型（DTO）—— 与 SQLite schema 对齐，供前端 invoke 序列化
// ============================================================

pub mod ai;
pub mod error;
pub mod event;
pub mod life_state;
pub mod note;
pub mod note_move;
pub mod okr;
pub mod project;
pub mod reminder;
pub mod scaffold;
pub mod task;
pub mod vault;

pub use ai::{AiCoachResult, AiMainline, AiSettings, AiSettingsView, AiTomorrowResult};
pub use error::{AppError, AppResult};
pub use event::Event;
pub use life_state::AgentExport;
pub use note::{Backlink, GraphData, GraphEdge, GraphNode, Note, NoteContent, NoteMeta, SearchResult};
pub use note_move::{MigrateItem, MigratePlan, MigratePreview, MoveResult, RefLoc};
pub use okr::Okr;
pub use project::{Project, ProjectProgress};
pub use reminder::Reminder;
pub use scaffold::ScaffoldStats;
pub use task::Task;
pub use vault::{IndexingState, Vault, VaultInput};
