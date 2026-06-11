use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::agent::scheduler;
use crate::agent::{
    AgentRuntime, CronInput, CronStore, CronTask, FeaturedServerDef, McpServerEntry,
    McpServerInput, McpStore, ProviderModels, RuntimeStatus, SkillInfo,
};
use crate::error::{AppError, AppResult};
use crate::projects::ProjectsCache;

/// A scheduled task runs headless with the full-auto ruleset, so its directory
/// must stay inside a registered project root (the one place Rust brokers the
/// run and can enforce the invariant the chat path can't).
fn ensure_cron_directory(
    projects: &ProjectsCache,
    directory: Option<&str>,
) -> AppResult<()> {
    let Some(dir) = directory.filter(|d| !d.trim().is_empty()) else {
        return Ok(());
    };
    if projects.find_owner(dir).is_none() {
        return Err(AppError::Other(format!(
            "scheduled task directory {dir:?} is not inside a registered project"
        )));
    }
    Ok(())
}

/// Start (or reuse) the opencode runtime sidecar. Returns its health/base URL.
#[tauri::command]
pub async fn agent_runtime_start(
    runtime: State<'_, AgentRuntime>,
) -> AppResult<RuntimeStatus> {
    runtime.start().await
}

/// Current runtime status without forcing a start.
#[tauri::command]
pub async fn agent_runtime_status(
    runtime: State<'_, AgentRuntime>,
) -> AppResult<RuntimeStatus> {
    Ok(runtime.status())
}

/// Stop the runtime sidecar (reaps the opencode process). Serialized against
/// an in-flight start so a Stop during a spawn still lands.
#[tauri::command]
pub async fn agent_runtime_stop(runtime: State<'_, AgentRuntime>) -> AppResult<()> {
    runtime.stop_locked().await;
    Ok(())
}

/// Kill + respawn the sidecar so config changes (MCP servers) take effect.
/// User-triggered only; the new status carries a NEW base URL (`--port 0`).
#[tauri::command]
pub async fn agent_runtime_restart(runtime: State<'_, AgentRuntime>) -> AppResult<RuntimeStatus> {
    runtime.restart().await
}

/// List every provider + model available to the runtime, API keys stripped.
#[tauri::command]
pub async fn agent_list_models(
    runtime: State<'_, AgentRuntime>,
) -> AppResult<Vec<ProviderModels>> {
    runtime.list_models().await
}

/// Set an API-key credential for a provider (e.g. the opencode GO key).
#[tauri::command]
pub async fn agent_set_credentials(
    runtime: State<'_, AgentRuntime>,
    provider_id: String,
    key: String,
) -> AppResult<()> {
    runtime.set_credentials(&provider_id, &key).await
}

/// Inventory the Agent Skills discoverable on disk (opencode / claude / agents /
/// metacodex skill directories).
#[tauri::command]
pub async fn agent_list_skills() -> AppResult<Vec<SkillInfo>> {
    Ok(crate::agent::list_skills())
}

#[tauri::command]
pub async fn agent_cron_list(store: State<'_, CronStore>) -> AppResult<Vec<CronTask>> {
    Ok(store.list())
}

#[tauri::command]
pub async fn agent_cron_create(
    store: State<'_, CronStore>,
    projects: State<'_, Arc<ProjectsCache>>,
    input: CronInput,
) -> AppResult<CronTask> {
    ensure_cron_directory(&projects, input.directory.as_deref())?;
    store.create(input)
}

#[tauri::command]
pub async fn agent_cron_update(
    store: State<'_, CronStore>,
    projects: State<'_, Arc<ProjectsCache>>,
    id: String,
    input: CronInput,
) -> AppResult<CronTask> {
    ensure_cron_directory(&projects, input.directory.as_deref())?;
    store.update(&id, input)
}

#[tauri::command]
pub async fn agent_cron_delete(store: State<'_, CronStore>, id: String) -> AppResult<()> {
    store.delete(&id)
}

#[tauri::command]
pub async fn agent_cron_set_enabled(
    store: State<'_, CronStore>,
    id: String,
    enabled: bool,
) -> AppResult<()> {
    store.set_enabled(&id, enabled)
}

/// Run a scheduled task immediately (handy for testing a task definition).
#[tauri::command]
pub async fn agent_cron_run_now(
    app: AppHandle,
    store: State<'_, CronStore>,
    id: String,
) -> AppResult<()> {
    let task = store
        .get(&id)
        .ok_or_else(|| AppError::NotFound(format!("cron task {id}")))?;
    scheduler::fire(&app, &task).await
}

/// Result of an MCP registry mutation. `requires_restart` is true when a
/// sidecar is running with the previous config (the change only lands after
/// the user restarts it; mutations never restart silently).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpMutationResult {
    pub entry: Option<McpServerEntry>,
    pub requires_restart: bool,
}

/// MCP server registry (secrets redacted).
#[tauri::command]
pub async fn agent_mcp_list(store: State<'_, McpStore>) -> AppResult<Vec<McpServerEntry>> {
    Ok(store.list())
}

/// The ready-to-enable featured servers (web search: Brave, Exa).
#[tauri::command]
pub async fn agent_mcp_featured() -> AppResult<Vec<FeaturedServerDef>> {
    Ok(crate::agent::mcp::featured_catalog())
}

/// `running || starting`: a mutation landing while a spawn is in flight is
/// stale for the booting sidecar too (it may have already read the old config).
fn needs_restart(runtime: &AgentRuntime) -> bool {
    runtime.status().running || runtime.is_starting()
}

#[tauri::command]
pub async fn agent_mcp_upsert(
    store: State<'_, McpStore>,
    runtime: State<'_, AgentRuntime>,
    input: McpServerInput,
) -> AppResult<McpMutationResult> {
    let entry = store.upsert(input)?;
    Ok(McpMutationResult {
        entry: Some(entry),
        requires_restart: needs_restart(&runtime),
    })
}

#[tauri::command]
pub async fn agent_mcp_delete(
    store: State<'_, McpStore>,
    runtime: State<'_, AgentRuntime>,
    id: String,
) -> AppResult<McpMutationResult> {
    store.delete(&id)?;
    Ok(McpMutationResult {
        entry: None,
        requires_restart: needs_restart(&runtime),
    })
}

#[tauri::command]
pub async fn agent_mcp_set_enabled(
    store: State<'_, McpStore>,
    runtime: State<'_, AgentRuntime>,
    id: String,
    enabled: bool,
) -> AppResult<McpMutationResult> {
    store.set_enabled(&id, enabled)?;
    Ok(McpMutationResult {
        entry: None,
        requires_restart: needs_restart(&runtime),
    })
}

/// Live MCP status from the sidecar (`GET /mcp`), sanitized. `null` when the
/// sidecar is down or too old to expose the endpoint. `directory` scopes the
/// status to the active project instance.
#[tauri::command]
pub async fn agent_mcp_status(
    runtime: State<'_, AgentRuntime>,
    directory: Option<String>,
) -> AppResult<Option<serde_json::Value>> {
    runtime.mcp_status(directory.as_deref()).await
}

/// Read the Agent View UI state (`state/agent-ui.json`: composer drafts +
/// sidebar expansion). Schema-agnostic: an opaque JSON object owned by the
/// frontend, so its shape can evolve without a Rust recompile.
#[tauri::command]
pub async fn agent_ui_state_read() -> AppResult<serde_json::Value> {
    let path = crate::config_paths::agent_ui_state_file()?;
    let value = crate::config_paths::read_json::<serde_json::Value>(&path)?;
    Ok(if value.is_null() {
        serde_json::Value::Object(serde_json::Map::new())
    } else {
        value
    })
}

/// Persist the Agent View UI state (atomic tmp -> rename).
#[tauri::command]
pub async fn agent_ui_state_write(state: serde_json::Value) -> AppResult<()> {
    let path = crate::config_paths::agent_ui_state_file()?;
    crate::config_paths::write_json_atomic(&path, &state)
}
