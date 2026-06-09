use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::pty::shell::cli_launch_args;

/// Owns the lifecycle of the local `opencode serve` sidecar — the engine that
/// powers the Agent View. Spawned lazily on first use, reused while healthy, and
/// reaped on quit. The opencode HTTP API is local-only (127.0.0.1); the GO
/// subscription key lives inside opencode's own auth store, never in the webview.
pub struct AgentRuntime {
    client: reqwest::Client,
    /// Serializes `ensure_base` so two concurrent callers can't spawn two
    /// servers. Held across await; the inner state Mutex is only taken briefly.
    start_lock: tokio::sync::Mutex<()>,
    inner: Mutex<RuntimeState>,
}

#[derive(Default)]
struct RuntimeState {
    child: Option<Child>,
    base_url: Option<String>,
    version: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub running: bool,
    pub base_url: Option<String>,
    pub version: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModels {
    pub id: String,
    pub name: String,
    pub default_model: Option<String>,
    pub models: Vec<ModelInfo>,
}

impl AgentRuntime {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            start_lock: tokio::sync::Mutex::new(()),
            inner: Mutex::new(RuntimeState::default()),
        }
    }

    pub fn status(&self) -> RuntimeStatus {
        let st = self.inner.lock();
        RuntimeStatus {
            running: st.base_url.is_some(),
            base_url: st.base_url.clone(),
            version: st.version.clone(),
        }
    }

    pub async fn start(&self) -> AppResult<RuntimeStatus> {
        self.ensure_base().await?;
        Ok(self.status())
    }

    /// Ensure the server is running and return its base URL.
    pub async fn ensure_base(&self) -> AppResult<String> {
        let _guard = self.start_lock.lock().await;

        // Reuse an already-live, healthy instance.
        if let Some(base) = self.live_base() {
            if self.health(&base).await.is_ok() {
                return Ok(base);
            }
            self.stop();
        }

        let (child, base) = tauri::async_runtime::spawn_blocking(spawn_opencode)
            .await
            .map_err(|e| AppError::Other(format!("opencode spawn join: {e}")))??;
        let version = self.probe_health(&base).await?;

        let mut st = self.inner.lock();
        st.child = Some(child);
        st.base_url = Some(base.clone());
        st.version = Some(version);
        Ok(base)
    }

    /// Current base URL if the child is still alive; clears stale state if it died.
    fn live_base(&self) -> Option<String> {
        let mut st = self.inner.lock();
        if let Some(child) = st.child.as_mut() {
            if matches!(child.try_wait(), Ok(Some(_))) {
                st.child = None;
                st.base_url = None;
                st.version = None;
                return None;
            }
        }
        st.base_url.clone()
    }

    pub fn stop(&self) {
        let mut st = self.inner.lock();
        if let Some(mut child) = st.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        st.base_url = None;
        st.version = None;
    }

    async fn health(&self, base: &str) -> AppResult<String> {
        let resp = self
            .client
            .get(format!("{base}/global/health"))
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .map_err(|e| AppError::Other(format!("health request: {e}")))?;
        let v: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::Other(format!("health decode: {e}")))?;
        if v.get("healthy").and_then(serde_json::Value::as_bool) != Some(true) {
            return Err(AppError::Other("opencode server reported unhealthy".into()));
        }
        Ok(v.get("version")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string())
    }

    async fn probe_health(&self, base: &str) -> AppResult<String> {
        let mut last = AppError::Other("health probe timed out".into());
        for _ in 0..25 {
            match self.health(base).await {
                Ok(version) => return Ok(version),
                Err(e) => {
                    last = e;
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            }
        }
        Err(last)
    }

    /// List providers + models, with API keys stripped. The raw
    /// `/config/providers` response embeds each provider's `key`; those must
    /// never reach the webview, so the bridge returns only id + name + models.
    pub async fn list_models(&self) -> AppResult<Vec<ProviderModels>> {
        let base = self.ensure_base().await?;
        let resp = self
            .client
            .get(format!("{base}/config/providers"))
            .send()
            .await
            .map_err(|e| AppError::Other(format!("providers request: {e}")))?;
        let v: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::Other(format!("providers decode: {e}")))?;
        Ok(parse_providers(&v))
    }

    /// Fire-and-complete a one-shot prompt in a fresh session. Used by the
    /// scheduler to run cron tasks headlessly. Returns the new session id.
    pub async fn run_prompt(
        &self,
        prompt: &str,
        provider_id: &str,
        model_id: &str,
    ) -> AppResult<String> {
        let base = self.ensure_base().await?;
        let created: serde_json::Value = self
            .client
            .post(format!("{base}/session"))
            .json(&serde_json::json!({}))
            .send()
            .await
            .map_err(|e| AppError::Other(format!("session create: {e}")))?
            .json()
            .await
            .map_err(|e| AppError::Other(format!("session decode: {e}")))?;
        let session_id = created
            .get("id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| AppError::Other("session create returned no id".into()))?
            .to_string();

        let body = serde_json::json!({
            "parts": [{ "type": "text", "text": prompt }],
            "model": { "providerID": provider_id, "modelID": model_id },
        });
        let resp = self
            .client
            .post(format!("{base}/session/{session_id}/message"))
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("prompt request: {e}")))?;
        if !resp.status().is_success() {
            return Err(AppError::Other(format!("prompt failed: HTTP {}", resp.status())));
        }
        Ok(session_id)
    }

    /// Set an API-key credential for a provider (e.g. the opencode GO key) via
    /// `PUT /auth/{providerID}`. opencode persists it in its own auth store.
    pub async fn set_credentials(&self, provider_id: &str, key: &str) -> AppResult<()> {
        let base = self.ensure_base().await?;
        let body = serde_json::json!({ "type": "api_key", "key": key });
        let resp = self
            .client
            .put(format!("{base}/auth/{provider_id}"))
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("auth request: {e}")))?;
        if !resp.status().is_success() {
            return Err(AppError::Other(format!(
                "set credentials failed: HTTP {}",
                resp.status()
            )));
        }
        Ok(())
    }
}

impl Default for AgentRuntime {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_providers(v: &serde_json::Value) -> Vec<ProviderModels> {
    let defaults = v.get("default");
    let mut out = Vec::new();
    let Some(providers) = v.get("providers").and_then(|p| p.as_array()) else {
        return out;
    };
    for p in providers {
        let id = p
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string();
        if id.is_empty() {
            continue;
        }
        let name = p
            .get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(&id)
            .to_string();
        let default_model = defaults
            .and_then(|d| d.get(&id))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        let mut models = Vec::new();
        if let Some(map) = p.get("models").and_then(|m| m.as_object()) {
            for (mid, mval) in map {
                let mname = mval
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(mid)
                    .to_string();
                models.push(ModelInfo {
                    id: mid.clone(),
                    name: mname,
                });
            }
            models.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        }
        out.push(ProviderModels {
            id,
            name,
            default_model,
            models,
        });
    }
    out
}

/// Spawn `opencode serve` through a login+interactive shell so the GUI process's
/// sparse PATH is re-sourced (mise/nvm/bun resolve), then read the
/// `listening on http://127.0.0.1:PORT` line it prints. `exec` replaces the
/// shell with opencode so killing the child kills the server (no orphan shell).
fn spawn_opencode() -> AppResult<(Child, String)> {
    let (shell, args) = cli_launch_args("exec opencode serve --port 0 --print-logs");
    let mut child = Command::new(&shell)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("spawn opencode ({shell}): {e}")))?;

    let (tx, rx) = mpsc::channel::<String>();
    if let Some(out) = child.stdout.take() {
        scan_for_url(out, tx.clone());
    }
    if let Some(err) = child.stderr.take() {
        scan_for_url(err, tx);
    }

    match rx.recv_timeout(Duration::from_secs(25)) {
        Ok(url) => Ok((child, url)),
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(AppError::Other(
                "opencode server did not report a listening URL (is `opencode` installed and on PATH?)"
                    .into(),
            ))
        }
    }
}

/// Drain a child pipe line by line, forwarding the first listening URL it finds.
/// Keeps reading after the match so opencode never blocks on a full pipe.
fn scan_for_url<R: Read + Send + 'static>(reader: R, tx: mpsc::Sender<String>) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            let Ok(line) = line else { break };
            if let Some(url) = extract_url(&line) {
                let _ = tx.send(url);
            }
        }
    });
}

fn extract_url(line: &str) -> Option<String> {
    let start = line.find("http://127.0.0.1:")?;
    let rest = &line[start..];
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let url = rest[..end].trim_end_matches('/');
    let port = url.rsplit(':').next().unwrap_or("");
    if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) {
        Some(url.to_string())
    } else {
        None
    }
}
