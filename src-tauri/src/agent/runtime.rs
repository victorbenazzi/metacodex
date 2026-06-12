use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::pty::shell::cli_launch_args;

/// Owns the lifecycle of the local `opencode serve` sidecar, the engine that
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
    /// Set when we spawned the sidecar ourselves (we own and reap it directly).
    child: Option<Child>,
    /// Set when we adopted a sidecar from a previous run (no Child handle, so we
    /// reap it by pid). Mutually exclusive with `child`.
    adopted_pid: Option<u32>,
    base_url: Option<String>,
    version: Option<String>,
    /// True while `ensure_base` is bringing a sidecar up. Lets `requiresRestart`
    /// stay honest for config mutations that land mid-spawn (the booting sidecar
    /// may have already read the previous config).
    starting: bool,
}

/// Drop guard that clears `RuntimeState.starting` on every `ensure_base` exit
/// path (success, error, panic).
struct StartingFlag<'a>(&'a Mutex<RuntimeState>);
impl Drop for StartingFlag<'_> {
    fn drop(&mut self) {
        self.0.lock().starting = false;
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub running: bool,
    pub base_url: Option<String>,
    pub version: Option<String>,
}

/// Token windows of a model (`limit` in the opencode catalog). `context` is
/// what the frontend's context meter divides by; absent = no meter.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelLimit {
    pub context: Option<u64>,
    pub output: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    /// Model accepts file/image attachments (vision), gates the composer's
    /// image handling and picks the vision-relay default on the frontend.
    pub attachment: bool,
    pub reasoning: bool,
    /// Reasoning-effort variant names (e.g. "low" / "medium" / "high" / "max")
    /// the model exposes; empty = no variant selector. The name is sent back
    /// verbatim as `variant` on the message POST.
    pub variants: Vec<String>,
    pub limit: Option<ModelLimit>,
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

    /// True while a spawn is in flight (see `RuntimeState::starting`).
    pub fn is_starting(&self) -> bool {
        self.inner.lock().starting
    }

    pub async fn start(&self) -> AppResult<RuntimeStatus> {
        self.ensure_base().await?;
        Ok(self.status())
    }

    /// Ensure the server is running and return its base URL.
    pub async fn ensure_base(&self) -> AppResult<String> {
        let _guard = self.start_lock.lock().await;
        self.inner.lock().starting = true;
        let _starting = StartingFlag(&self.inner);

        // 1. Reuse our own live, healthy instance. The health check retries a
        //    few times: one slow response (a busy Bun process mid-turn) must not
        //    get a live sidecar SIGKILLed under an active chat stream.
        if let Some(base) = self.live_base() {
            for attempt in 0..3 {
                if self.health(&base).await.is_ok() {
                    return Ok(base);
                }
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                }
            }
            self.stop();
        }

        // 2. Adopt a sidecar a previous run left behind (e.g. a dev restart that
        //    wasn't a clean quit) instead of spawning another. This is what keeps
        //    `opencode serve` processes from piling up. Guards: the pointer must
        //    belong to THIS config root (dev and installed app must not steal
        //    each other's sidecar), and the pid must still look like opencode
        //    (pid recycling must never get an innocent process killed later).
        if let Some(saved) = load_runtime() {
            let same_root = saved.root.as_deref().is_none_or(|r| {
                crate::config_paths::config_root()
                    .map(|c| c.to_string_lossy() == r)
                    .unwrap_or(false)
            });
            if same_root && pid_alive(saved.pid) && pid_is_opencode(saved.pid) {
                if let Ok(version) = self.health(&saved.base_url).await {
                    let mut st = self.inner.lock();
                    st.child = None;
                    st.adopted_pid = Some(saved.pid);
                    st.base_url = Some(saved.base_url.clone());
                    st.version = Some(version);
                    return Ok(saved.base_url);
                }
            }
            if same_root {
                clear_runtime(); // stale pointer: drop it before spawning fresh.
            }
        }

        // 3. Spawn a fresh one and record it so the next run can adopt it.
        let (mut child, base) = tauri::async_runtime::spawn_blocking(spawn_opencode)
            .await
            .map_err(|e| AppError::Other(format!("opencode spawn join: {e}")))??;
        // A failed probe must reap the child we just spawned: dropping a
        // std::process::Child neither kills nor waits it, so without this the
        // process would leak untracked (and unadoptable, since save_runtime
        // never ran).
        let version = match self.probe_health(&base).await {
            Ok(v) => v,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
        };
        let pid = child.id();

        {
            let mut st = self.inner.lock();
            st.child = Some(child);
            st.adopted_pid = None;
            st.base_url = Some(base.clone());
            st.version = Some(version);
        }
        save_runtime(pid, &base);
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

    /// Stop the sidecar. SIGTERM first so opencode can shut down the MCP child
    /// processes it spawned (a straight SIGKILL orphans every `npx ...` server),
    /// escalating to SIGKILL after a bounded wait. The state lock is NOT held
    /// while waiting, so `status()` callers never block on a stop.
    pub fn stop(&self) {
        let (child, adopted) = {
            let mut st = self.inner.lock();
            let child = st.child.take();
            let adopted = st.adopted_pid.take();
            st.base_url = None;
            st.version = None;
            (child, adopted)
        };
        if let Some(mut child) = child {
            terminate_child(&mut child);
        } else if let Some(pid) = adopted {
            // Adopted instance: no Child handle, so reap by pid, but only after
            // re-verifying the pid still looks like opencode (pid recycling).
            if pid_is_opencode(pid) {
                kill_pid_graceful(pid);
            }
        }
        clear_runtime();
    }

    /// `stop()` serialized against an in-flight `ensure_base`, so a Stop pressed
    /// during a spawn actually stops the freshly spawned sidecar instead of
    /// no-opping against empty state.
    pub async fn stop_locked(&self) {
        let _guard = self.start_lock.lock().await;
        self.stop();
    }

    /// Kill + respawn the sidecar so config changes (MCP servers) take effect.
    /// NEVER called automatically: the frontend owns the moment, because a
    /// restart drops live SSE streams and `--port 0` changes the base URL.
    pub async fn restart(&self) -> AppResult<RuntimeStatus> {
        {
            let _guard = self.start_lock.lock().await;
            self.stop();
        }
        self.start().await
    }

    /// `GET /mcp` server status, whitelist-sanitized. `None` when the sidecar
    /// isn't running (never forces a start) or the endpoint is missing (older
    /// opencode without MCP status support). `directory` scopes the status to
    /// the active project instance, like every other opencode call.
    pub async fn mcp_status(&self, directory: Option<&str>) -> AppResult<Option<serde_json::Value>> {
        let base = { self.inner.lock().base_url.clone() };
        let Some(base) = base else { return Ok(None) };
        let suffix = directory
            .filter(|d| !d.is_empty())
            .map(|d| format!("?directory={}", encode_uri_component(d)))
            .unwrap_or_default();
        let resp = self
            .client
            .get(format!("{base}/mcp{suffix}"))
            .timeout(Duration::from_secs(3))
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => {
                let v: serde_json::Value = r
                    .json()
                    .await
                    .map_err(|e| AppError::Other(format!("mcp status decode: {e}")))?;
                Ok(Some(crate::agent::mcp::sanitize_mcp_status(&v)))
            }
            _ => Ok(None),
        }
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
            .timeout(Duration::from_secs(10))
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
    /// scheduler to run standalone cron tasks headlessly. Returns the new
    /// session id.
    ///
    /// A thin wrapper over [`Self::run_entity_turn`] (no agent identity, no
    /// system block, the full-auto ruleset): the unattended run is pre-allowed
    /// for every consequential tool, `directory` rides as `?directory=` on
    /// every call, and the turn is bounded by [`RUN_PROMPT_BUDGET`] with a
    /// best-effort abort on expiry.
    pub async fn run_prompt(
        &self,
        prompt: &str,
        provider_id: &str,
        model_id: &str,
        directory: Option<&str>,
    ) -> AppResult<String> {
        let outcome = self
            .run_entity_turn(EntityTurnRequest {
                agent_name: None,
                preset: "full-auto",
                provider_id,
                model_id,
                variant: None,
                directory,
                system: None,
                prompt,
                on_permission_pending: None,
                auto_approve_dir: None,
            })
            .await?;
        if outcome.aborted {
            return Err(AppError::Other(format!(
                "run timed out after {} minutes (session aborted)",
                RUN_PROMPT_BUDGET.as_secs() / 60
            )));
        }
        Ok(outcome.session_id)
    }

    /// One turn of an ENTITY execution (phase 3): like [`Self::run_prompt`]
    /// but with the entity's compiled agent name, ITS permission preset
    /// (decision B: autonomous runs respect the preset instead of forcing
    /// full-auto), an optional `system` block (memory context + autonomous
    /// protocol) and the final assistant text extracted for the report /
    /// continuation parsing. While the turn runs on a non-full-auto preset, a
    /// watcher polls `GET /permission` and fires `on_permission_pending` once
    /// if an approval is waiting (the orchestrator notifies the user; the
    /// existing chat UI recovers the ask when the session is opened). On
    /// budget expiry the session is aborted and `aborted` comes back true.
    pub async fn run_entity_turn(&self, req: EntityTurnRequest<'_>) -> AppResult<EntityTurnOutcome> {
        let base = self.ensure_base().await?;
        let suffix = req
            .directory
            .filter(|d| !d.is_empty())
            .map(|d| format!("?directory={}", encode_uri_component(d)))
            .unwrap_or_default();

        let mut create_body = serde_json::json!({
            "permission": ruleset_for_preset(req.preset),
        });
        if let Some(agent) = req.agent_name {
            create_body["agent"] = serde_json::json!(agent);
        }
        let create_resp = self
            .client
            .post(format!("{base}/session{suffix}"))
            .json(&create_body)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| AppError::Other(format!("session create: {e}")))?;
        if !create_resp.status().is_success() {
            return Err(AppError::Other(format!(
                "session create failed: HTTP {}",
                create_resp.status()
            )));
        }
        let created: serde_json::Value = create_resp
            .json()
            .await
            .map_err(|e| AppError::Other(format!("session decode: {e}")))?;
        let session_id = created
            .get("id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| AppError::Other("session create returned no id".into()))?
            .to_string();

        // Permission watcher: only meaningful when the preset can ask. Asks
        // whose every target sits inside `auto_approve_dir` (the agent home:
        // memory writes, journal, proposals) are approved by the harness, so
        // phase-2 memory works on restrictive presets without waking the user;
        // anything else notifies once and waits for the human.
        let watcher = if req.preset != "full-auto" {
            let client = self.client.clone();
            let base_c = base.clone();
            let suffix_c = suffix.clone();
            let sid = session_id.clone();
            let on_pending = req.on_permission_pending.clone();
            let auto_dir = req.auto_approve_dir.clone();
            Some(tauri::async_runtime::spawn(async move {
                let mut notified = false;
                loop {
                    tokio::time::sleep(Duration::from_secs(15)).await;
                    let Ok(resp) = client
                        .get(format!("{base_c}/permission{suffix_c}"))
                        .timeout(Duration::from_secs(8))
                        .send()
                        .await
                    else {
                        continue;
                    };
                    let Ok(v) = resp.json::<serde_json::Value>().await else { continue };
                    let Some(rows) = v.as_array() else { continue };
                    let mut pending_other = false;
                    for r in rows {
                        if r.get("sessionID").and_then(serde_json::Value::as_str)
                            != Some(sid.as_str())
                        {
                            continue;
                        }
                        let id = r.get("id").and_then(serde_json::Value::as_str);
                        let patterns: Vec<&str> = r
                            .get("patterns")
                            .and_then(serde_json::Value::as_array)
                            .map(|a| {
                                a.iter().filter_map(serde_json::Value::as_str).collect()
                            })
                            .unwrap_or_default();
                        let home_scoped = auto_dir.as_deref().is_some_and(|d| {
                            !patterns.is_empty() && patterns.iter().all(|p| p.starts_with(d))
                        });
                        match id {
                            Some(id) if home_scoped => {
                                // v1 reply shape, same endpoint the chat uses.
                                let _ = client
                                    .post(format!(
                                        "{base_c}/session/{sid}/permissions/{id}{suffix_c}"
                                    ))
                                    .json(&serde_json::json!({ "response": "once" }))
                                    .timeout(Duration::from_secs(8))
                                    .send()
                                    .await;
                            }
                            _ => pending_other = true,
                        }
                    }
                    if pending_other && !notified {
                        notified = true;
                        if let Some(cb) = &on_pending {
                            cb(&sid);
                        }
                    }
                }
            }))
        } else {
            None
        };

        let mut body = serde_json::json!({
            "parts": [{ "type": "text", "text": req.prompt }],
            "model": { "providerID": req.provider_id, "modelID": req.model_id },
        });
        if let Some(agent) = req.agent_name {
            body["agent"] = serde_json::json!(agent);
        }
        if let Some(system) = req.system.filter(|s| !s.trim().is_empty()) {
            body["system"] = serde_json::json!(system);
        }
        if let Some(variant) = req.variant.filter(|v| !v.is_empty()) {
            body["variant"] = serde_json::json!(variant);
        }

        let send = self
            .client
            .post(format!("{base}/session/{session_id}/message{suffix}"))
            .json(&body)
            .send();
        let result = tokio::time::timeout(RUN_PROMPT_BUDGET, send).await;
        if let Some(w) = watcher {
            w.abort();
        }
        let aborted = match result {
            Ok(r) => {
                let resp = r.map_err(|e| AppError::Other(format!("prompt request: {e}")))?;
                if !resp.status().is_success() {
                    return Err(AppError::Other(format!("prompt failed: HTTP {}", resp.status())));
                }
                false
            }
            Err(_) => {
                let abort = self
                    .client
                    .post(format!("{base}/session/{session_id}/abort{suffix}"))
                    .timeout(Duration::from_secs(5))
                    .send()
                    .await;
                if let Err(e) = abort {
                    // The turn keeps burning tokens server-side; at least leave
                    // a trace instead of silently pretending it stopped.
                    eprintln!("[metacodex] session {session_id} abort failed: {e}");
                }
                true
            }
        };
        // A fresh check, not the watcher's sticky flag: an ask the user already
        // answered must not mislabel a slow run's timeout as "needs-you".
        let permission_pending = if aborted {
            self.session_has_pending_permission(&base, &suffix, &session_id).await
        } else {
            false
        };

        // Final assistant text (for the report + continuation marker). Best
        // effort: a transcript read failure must not turn a finished run into
        // an error.
        let final_text = self
            .client
            .get(format!("{base}/session/{session_id}/message{suffix}"))
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .ok();
        let final_text = match final_text {
            Some(resp) => resp
                .json::<serde_json::Value>()
                .await
                .ok()
                .map(|rows| extract_last_assistant_text(&rows))
                .unwrap_or_default(),
            None => String::new(),
        };

        Ok(EntityTurnOutcome {
            session_id,
            final_text,
            aborted,
            permission_pending,
        })
    }

    async fn session_has_pending_permission(&self, base: &str, suffix: &str, sid: &str) -> bool {
        let Ok(resp) = self
            .client
            .get(format!("{base}/permission{suffix}"))
            .timeout(Duration::from_secs(8))
            .send()
            .await
        else {
            return false;
        };
        let Ok(v) = resp.json::<serde_json::Value>().await else { return false };
        v.as_array()
            .map(|rows| {
                rows.iter().any(|r| {
                    r.get("sessionID").and_then(serde_json::Value::as_str) == Some(sid)
                })
            })
            .unwrap_or(false)
    }

    /// Best-effort `POST /global/dispose`: invalidate every cached opencode
    /// directory instance so the next session reads the freshly generated
    /// config. No-op when the sidecar is down (a fresh spawn reads it anyway).
    pub async fn dispose_global(&self) {
        let base = { self.inner.lock().base_url.clone() };
        let Some(base) = base else { return };
        let _ = self
            .client
            .post(format!("{base}/global/dispose"))
            .timeout(Duration::from_secs(5))
            .send()
            .await;
    }

    /// Set an API-key credential for a provider (e.g. the opencode GO key) via
    /// `PUT /auth/{providerID}`. opencode persists it in its own auth store.
    pub async fn set_credentials(&self, provider_id: &str, key: &str) -> AppResult<()> {
        let base = self.ensure_base().await?;
        let body = serde_json::json!({ "type": "api_key", "key": key });
        let resp = self
            .client
            .put(format!("{base}/auth/{}", encode_uri_component(provider_id)))
            .json(&body)
            .timeout(Duration::from_secs(10))
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

/// Total wall-clock budget for one headless `run_prompt` turn.
const RUN_PROMPT_BUDGET: Duration = Duration::from_secs(30 * 60);

/// One turn of an entity execution (see [`AgentRuntime::run_entity_turn`]).
pub struct EntityTurnRequest<'a> {
    /// Compiled opencode agent name (`mcx-<slug>`); None = no agent identity
    /// (the standalone `run_prompt` path).
    pub agent_name: Option<&'a str>,
    /// "ask" | "auto-edit" | "full-auto" (the entity's own preset).
    pub preset: &'a str,
    pub provider_id: &'a str,
    pub model_id: &'a str,
    pub variant: Option<&'a str>,
    pub directory: Option<&'a str>,
    /// Memory context + autonomous protocol, sent as the message `system`.
    pub system: Option<String>,
    pub prompt: &'a str,
    /// Fired AT MOST ONCE when a permission ask is pending for this session;
    /// receives the session id so the orchestrator can surface the run.
    pub on_permission_pending: Option<std::sync::Arc<dyn Fn(&str) + Send + Sync>>,
    /// Directory prefix (the agent home) whose permission asks the harness
    /// auto-approves: the agent writing its own memory/journal/proposals is
    /// pre-sanctioned by design, so restrictive presets don't stall on it.
    pub auto_approve_dir: Option<String>,
}

pub struct EntityTurnOutcome {
    pub session_id: String,
    pub final_text: String,
    /// True when the run hit the budget and the session was aborted.
    pub aborted: bool,
    /// True when, at abort time, a permission ask was still waiting for this
    /// session (the run "needs you" rather than merely timed out).
    pub permission_pending: bool,
}

/// Rust mirror of the frontend `rulesetForPreset` (opencode.ts) for the three
/// chat presets. MANUAL MIRROR, pinned by `ruleset_mirrors_frontend_presets`.
/// An unknown preset (agent.json is hand-editable) fails CLOSED to "ask":
/// falling through to full-auto would let a typo run bash unattended.
pub fn ruleset_for_preset(preset: &str) -> serde_json::Value {
    match preset {
        "full-auto" => full_auto_ruleset(),
        "auto-edit" => serde_json::json!([
            { "permission": "edit", "pattern": "**", "action": "allow" },
            { "permission": "bash", "pattern": "*", "action": "ask" },
            { "permission": "webfetch", "pattern": "**", "action": "allow" },
            { "permission": "websearch", "pattern": "**", "action": "allow" },
            { "permission": "external_directory", "pattern": "**", "action": "ask" }
        ]),
        _ => serde_json::json!([
            { "permission": "edit", "pattern": "**", "action": "ask" },
            { "permission": "bash", "pattern": "*", "action": "ask" },
            { "permission": "webfetch", "pattern": "**", "action": "ask" },
            { "permission": "websearch", "pattern": "**", "action": "ask" },
            { "permission": "external_directory", "pattern": "**", "action": "ask" }
        ]),
    }
}

/// Last assistant text from a stored transcript (`GET /session/{id}/message`):
/// rows may be `{info: {role}, parts: [...]}` (stored shape) or flat.
fn extract_last_assistant_text(rows: &serde_json::Value) -> String {
    let Some(rows) = rows.as_array() else { return String::new() };
    for row in rows.iter().rev() {
        let role = row
            .get("info")
            .and_then(|i| i.get("role"))
            .or_else(|| row.get("role"))
            .and_then(serde_json::Value::as_str);
        if role != Some("assistant") {
            continue;
        }
        let parts = row.get("parts").and_then(serde_json::Value::as_array);
        let Some(parts) = parts else { continue };
        let text: String = parts
            .iter()
            .filter(|p| p.get("type").and_then(serde_json::Value::as_str) == Some("text"))
            .filter_map(|p| p.get("text").and_then(serde_json::Value::as_str))
            .collect::<Vec<_>>()
            .join("");
        if !text.trim().is_empty() {
            return text;
        }
    }
    String::new()
}

/// Percent-encode a string for use as a URL query-parameter value, matching
/// JavaScript's `encodeURIComponent` (the frontend uses it for the same
/// `?directory=`), so opencode decodes the path identically on both paths.
fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// A fully-permissive opencode `PermissionRuleset` for unattended scheduled
/// runs: the Rust mirror of the frontend's `full-auto` chat preset
/// (`rulesetForPreset("full-auto")` in `src/features/agent/opencode.ts`).
/// Pre-allows every consequential tool so a headless turn never blocks on an
/// approval card. MANUAL MIRROR: if you change one side, change the other; the
/// `full_auto_ruleset_mirrors_frontend_preset` test pins this JSON.
fn full_auto_ruleset() -> serde_json::Value {
    serde_json::json!([
        { "permission": "edit", "pattern": "**", "action": "allow" },
        { "permission": "bash", "pattern": "*", "action": "allow" },
        { "permission": "webfetch", "pattern": "**", "action": "allow" },
        { "permission": "websearch", "pattern": "**", "action": "allow" },
        { "permission": "external_directory", "pattern": "**", "action": "allow" },
        { "permission": "task", "pattern": "**", "action": "allow" }
    ])
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
                // opencode >= 1.16 nests these under `capabilities`; older
                // builds had them at the top level. Check both.
                let caps = mval.get("capabilities");
                let cap = |key: &str| {
                    caps.and_then(|c| c.get(key))
                        .or_else(|| mval.get(key))
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false)
                };
                // "Vision" needs both: file parts accepted AND image input
                // understood (e.g. deepseek-reasoner attaches text files but
                // can't see images; image-only `attachment` would mislead the
                // relay). When `capabilities.input` is absent (old schema),
                // fall back to the attachment flag alone.
                let image_input = caps
                    .and_then(|c| c.get("input"))
                    .and_then(|i| i.get("image"))
                    .and_then(serde_json::Value::as_bool);
                let variants = mval
                    .get("variants")
                    .and_then(|v| v.as_object())
                    .map(|m| m.keys().cloned().collect::<Vec<_>>())
                    .unwrap_or_default();
                let limit = mval.get("limit").and_then(|l| {
                    let context = l.get("context").and_then(serde_json::Value::as_u64);
                    let output = l.get("output").and_then(serde_json::Value::as_u64);
                    if context.is_none() && output.is_none() {
                        None
                    } else {
                        Some(ModelLimit { context, output })
                    }
                });
                models.push(ModelInfo {
                    id: mid.clone(),
                    name: mname,
                    attachment: cap("attachment") && image_input.unwrap_or(true),
                    reasoning: cap("reasoning"),
                    variants,
                    limit,
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
/// sparse PATH is re-sourced (mise/nvm/bun resolve). `exec` replaces the shell
/// with opencode so killing the child kills the server (no orphan shell).
///
/// stdout/stderr go to a LOG FILE, not pipes. A piped child whose parent dies
/// (e.g. `pnpm tauri dev` killed without a clean quit) hits a broken pipe and
/// spins writing to it; that broken pipe (made worse by `--print-logs`) is what
/// pinned orphaned sidecars at 100% CPU. A file sink never breaks; we poll it for
/// the listening URL, and drop `--print-logs` (the URL still prints without it).
fn spawn_opencode() -> AppResult<(Child, String)> {
    let log_path =
        log_file_path().ok_or_else(|| AppError::Other("no state dir for the opencode log".into()))?;
    // 0600: the log captures uncontrolled sidecar/MCP-child output, keep it
    // owner-only like the rest of the secret-adjacent state files.
    let mut open = std::fs::OpenOptions::new();
    open.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        open.mode(0o600);
    }
    let file = open
        .open(&log_path)
        .map_err(|e| AppError::Other(format!("opencode log create: {e}")))?;
    let file_err = file
        .try_clone()
        .map_err(|e| AppError::Other(format!("opencode log clone: {e}")))?;

    // Regenerate the metacodex-managed opencode config layer (enabled MCP
    // servers) before every spawn so it can never go stale, and point the
    // sidecar at it. opencode MERGES this on top of the user's global config.
    // A generate failure only loses MCP, never block the agent itself on it.
    if let Err(e) = crate::agent::mcp::regenerate_opencode_config() {
        eprintln!("[metacodex] opencode config regenerate failed: {e}");
    }

    let (shell, args) = cli_launch_args("exec opencode serve --port 0");
    let mut cmd = Command::new(&shell);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(file))
        .stderr(Stdio::from(file_err));
    // `.env()` survives the `$SHELL -l -i -c "exec opencode ..."` hop (rc files
    // don't unset unknown vars) and avoids quoting issues vs inlining it.
    if let Ok(cfg) = crate::config_paths::opencode_config_file() {
        if cfg.exists() {
            cmd.env("OPENCODE_CONFIG", &cfg);
        }
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("spawn opencode ({shell}): {e}")))?;

    let deadline = std::time::Instant::now() + Duration::from_secs(25);
    loop {
        if let Some(url) = read_url_from_log(&log_path) {
            return Ok((child, url));
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Other(
                "opencode server did not report a listening URL (is `opencode` installed and on PATH?)"
                    .into(),
            ));
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

fn read_url_from_log(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    // Only scan newline-terminated (complete) lines, so a URL caught mid-flush
    // isn't parsed with a truncated port.
    let idx = content.rfind('\n')?;
    let complete = &content[..idx];
    // The spawn goes through `$SHELL -l -i -c`, so rc-file noise (banners, dev
    // server URLs) can land in the log BEFORE opencode's announce line. Prefer
    // the line opencode actually prints; fall back to the LAST local URL seen.
    if let Some(url) = complete
        .lines()
        .filter(|l| l.contains("server listening"))
        .find_map(extract_url)
    {
        return Some(url);
    }
    complete.lines().filter_map(extract_url).next_back()
}

// ---- sidecar reuse + reaping across runs ------------------------------------

/// Persisted pointer to the running sidecar so a later launch (notably a dev
/// restart) ADOPTS it instead of spawning yet another `opencode serve`.
/// `root` records which config root (`~/.metacodex` vs a `METACODEX_HOME` dev
/// dir) owns the sidecar, so dev and installed apps never steal each other's.
#[derive(Serialize, Deserialize)]
struct PersistedRuntime {
    pid: u32,
    base_url: String,
    #[serde(default)]
    root: Option<String>,
}

fn runtime_file_path() -> Option<PathBuf> {
    crate::config_paths::state_dir()
        .ok()
        .map(|d| d.join("opencode-runtime.json"))
}

fn log_file_path() -> Option<PathBuf> {
    crate::config_paths::state_dir()
        .ok()
        .map(|d| d.join("opencode.log"))
}

fn save_runtime(pid: u32, base_url: &str) {
    if let Some(p) = runtime_file_path() {
        let _ = crate::config_paths::write_json_atomic(
            &p,
            &PersistedRuntime {
                pid,
                base_url: base_url.to_string(),
                root: crate::config_paths::config_root()
                    .ok()
                    .map(|r| r.to_string_lossy().to_string()),
            },
        );
    }
}

fn load_runtime() -> Option<PersistedRuntime> {
    let p = runtime_file_path()?;
    crate::config_paths::read_json_opt::<PersistedRuntime>(&p)
        .ok()
        .flatten()
}

fn clear_runtime() {
    if let Some(p) = runtime_file_path() {
        let _ = std::fs::remove_file(p);
    }
}

/// `kill -0`: is a process with this pid alive and ours to signal?
fn pid_alive(pid: u32) -> bool {
    Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// SIGTERM (the bare `kill` default), so the target can clean up its children.
fn kill_pid(pid: u32) {
    let _ = Command::new("kill")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Does the process's command name look like the opencode sidecar? Used before
/// adopting or killing a persisted pid: after a reboot the pid may have been
/// recycled by an unrelated process, which must never receive our signals.
fn pid_is_opencode(pid: u32) -> bool {
    Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .ok()
        .map(|o| {
            let comm = String::from_utf8_lossy(&o.stdout).to_lowercase();
            comm.contains("opencode") || comm.contains("bun")
        })
        .unwrap_or(false)
}

/// SIGTERM an owned child so opencode can reap its MCP children, escalating to
/// SIGKILL after a bounded wait.
fn terminate_child(child: &mut Child) {
    kill_pid(child.id());
    let deadline = std::time::Instant::now() + Duration::from_millis(1500);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// SIGTERM-then-SIGKILL for an adopted pid (no `Child` handle to wait on).
fn kill_pid_graceful(pid: u32) {
    kill_pid(pid);
    let deadline = std::time::Instant::now() + Duration::from_millis(1500);
    while pid_alive(pid) {
        if std::time::Instant::now() >= deadline {
            let _ = Command::new("kill")
                .args(["-9", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn extract_url(line: &str) -> Option<String> {
    let start = line.find("http://127.0.0.1:")?;
    let rest = &line[start..];
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let url = rest[..end].trim_end_matches('/');
    // Take the longest digit run after the final colon, dropping trailing junk
    // glued to the port (ANSI resets, punctuation) instead of rejecting outright.
    let colon = url.rfind(':')?;
    let digits = url[colon + 1..]
        .bytes()
        .take_while(u8::is_ascii_digit)
        .count();
    if digits == 0 {
        return None;
    }
    Some(url[..colon + 1 + digits].to_string())
}

#[cfg(test)]
mod tests {
    use super::{extract_url, full_auto_ruleset, parse_providers, ruleset_for_preset};

    /// Pins the Rust side of the THREE-preset manual mirror against
    /// `rulesetForPreset` in `src/features/agent/opencode.ts` (swarm = false),
    /// and the fail-closed default: an unknown preset (hand-edited agent.json)
    /// must get the "ask" ruleset, never full-auto.
    #[test]
    fn ruleset_mirrors_frontend_presets() {
        let ask = serde_json::json!([
            { "permission": "edit", "pattern": "**", "action": "ask" },
            { "permission": "bash", "pattern": "*", "action": "ask" },
            { "permission": "webfetch", "pattern": "**", "action": "ask" },
            { "permission": "websearch", "pattern": "**", "action": "ask" },
            { "permission": "external_directory", "pattern": "**", "action": "ask" }
        ]);
        let auto_edit = serde_json::json!([
            { "permission": "edit", "pattern": "**", "action": "allow" },
            { "permission": "bash", "pattern": "*", "action": "ask" },
            { "permission": "webfetch", "pattern": "**", "action": "allow" },
            { "permission": "websearch", "pattern": "**", "action": "allow" },
            { "permission": "external_directory", "pattern": "**", "action": "ask" }
        ]);
        assert_eq!(ruleset_for_preset("ask"), ask);
        assert_eq!(ruleset_for_preset("auto-edit"), auto_edit);
        assert_eq!(ruleset_for_preset("full-auto"), full_auto_ruleset());
        // fail closed
        assert_eq!(ruleset_for_preset("yolo"), ask);
        assert_eq!(ruleset_for_preset(""), ask);
    }

    /// Pins the Rust side of the TS/Rust manual mirror: this JSON must equal
    /// `rulesetForPreset("full-auto")` in `src/features/agent/opencode.ts`
    /// rule-for-rule. A headless scheduled run with a weaker ruleset hangs
    /// forever on an approval nobody will give.
    #[test]
    fn full_auto_ruleset_mirrors_frontend_preset() {
        let expected = serde_json::json!([
            { "permission": "edit", "pattern": "**", "action": "allow" },
            { "permission": "bash", "pattern": "*", "action": "allow" },
            { "permission": "webfetch", "pattern": "**", "action": "allow" },
            { "permission": "websearch", "pattern": "**", "action": "allow" },
            { "permission": "external_directory", "pattern": "**", "action": "allow" },
            { "permission": "task", "pattern": "**", "action": "allow" }
        ]);
        assert_eq!(full_auto_ruleset(), expected);
    }

    #[test]
    fn extract_url_handles_junk_and_plain_lines() {
        assert_eq!(
            extract_url("opencode server listening on http://127.0.0.1:4096"),
            Some("http://127.0.0.1:4096".to_string())
        );
        // Trailing junk glued to the port is stripped, not rejected.
        assert_eq!(
            extract_url("listening on http://127.0.0.1:4096\u{1b}[0m"),
            Some("http://127.0.0.1:4096".to_string())
        );
        assert_eq!(extract_url("http://127.0.0.1:"), None);
        assert_eq!(extract_url("no url here"), None);
    }

    /// Guards the capability-flag regression: opencode >= 1.16 nests
    /// `attachment`/`reasoning` under `capabilities` (with `input.image`);
    /// older builds had them at the model's top level. Both must parse.
    #[test]
    fn parse_providers_reads_capabilities_old_and_new_schema() {
        let v = serde_json::json!({
            "providers": [{
                "id": "p",
                "name": "P",
                "models": {
                    "new-vision": { "name": "NV", "capabilities": {
                        "attachment": true, "reasoning": true,
                        "input": { "image": true }
                    }, "variants": {
                        "low": { "reasoningEffort": "low" },
                        "high": { "reasoningEffort": "high" }
                    }, "limit": { "context": 200000, "output": 8192 }},
                    "new-files-only": { "name": "NF", "capabilities": {
                        "attachment": true,
                        "input": { "image": false }
                    }},
                    "old-vision": { "name": "OV", "attachment": true, "reasoning": false },
                    "blind": { "name": "B", "capabilities": { "attachment": false } }
                }
            }]
        });
        let out = parse_providers(&v);
        let m = |id: &str| out[0].models.iter().find(|m| m.id == id).unwrap();
        assert!(m("new-vision").attachment);
        assert!(m("new-vision").reasoning);
        // Variant NAMES pass through (order normalized on the frontend).
        let mut variants = m("new-vision").variants.clone();
        variants.sort();
        assert_eq!(variants, vec!["high".to_string(), "low".into()]);
        assert!(m("blind").variants.is_empty());
        // attachment without image input is NOT vision (text-file attachments only)
        assert!(!m("new-files-only").attachment);
        assert!(m("old-vision").attachment);
        assert!(!m("blind").attachment);
        // Token windows pass through when present, None when the catalog has none.
        let limit = m("new-vision").limit.as_ref().unwrap();
        assert_eq!(limit.context, Some(200_000));
        assert_eq!(limit.output, Some(8_192));
        assert!(m("blind").limit.is_none());
    }
}
