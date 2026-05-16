use std::{
    env, fs,
    path::{Path, PathBuf},
};

use etyon_types::{CONNECTION_FILE_VERSION, CONNECTION_TRANSPORT, ConnectionFile};

use crate::error::{ClientError, ClientResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionInfo {
    pub path: PathBuf,
    pub payload: ConnectionFile,
}

impl ConnectionInfo {
    /// Reads and validates an Etyon desktop connection file.
    ///
    /// # Errors
    ///
    /// Returns an error when the file is missing, cannot be parsed, or targets
    /// an unsupported connection version or transport.
    pub fn read(path: impl AsRef<Path>) -> ClientResult<Self> {
        let path = path.as_ref().to_path_buf();

        if !path.exists() {
            return Err(ClientError::ConnectionFileMissing(path));
        }

        let raw = fs::read_to_string(&path).map_err(ClientError::ConnectionFileRead)?;
        let payload: ConnectionFile =
            serde_json::from_str(&raw).map_err(ClientError::ConnectionFileParse)?;

        if payload.version != CONNECTION_FILE_VERSION {
            return Err(ClientError::UnsupportedConnectionVersion(payload.version));
        }

        if payload.transport != CONNECTION_TRANSPORT {
            return Err(ClientError::UnsupportedConnectionTransport(
                payload.transport,
            ));
        }

        Ok(Self { path, payload })
    }
}

pub fn default_connection_path() -> PathBuf {
    let home = env::var_os("HOME").map_or_else(|| PathBuf::from("."), PathBuf::from);

    home.join(".config").join("etyon").join("connection.json")
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    fn write_connection(path: &Path, version: u32) {
        fs::write(
            path,
            serde_json::json!({
                "pid": 42,
                "token": "secret",
                "transport": "desktop-http",
                "url": "http://127.0.0.1:49152",
                "version": version,
                "writtenAt": "2026-05-16T00:00:00.000Z"
            })
            .to_string(),
        )
        .expect("write connection file fixture");
    }

    #[test]
    fn reads_connection_file() {
        let dir = tempdir().expect("create temp dir");
        let path = dir.path().join("connection.json");

        write_connection(&path, 1);

        let info = ConnectionInfo::read(&path).expect("read connection info");

        assert_eq!(info.payload.pid, 42);
        assert_eq!(info.payload.token, "secret");
    }

    #[test]
    fn rejects_unsupported_version() {
        let dir = tempdir().expect("create temp dir");
        let path = dir.path().join("connection.json");

        write_connection(&path, 2);

        let error = ConnectionInfo::read(&path).expect_err("reject version");

        assert!(matches!(
            error,
            ClientError::UnsupportedConnectionVersion(2)
        ));
    }
}
