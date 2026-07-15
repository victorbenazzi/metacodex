use tauri::AppHandle;

use crate::error::AppResult;
use crate::projects::{self, Project};
use crate::remote_access::{
    self, RemoteAccess, RemoteAccessDraft, RemoteAccessTestResult, RemoteProjectCandidate,
};

#[tauri::command]
pub async fn remote_access_list() -> AppResult<Vec<RemoteAccess>> {
    remote_access::list_accesses()
}

#[tauri::command]
pub async fn remote_access_save(draft: RemoteAccessDraft) -> AppResult<RemoteAccess> {
    remote_access::save_access(draft)
}

#[tauri::command]
pub async fn remote_access_remove(id: String) -> AppResult<()> {
    remote_access::remove_access(&id)
}

#[tauri::command]
pub async fn remote_access_test(
    draft: RemoteAccessDraft,
    trust_host: bool,
) -> AppResult<RemoteAccessTestResult> {
    tokio::task::spawn_blocking(move || remote_access::test_access(draft, trust_host))
        .await
        .map_err(|e| crate::error::AppError::Other(format!("join: {e}")))?
}

#[tauri::command]
pub async fn remote_discover_projects(access_id: String) -> AppResult<Vec<RemoteProjectCandidate>> {
    tokio::task::spawn_blocking(move || remote_access::discover_projects(&access_id))
        .await
        .map_err(|e| crate::error::AppError::Other(format!("join: {e}")))?
}

#[tauri::command]
pub async fn add_remote_project(
    access_id: String,
    path: String,
    name: Option<String>,
    app: AppHandle,
) -> AppResult<Project> {
    tokio::task::spawn_blocking(move || {
        let safe_path = remote_access::validate_project_candidate(&access_id, &path)?;
        projects::add_remote(&app, access_id, safe_path, name)
    })
    .await
    .map_err(|e| crate::error::AppError::Other(format!("join: {e}")))?
}
