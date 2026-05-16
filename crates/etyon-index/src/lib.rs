mod gitignore;
mod model;
mod refresh;

pub use gitignore::ensure_project_index_gitignored;
pub use model::{
    ChunkRecord, DocumentRecord, FileIndexEntry, IndexConfig, IndexManifest, IndexStatus,
    ProjectIndexError, ProjectIndexResult, RefreshResult, SnapshotHistoryEntry,
};
pub use refresh::{init_project_index, read_project_index_status, refresh_project_index};
