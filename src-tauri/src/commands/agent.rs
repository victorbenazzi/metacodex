use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::agent::executor;
use crate::agent::scheduler;
use crate::agent::{
    AgentEntity, AgentEntityInput, AgentEntityStore, AgentRuntime, CronInput, CronStore,
    CronTask, FeaturedServerDef, McpServerEntry, McpServerInput, McpStore, ProviderModels,
    RuntimeStatus, SkillInfo,
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

/// A task bound to an agent must point at an EXISTING entity, and at a
/// directory that entity is allowed in; failing at save time beats a silent
/// `last_status: error` at fire time.
fn ensure_cron_agent(projects: &ProjectsCache, input: &CronInput) -> AppResult<()> {
    let Some(slug) = input.agent_id.as_deref().filter(|s| !s.trim().is_empty()) else {
        return Ok(());
    };
    let entity = executor::find_entity(slug)?;
    if let (Some(dir), Some(allowed)) = (
        input.directory.as_deref().filter(|d| !d.trim().is_empty()),
        entity.projects.as_ref(),
    ) {
        if let Some(owner) = projects.find_owner(dir) {
            if !allowed.contains(&owner.0) {
                return Err(AppError::Other(format!(
                    "agent {:?} is not allowed to work in project {:?}",
                    entity.id, owner.1
                )));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_cron_create(
    store: State<'_, CronStore>,
    projects: State<'_, Arc<ProjectsCache>>,
    input: CronInput,
) -> AppResult<CronTask> {
    ensure_cron_directory(&projects, input.directory.as_deref())?;
    ensure_cron_agent(&projects, &input)?;
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
    ensure_cron_agent(&projects, &input)?;
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

/// Agent entities (persistent agents living in `~/.metacodex/agents/`).
/// Mutations regenerate the OPENCODE_CONFIG layer; the frontend hot-applies
/// with `POST /global/dispose` on the sidecar (no restart needed: opencode
/// re-reads the config file when it builds the next directory instance).
#[tauri::command]
pub async fn agent_entity_list(
    store: State<'_, AgentEntityStore>,
) -> AppResult<Vec<AgentEntity>> {
    store.list()
}

#[tauri::command]
pub async fn agent_entity_create(
    store: State<'_, AgentEntityStore>,
    input: AgentEntityInput,
) -> AppResult<AgentEntity> {
    store.create(input)
}

#[tauri::command]
pub async fn agent_entity_update(
    store: State<'_, AgentEntityStore>,
    id: String,
    input: AgentEntityInput,
) -> AppResult<AgentEntity> {
    store.update(&id, input)
}

#[tauri::command]
pub async fn agent_entity_delete(
    store: State<'_, AgentEntityStore>,
    id: String,
) -> AppResult<()> {
    store.delete(&id)
}

/// ---- Agent entity life (phases 2-4): memory, activity, proposals ----
/// All paths derive from `entities::home_dir` (slug-validated), the same
/// SECURITY posture as `config_paths` (outside project roots by design).
use crate::agent::life;

/// The memory context block the chat injects as `system` on entity sends.
#[tauri::command]
pub async fn agent_entity_memory_context(
    id: String,
    directory: Option<String>,
) -> AppResult<String> {
    let home = crate::agent::entities::home_dir(&id)?;
    Ok(life::memory_context(&home, directory.as_deref()))
}

#[tauri::command]
pub async fn agent_entity_memory_tree(id: String) -> AppResult<life::MemoryTree> {
    let home = crate::agent::entities::home_dir(&id)?;
    Ok(life::memory_tree(&home))
}

#[tauri::command]
pub async fn agent_entity_memory_read(id: String, rel_path: String) -> AppResult<String> {
    let home = crate::agent::entities::home_dir(&id)?;
    life::memory_read(&home, &rel_path)
}

#[tauri::command]
pub async fn agent_entity_memory_write(
    id: String,
    rel_path: String,
    content: String,
) -> AppResult<()> {
    let home = crate::agent::entities::home_dir(&id)?;
    let lock = crate::agent::entities::state_mutex(&id);
    let _guard = lock.lock();
    life::memory_write(&home, &rel_path, &content)?;
    if let Err(e) = crate::agent::entities::checkpoint(&home, "edit memory") {
        eprintln!("[metacodex] agent git checkpoint failed for {id}: {e}");
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_entity_memory_delete(id: String, rel_path: String) -> AppResult<()> {
    let home = crate::agent::entities::home_dir(&id)?;
    let lock = crate::agent::entities::state_mutex(&id);
    let _guard = lock.lock();
    life::memory_delete(&home, &rel_path)?;
    if let Err(e) = crate::agent::entities::checkpoint(&home, "delete memory") {
        eprintln!("[metacodex] agent git checkpoint failed for {id}: {e}");
    }
    Ok(())
}

/// The standing heartbeat checklist (HEARTBEAT.md), editable from the Agenda tab.
#[tauri::command]
pub async fn agent_entity_heartbeat_read(id: String) -> AppResult<String> {
    let home = crate::agent::entities::home_dir(&id)?;
    Ok(life::heartbeat_read(&home))
}

#[tauri::command]
pub async fn agent_entity_heartbeat_write(id: String, content: String) -> AppResult<()> {
    let home = crate::agent::entities::home_dir(&id)?;
    let lock = crate::agent::entities::state_mutex(&id);
    let _guard = lock.lock();
    life::heartbeat_write(&home, &content)?;
    if let Err(e) = crate::agent::entities::checkpoint(&home, "edit heartbeat checklist") {
        eprintln!("[metacodex] agent git checkpoint failed for {id}: {e}");
    }
    Ok(())
}

/// Live status per entity (slug -> "working" | "needs-you"; absent = idle),
/// polled by the agents list while it is visible.
#[tauri::command]
pub async fn agent_entity_status() -> AppResult<std::collections::HashMap<String, String>> {
    Ok(executor::entity_status_map())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivity {
    pub reports: Vec<life::ReportInfo>,
    pub runs: Vec<life::RunLogEntry>,
}

#[tauri::command]
pub async fn agent_entity_activity(id: String) -> AppResult<AgentActivity> {
    let home = crate::agent::entities::home_dir(&id)?;
    Ok(AgentActivity {
        reports: life::list_reports(&home, 50),
        runs: life::recent_runs(&home, 50),
    })
}

#[tauri::command]
pub async fn agent_entity_proposals(id: String) -> AppResult<Vec<life::ProposalInfo>> {
    let home = crate::agent::entities::home_dir(&id)?;
    Ok(life::list_proposals(&home))
}

/// Approve / reject a proposal (the human gate of self-improvement). Approving
/// a persona proposal rewrites AGENT.md, so the opencode config layer must
/// regenerate (the frontend hot-applies with the usual dispose).
#[tauri::command]
pub async fn agent_entity_proposal_resolve(
    id: String,
    file: String,
    approve: bool,
    reason: Option<String>,
) -> AppResult<()> {
    let home = crate::agent::entities::home_dir(&id)?;
    {
        // The double-resolve gate inside resolve_proposal is read-check-write;
        // the per-entity mutex makes it atomic against a second click or a
        // concurrent execution's bookkeeping.
        let lock = crate::agent::entities::state_mutex(&id);
        let _guard = lock.lock();
        life::resolve_proposal(&home, &file, approve, reason.as_deref())?;
        if let Err(e) = crate::agent::entities::checkpoint(
            &home,
            if approve { "approve proposal" } else { "reject proposal" },
        ) {
            eprintln!("[metacodex] agent git checkpoint failed for {id}: {e}");
        }
    }
    if approve {
        crate::agent::mcp::regenerate_opencode_config()?;
    }
    Ok(())
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
