// ============================================================
// 数据模型（DTO）—— 与 SQLite schema 对齐，供前端 invoke 序列化
// ============================================================

pub mod event;
pub mod life_state;
pub mod note;
pub mod project;
pub mod scaffold;
pub mod task;
pub mod vault;

pub use event::Event;
pub use life_state::AgentExport;
pub use note::{Backlink, GraphData, GraphEdge, GraphNode, Note, NoteContent, NoteMeta, SearchResult};
pub use project::Project;
pub use scaffold::ScaffoldStats;
pub use task::Task;
pub use vault::{IndexingState, Vault, VaultInput};
