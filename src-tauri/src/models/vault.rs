use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IndexingState {
    Idle,
    Scanning,
    Parsing,
    Error,
}

/// Vault：用户选择的本地 md 文件夹（Obsidian 式）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vault {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: String,
    pub last_indexed: Option<String>,
    pub indexing_state: IndexingState,
    pub is_obsidian_shared: bool,
    pub exclude_patterns: Vec<String>,
}

/// 创建 vault 的输入（onboarding 时用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultInput {
    pub name: String,
    pub root_path: String,
    pub is_obsidian_shared: bool,
}
