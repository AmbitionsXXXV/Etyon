use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const INDEX_DIR_NAME: &str = ".etyon-snapshot";
pub const INDEX_SCHEMA_VERSION: u32 = 1;
pub const HASH_ALGORITHM: &str = "blake3";
pub const PREVIEW_CHAR_COUNT: usize = 4_000;
pub const CHUNK_CHAR_COUNT: usize = 2_000;

#[derive(Debug, Error)]
pub enum ProjectIndexError {
    #[error("failed to create index directory: {0}")]
    CreateDirectory(#[source] std::io::Error),
    #[error("failed to read project file: {0}")]
    ReadFile(#[source] std::io::Error),
    #[error("failed to write index file: {0}")]
    WriteFile(#[source] std::io::Error),
    #[error("failed to serialize index JSON: {0}")]
    Serialize(#[source] serde_json::Error),
    #[error("failed to read index JSON: {0}")]
    Deserialize(#[source] serde_json::Error),
    #[error("failed to walk project files: {0}")]
    Walk(#[source] ignore::Error),
    #[error("project index has not been initialized: {0}")]
    NotInitialized(PathBuf),
}

pub type ProjectIndexResult<T> = Result<T, ProjectIndexError>;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexConfig {
    pub chunk_char_count: usize,
    pub embedding_enabled: bool,
    pub ignore_patterns: Vec<String>,
    pub preview_char_count: usize,
    pub schema_version: u32,
}

impl Default for IndexConfig {
    fn default() -> Self {
        Self {
            chunk_char_count: CHUNK_CHAR_COUNT,
            embedding_enabled: false,
            ignore_patterns: vec![format!("{INDEX_DIR_NAME}/")],
            preview_char_count: PREVIEW_CHAR_COUNT,
            schema_version: INDEX_SCHEMA_VERSION,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexManifest {
    pub created_at: String,
    pub hash_algorithm: String,
    pub last_refreshed_at: Option<String>,
    pub producer: String,
    pub project_path: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileIndexEntry {
    pub hash: String,
    pub is_text: bool,
    pub language: Option<String>,
    pub mtime_ms: u128,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub chunk_count: usize,
    pub embedding_ref: Option<String>,
    pub embedding_state: Option<String>,
    pub hash: String,
    pub language: Option<String>,
    pub mtime_ms: u128,
    pub path: String,
    pub preview: String,
    pub relative_path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChunkRecord {
    pub chunk_id: String,
    pub end_byte: usize,
    pub hash: String,
    pub relative_path: String,
    pub start_byte: usize,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotStats {
    pub added: usize,
    pub deleted: usize,
    pub modified: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotHistoryEntry {
    pub id: String,
    pub message: String,
    pub parent_id: Option<String>,
    pub stats: SnapshotStats,
    pub timestamp: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPayload {
    pub id: String,
    pub index: std::collections::BTreeMap<String, FileIndexEntry>,
    pub message: String,
    pub parent_id: Option<String>,
    pub stats: SnapshotStats,
    pub timestamp: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    pub document_count: usize,
    pub indexed_file_count: usize,
    pub project_path: String,
    pub refreshed_at: String,
    pub snapshot_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub exists: bool,
    pub latest_snapshot_id: Option<String>,
    pub project_path: String,
    pub snapshot_count: usize,
}
