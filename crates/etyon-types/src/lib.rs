use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CONNECTION_FILE_VERSION: u32 = 1;
pub const CONNECTION_TRANSPORT: &str = "desktop-http";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFile {
    pub pid: u32,
    pub token: String,
    pub transport: String,
    pub url: String,
    pub version: u32,
    pub written_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatusOutput {
    pub ok: bool,
    pub pid: Option<u32>,
    pub transport: Option<String>,
    pub url: Option<String>,
    pub version: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HealthOutput {
    pub ok: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionSummary {
    pub archived_at: Option<String>,
    pub created_at: String,
    pub id: String,
    pub last_opened_at: String,
    pub model_id: Option<String>,
    pub pinned_at: Option<String>,
    pub project_path: String,
    pub title: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ChatMention {
    #[serde(rename = "file")]
    File {
        path: String,
        relative_path: String,
        snapshot_id: String,
    },
    #[serde(rename = "folder")]
    Folder {
        path: String,
        relative_path: String,
        snapshot_id: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotState {
    pub project_path: String,
    pub refreshed_at: String,
    pub snapshot_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ProjectSnapshotItem {
    #[serde(rename = "file")]
    File {
        language: Option<String>,
        mtime_ms: f64,
        path: String,
        relative_path: String,
        size: u64,
        snapshot_id: String,
    },
    #[serde(rename = "folder")]
    Folder {
        file_count: u64,
        path: String,
        relative_path: String,
        snapshot_id: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectSnapshotFilesOutput {
    pub files: Vec<ProjectSnapshotItem>,
    pub snapshot_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFetchModelsInput {
    pub api_key: String,
    pub base_url: Option<String>,
    pub provider_id: String,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFetchModelsOutput {
    pub models: Vec<ProviderModel>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliErrorOutput {
    pub code: String,
    pub message: String,
}

pub type JsonValue = Value;
