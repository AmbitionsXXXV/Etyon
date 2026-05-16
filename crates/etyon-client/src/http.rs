use std::time::Duration;

use etyon_types::{HealthOutput, JsonValue};
use reqwest::{Client, Method, RequestBuilder, StatusCode};
use serde::{Serialize, de::DeserializeOwned};
use url::Url;

use crate::{
    connection::ConnectionInfo,
    error::{ClientError, ClientResult},
};

#[derive(Debug, Clone)]
pub struct EtyonClient {
    client: Client,
    connection: ConnectionInfo,
    url: Url,
}

impl EtyonClient {
    /// Creates a desktop client from connection information.
    ///
    /// # Errors
    ///
    /// Returns an error when the desktop URL is invalid or the HTTP client
    /// cannot be constructed.
    pub fn new(connection: ConnectionInfo, timeout: Duration) -> ClientResult<Self> {
        let url = Url::parse(&connection.payload.url).map_err(ClientError::InvalidConnectionUrl)?;
        let client = Client::builder().timeout(timeout).build()?;

        Ok(Self {
            client,
            connection,
            url,
        })
    }

    #[must_use]
    pub fn connection(&self) -> &ConnectionInfo {
        &self.connection
    }

    /// Calls the unauthenticated desktop health endpoint.
    ///
    /// # Errors
    ///
    /// Returns an error when the request fails, the endpoint returns a non-2xx
    /// response, or the response body cannot be decoded.
    pub async fn health(&self) -> ClientResult<HealthOutput> {
        let response = self.client.get(self.join_url("health")).send().await?;

        if !response.status().is_success() {
            return Err(ClientError::HealthCheckFailed(response.status()));
        }

        Ok(response.json().await?)
    }

    pub fn protected_request(&self, method: Method, path: &str) -> RequestBuilder {
        self.client
            .request(method, self.join_url(path))
            .bearer_auth(&self.connection.payload.token)
    }

    /// Calls an authenticated oRPC procedure and decodes the JSON response.
    ///
    /// # Errors
    ///
    /// Returns an error when the request fails, authentication is rejected, the
    /// endpoint returns an error status, or the response body cannot be decoded.
    pub async fn rpc<I, O>(&self, path: &str, input: &I) -> ClientResult<O>
    where
        I: Serialize + ?Sized,
        O: DeserializeOwned,
    {
        let response = self
            .protected_request(Method::POST, &format!("rpc/{path}"))
            .json(input)
            .send()
            .await?;

        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(ClientError::Unauthorized);
        }

        Ok(response.error_for_status()?.json().await?)
    }

    /// Calls an authenticated oRPC procedure using dynamic JSON values.
    ///
    /// # Errors
    ///
    /// Returns an error when the underlying RPC call fails.
    pub async fn rpc_value(&self, path: &str, input: JsonValue) -> ClientResult<JsonValue> {
        self.rpc(path, &input).await
    }

    /// Sends a chat request to the desktop streaming HTTP endpoint.
    ///
    /// # Errors
    ///
    /// Returns an error when the request fails, authentication is rejected, or
    /// the endpoint returns an error status.
    pub async fn chat(&self, input: JsonValue) -> ClientResult<reqwest::Response> {
        let response = self
            .protected_request(Method::POST, "api/chat")
            .json(&input)
            .send()
            .await?;

        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(ClientError::Unauthorized);
        }

        Ok(response.error_for_status()?)
    }

    fn join_url(&self, path: &str) -> Url {
        self.url.join(path).expect("base desktop URL is valid")
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, time::Duration};

    use tempfile::tempdir;

    use super::*;
    use crate::ConnectionInfo;

    #[test]
    fn builds_authorized_request() {
        let dir = tempdir().expect("create temp dir");
        let path = dir.path().join("connection.json");

        fs::write(
            &path,
            serde_json::json!({
                "pid": 42,
                "token": "secret",
                "transport": "desktop-http",
                "url": "http://127.0.0.1:49152",
                "version": 1,
                "writtenAt": "2026-05-16T00:00:00.000Z"
            })
            .to_string(),
        )
        .expect("write connection file");

        let connection = ConnectionInfo::read(path).expect("read connection");
        let client = EtyonClient::new(connection, Duration::from_secs(5)).expect("build client");
        let request = client
            .protected_request(Method::GET, "rpc/ping")
            .build()
            .expect("build request");

        assert_eq!(
            request
                .headers()
                .get("authorization")
                .and_then(|value| value.to_str().ok()),
            Some("Bearer secret")
        );
        assert_eq!(request.url().as_str(), "http://127.0.0.1:49152/rpc/ping");
    }
}
