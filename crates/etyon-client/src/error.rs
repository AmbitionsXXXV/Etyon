use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ClientError {
    #[error("connection file does not exist: {0}")]
    ConnectionFileMissing(PathBuf),
    #[error("failed to read connection file: {0}")]
    ConnectionFileRead(#[source] std::io::Error),
    #[error("failed to parse connection file: {0}")]
    ConnectionFileParse(#[source] serde_json::Error),
    #[error("unsupported connection file version: {0}")]
    UnsupportedConnectionVersion(u32),
    #[error("unsupported connection transport: {0}")]
    UnsupportedConnectionTransport(String),
    #[error("invalid connection URL: {0}")]
    InvalidConnectionUrl(#[source] url::ParseError),
    #[error("desktop health check failed with status {0}")]
    HealthCheckFailed(reqwest::StatusCode),
    #[error("desktop rejected the local token")]
    Unauthorized,
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
}

pub type ClientResult<T> = Result<T, ClientError>;
