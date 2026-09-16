use reqwest::{Client, Response};
use serde_json::Value;
use std::time::Duration;

pub fn client() -> Result<Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(6))
        .user_agent("Metacodex/1.0 usage")
        .build()
        .map_err(|_| "unavailable".into())
}

pub async fn bytes(response: Result<Response, reqwest::Error>) -> Result<Vec<u8>, String> {
    let mut response = response.map_err(|e| {
        if e.is_timeout() {
            "timeout"
        } else {
            "unavailable"
        }
    })?;
    match response.status().as_u16() {
        401 | 403 => return Err("signedOut".into()),
        429 => return Err("rateLimited".into()),
        200..=299 => {}
        _ => return Err("unavailable".into()),
    }
    if response
        .headers()
        .get("grpc-status")
        .is_some_and(|value| value != "0")
    {
        return Err("unavailable".into());
    }
    const MAX: usize = 4 * 1024 * 1024;
    if response.content_length().is_some_and(|n| n > MAX as u64) {
        return Err("protocol".into());
    }
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "unavailable")? {
        if data.len() + chunk.len() > MAX {
            return Err("protocol".into());
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}

pub async fn json(response: Result<Response, reqwest::Error>) -> Result<Value, String> {
    serde_json::from_slice(&bytes(response).await?).map_err(|_| "protocol".into())
}

pub fn timestamp(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp())
}
