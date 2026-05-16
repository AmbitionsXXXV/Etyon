use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use chrono::Utc;
use ignore::{DirEntry, WalkBuilder};

use crate::{
    gitignore::ensure_project_index_gitignored,
    model::{
        ChunkRecord, DocumentRecord, FileIndexEntry, HASH_ALGORITHM, INDEX_DIR_NAME,
        INDEX_SCHEMA_VERSION, IndexConfig, IndexManifest, IndexStatus, ProjectIndexError,
        ProjectIndexResult, RefreshResult, SnapshotHistoryEntry, SnapshotPayload, SnapshotStats,
    },
};

const PRODUCER: &str = "etyon-index/0.1.0";
const TEXT_EXTENSIONS: &[(&str, &str)] = &[
    ("cjs", "javascript"),
    ("css", "css"),
    ("cts", "typescript"),
    ("html", "html"),
    ("java", "java"),
    ("js", "javascript"),
    ("json", "json"),
    ("jsx", "javascriptreact"),
    ("markdown", "markdown"),
    ("md", "markdown"),
    ("mjs", "javascript"),
    ("mts", "typescript"),
    ("py", "python"),
    ("rs", "rust"),
    ("sh", "shell"),
    ("sql", "sql"),
    ("svg", "svg"),
    ("toml", "toml"),
    ("ts", "typescript"),
    ("tsx", "typescriptreact"),
    ("txt", "plaintext"),
    ("vue", "vue"),
    ("xml", "xml"),
    ("yaml", "yaml"),
    ("yml", "yaml"),
];

/// Creates the project index directory layout and returns the current status.
///
/// # Errors
///
/// Returns an error when the project index directory, manifest, or supporting
/// files cannot be created or read.
pub fn init_project_index(project_path: impl AsRef<Path>) -> ProjectIndexResult<IndexStatus> {
    let project_path = project_path
        .as_ref()
        .canonicalize()
        .unwrap_or_else(|_| project_path.as_ref().to_path_buf());
    ensure_project_index_gitignored(&project_path)?;
    ensure_layout(&project_path)?;

    Ok(read_project_index_status(project_path))
}

/// Rebuilds the project file index and writes a new snapshot.
///
/// # Errors
///
/// Returns an error when project files cannot be walked, read, serialized, or
/// written into `.etyon-snapshot`.
pub fn refresh_project_index(project_path: impl AsRef<Path>) -> ProjectIndexResult<RefreshResult> {
    let project_path = project_path
        .as_ref()
        .canonicalize()
        .unwrap_or_else(|_| project_path.as_ref().to_path_buf());
    ensure_project_index_gitignored(&project_path)?;
    ensure_layout(&project_path)?;

    let previous_index = read_index(&project_path).unwrap_or_default();
    let previous_history = read_history(&project_path).unwrap_or_default();
    let previous_entry = previous_history.last();
    let timestamp = Utc::now().to_rfc3339();
    let snapshot_id = create_snapshot_id(&timestamp);
    let mut index = BTreeMap::new();
    let mut documents = Vec::new();
    let mut chunks = Vec::new();

    for entry in collect_project_files(&project_path)? {
        let path = entry.path();
        let relative_path = relative_path(path, &project_path);
        let bytes = fs::read(path).map_err(ProjectIndexError::ReadFile)?;
        let hash = blake3::hash(&bytes).to_hex().to_string();
        let metadata = fs::metadata(path).map_err(ProjectIndexError::ReadFile)?;
        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_millis());
        let language = infer_language(path);
        let is_text = is_text_file(path, &bytes);

        index.insert(
            relative_path.clone(),
            FileIndexEntry {
                hash: hash.clone(),
                is_text,
                language: language.clone(),
                mtime_ms,
                size: metadata.len(),
            },
        );

        if !is_text {
            continue;
        }

        let text = normalize_text(&String::from_utf8_lossy(&bytes));
        let document_chunks = build_chunks(&relative_path, &text);
        let preview: String = text
            .chars()
            .take(IndexConfig::default().preview_char_count)
            .collect();

        documents.push(DocumentRecord {
            chunk_count: document_chunks.len(),
            embedding_ref: None,
            embedding_state: None,
            hash,
            language,
            mtime_ms,
            path: path.to_string_lossy().into_owned(),
            preview,
            relative_path,
            size: metadata.len(),
        });
        chunks.extend(document_chunks);
    }

    let stats = calculate_stats(&previous_index, &index);
    let entry = SnapshotHistoryEntry {
        id: snapshot_id.clone(),
        message: "refresh project index".to_string(),
        parent_id: previous_entry.map(|item| item.id.clone()),
        stats: stats.clone(),
        timestamp: timestamp.clone(),
    };
    let mut history = previous_history;
    history.push(entry.clone());
    let payload = SnapshotPayload {
        id: snapshot_id.clone(),
        index: index.clone(),
        message: entry.message,
        parent_id: entry.parent_id,
        stats,
        timestamp: timestamp.clone(),
    };

    write_json(index_path(&project_path), &index)?;
    write_json(history_path(&project_path), &history)?;
    write_json(snapshot_path(&project_path, &snapshot_id), &payload)?;
    write_json(documents_path(&project_path, &snapshot_id), &documents)?;
    write_chunks(chunks_path(&project_path, &snapshot_id), &chunks)?;
    update_manifest_refresh_time(&project_path, &timestamp)?;

    Ok(RefreshResult {
        document_count: documents.len(),
        indexed_file_count: index.len(),
        project_path: project_path.to_string_lossy().into_owned(),
        refreshed_at: timestamp,
        snapshot_id,
    })
}

/// Reads project index status without creating a new snapshot.
#[must_use]
pub fn read_project_index_status(project_path: impl AsRef<Path>) -> IndexStatus {
    let project_path = project_path.as_ref().to_path_buf();
    let index_dir = index_dir(&project_path);

    if !index_dir.exists() {
        return IndexStatus {
            exists: false,
            latest_snapshot_id: None,
            project_path: project_path.to_string_lossy().into_owned(),
            snapshot_count: 0,
        };
    }

    let history = read_history(&project_path).unwrap_or_default();

    IndexStatus {
        exists: true,
        latest_snapshot_id: history.last().map(|entry| entry.id.clone()),
        project_path: project_path.to_string_lossy().into_owned(),
        snapshot_count: history.len(),
    }
}

fn ensure_layout(project_path: &Path) -> ProjectIndexResult<()> {
    for directory in [
        index_dir(project_path),
        index_dir(project_path).join("snapshots"),
        index_dir(project_path).join("documents"),
        index_dir(project_path).join("chunks"),
        index_dir(project_path).join("embeddings"),
    ] {
        fs::create_dir_all(directory).map_err(ProjectIndexError::CreateDirectory)?;
    }

    if !config_path(project_path).exists() {
        write_json(config_path(project_path), &IndexConfig::default())?;
    }

    if !manifest_path(project_path).exists() {
        let now = Utc::now().to_rfc3339();
        write_json(
            manifest_path(project_path),
            &IndexManifest {
                created_at: now,
                hash_algorithm: HASH_ALGORITHM.to_string(),
                last_refreshed_at: None,
                producer: PRODUCER.to_string(),
                project_path: project_path.to_string_lossy().into_owned(),
                schema_version: INDEX_SCHEMA_VERSION,
            },
        )?;
    }

    if !history_path(project_path).exists() {
        write_json(
            history_path(project_path),
            &Vec::<SnapshotHistoryEntry>::new(),
        )?;
    }

    if !index_path(project_path).exists() {
        write_json(
            index_path(project_path),
            &BTreeMap::<String, FileIndexEntry>::new(),
        )?;
    }

    Ok(())
}

fn collect_project_files(project_path: &Path) -> ProjectIndexResult<Vec<DirEntry>> {
    let mut files = Vec::new();
    let walker = WalkBuilder::new(project_path)
        .standard_filters(true)
        .filter_entry(should_walk_entry)
        .build();

    for result in walker {
        let entry = result.map_err(ProjectIndexError::Walk)?;

        if entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            files.push(entry);
        }
    }

    files.sort_by(|left, right| left.path().cmp(right.path()));

    Ok(files)
}

fn should_walk_entry(entry: &DirEntry) -> bool {
    let Some(name) = entry.file_name().to_str() else {
        return true;
    };

    !matches!(name, INDEX_DIR_NAME | ".git" | "node_modules")
}

fn write_json(path: PathBuf, value: &impl serde::Serialize) -> ProjectIndexResult<()> {
    let json = serde_json::to_string_pretty(value).map_err(ProjectIndexError::Serialize)?;
    fs::write(path, json).map_err(ProjectIndexError::WriteFile)
}

fn read_json<T>(path: PathBuf) -> ProjectIndexResult<T>
where
    T: serde::de::DeserializeOwned,
{
    let raw = fs::read_to_string(path).map_err(ProjectIndexError::ReadFile)?;
    serde_json::from_str(&raw).map_err(ProjectIndexError::Deserialize)
}

fn write_chunks(path: PathBuf, chunks: &[ChunkRecord]) -> ProjectIndexResult<()> {
    let mut file = File::create(path).map_err(ProjectIndexError::WriteFile)?;

    for chunk in chunks {
        let line = serde_json::to_string(chunk).map_err(ProjectIndexError::Serialize)?;
        writeln!(file, "{line}").map_err(ProjectIndexError::WriteFile)?;
    }

    Ok(())
}

fn update_manifest_refresh_time(project_path: &Path, refreshed_at: &str) -> ProjectIndexResult<()> {
    let mut manifest: IndexManifest = read_json(manifest_path(project_path))?;
    manifest.last_refreshed_at = Some(refreshed_at.to_string());
    write_json(manifest_path(project_path), &manifest)
}

fn read_index(project_path: &Path) -> ProjectIndexResult<BTreeMap<String, FileIndexEntry>> {
    read_json(index_path(project_path))
}

fn read_history(project_path: &Path) -> ProjectIndexResult<Vec<SnapshotHistoryEntry>> {
    read_json(history_path(project_path))
}

fn calculate_stats(
    previous: &BTreeMap<String, FileIndexEntry>,
    current: &BTreeMap<String, FileIndexEntry>,
) -> SnapshotStats {
    let added = current
        .keys()
        .filter(|path| !previous.contains_key(*path))
        .count();
    let deleted = previous
        .keys()
        .filter(|path| !current.contains_key(*path))
        .count();
    let modified = current
        .iter()
        .filter(|(path, entry)| {
            previous
                .get(*path)
                .is_some_and(|previous_entry| previous_entry.hash != entry.hash)
        })
        .count();

    SnapshotStats {
        added,
        deleted,
        modified,
    }
}

fn build_chunks(relative_path: &str, text: &str) -> Vec<ChunkRecord> {
    let mut chunks = Vec::new();
    let mut start_byte = 0;
    let mut current_chars = 0;

    for (byte_index, _) in text.char_indices() {
        if current_chars < IndexConfig::default().chunk_char_count {
            current_chars += 1;
            continue;
        }

        push_chunk(&mut chunks, relative_path, text, start_byte, byte_index);
        start_byte = byte_index;
        current_chars = 0;
    }

    if start_byte < text.len() {
        push_chunk(&mut chunks, relative_path, text, start_byte, text.len());
    }

    chunks
}

fn push_chunk(
    chunks: &mut Vec<ChunkRecord>,
    relative_path: &str,
    text: &str,
    start_byte: usize,
    end_byte: usize,
) {
    let chunk_text = text[start_byte..end_byte].to_string();
    let hash = blake3::hash(chunk_text.as_bytes()).to_hex().to_string();

    chunks.push(ChunkRecord {
        chunk_id: format!("{relative_path}:{start_byte}:{end_byte}"),
        end_byte,
        hash,
        relative_path: relative_path.to_string(),
        start_byte,
        text: chunk_text,
    });
}

fn create_snapshot_id(timestamp: &str) -> String {
    blake3::hash(timestamp.as_bytes()).to_hex().to_string()[..16].to_string()
}

fn normalize_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\0', "")
        .trim()
        .to_string()
}

fn is_text_file(path: &Path, bytes: &[u8]) -> bool {
    infer_language(path).is_some() || !bytes.contains(&0)
}

fn infer_language(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_lowercase();
    TEXT_EXTENSIONS.iter().find_map(|(candidate, language)| {
        (*candidate == extension).then(|| (*language).to_string())
    })
}

fn relative_path(path: &Path, project_path: &Path) -> String {
    path.strip_prefix(project_path)
        .unwrap_or(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn index_dir(project_path: &Path) -> PathBuf {
    project_path.join(INDEX_DIR_NAME)
}

fn config_path(project_path: &Path) -> PathBuf {
    index_dir(project_path).join("config.json")
}

fn manifest_path(project_path: &Path) -> PathBuf {
    index_dir(project_path).join("manifest.json")
}

fn index_path(project_path: &Path) -> PathBuf {
    index_dir(project_path).join("index.json")
}

fn history_path(project_path: &Path) -> PathBuf {
    index_dir(project_path).join("history.json")
}

fn snapshot_path(project_path: &Path, snapshot_id: &str) -> PathBuf {
    index_dir(project_path)
        .join("snapshots")
        .join(format!("{snapshot_id}.json"))
}

fn documents_path(project_path: &Path, snapshot_id: &str) -> PathBuf {
    index_dir(project_path)
        .join("documents")
        .join(format!("{snapshot_id}.json"))
}

fn chunks_path(project_path: &Path, snapshot_id: &str) -> PathBuf {
    index_dir(project_path)
        .join("chunks")
        .join(format!("{snapshot_id}.jsonl"))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn init_creates_index_layout() {
        let dir = tempdir().expect("create temp dir");

        let status = init_project_index(dir.path()).expect("init index");

        assert!(status.exists);
        for path in [
            ".etyon-snapshot/config.json",
            ".etyon-snapshot/manifest.json",
            ".etyon-snapshot/index.json",
            ".etyon-snapshot/history.json",
            ".etyon-snapshot/snapshots",
            ".etyon-snapshot/documents",
            ".etyon-snapshot/chunks",
            ".etyon-snapshot/embeddings",
        ] {
            assert!(dir.path().join(path).exists(), "missing {path}");
        }
    }

    #[test]
    fn refresh_writes_documents_chunks_and_stats() {
        let dir = tempdir().expect("create temp dir");
        fs::write(dir.path().join("README.md"), "# Hello\n").expect("write readme");
        fs::write(dir.path().join("asset.bin"), [0, 1, 2]).expect("write binary");

        let result = refresh_project_index(dir.path()).expect("refresh index");
        let chunks_path = dir
            .path()
            .join(".etyon-snapshot")
            .join("chunks")
            .join(format!("{}.jsonl", result.snapshot_id));

        assert_eq!(result.indexed_file_count, 2);
        assert_eq!(result.document_count, 1);
        assert!(chunks_path.exists());
        assert!(
            fs::read_to_string(chunks_path)
                .expect("read chunks")
                .contains("\"relativePath\":\"README.md\"")
        );
    }

    #[test]
    fn refresh_respects_gitignore() {
        let dir = tempdir().expect("create temp dir");
        fs::create_dir(dir.path().join(".git")).expect("create .git");
        fs::write(dir.path().join(".gitignore"), "ignored/\n").expect("write gitignore");
        fs::create_dir(dir.path().join("ignored")).expect("create ignored dir");
        fs::write(dir.path().join("ignored/file.md"), "# ignored\n").expect("write ignored");
        fs::write(dir.path().join("kept.md"), "# kept\n").expect("write kept");

        let result = refresh_project_index(dir.path()).expect("refresh index");

        assert_eq!(result.indexed_file_count, 1);
        assert!(
            fs::read_to_string(dir.path().join(".gitignore"))
                .expect("read gitignore")
                .contains(".etyon-snapshot/")
        );
    }
}
