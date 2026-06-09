use tauri::{AppHandle, State};

use crate::agent::scheduler;
use crate::agent::{AgentRuntime, CronStore, CronTask, NewCronTask, ProviderModels, RuntimeStatus, SkillInfo};
use crate::error::{AppError, AppResult};

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

/// Stop the runtime sidecar (reaps the opencode process).
#[tauri::command]
pub async fn agent_runtime_stop(runtime: State<'_, AgentRuntime>) -> AppResult<()> {
    runtime.stop();
    Ok(())
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
    input: NewCronTask,
) -> AppResult<CronTask> {
    let now = chrono::Utc::now().timestamp_millis();
    Ok(store.create(input, now))
}

#[tauri::command]
pub async fn agent_cron_delete(store: State<'_, CronStore>, id: String) -> AppResult<()> {
    store.delete(&id);
    Ok(())
}

#[tauri::command]
pub async fn agent_cron_set_enabled(
    store: State<'_, CronStore>,
    id: String,
    enabled: bool,
) -> AppResult<()> {
    store.set_enabled(&id, enabled);
    Ok(())
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
