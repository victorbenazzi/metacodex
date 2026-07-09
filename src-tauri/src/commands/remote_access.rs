use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::error::{AppError, AppResult};
use crate::projects::{self, Project};
use crate::remote_access::{
    self, RemoteAccess, RemoteAccessDraft, RemoteAccessTestResult, RemoteProjectCandidate,
};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProjectSelection {
    pub path: String,
    pub name: Option<String>,
}

fn file_path_to_string(path: FilePath) -> AppResult<String> {
    let path = path
        .into_path()
        .map_err(|e| AppError::Other(format!("dialog path: {e}")))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn remote_access_list() -> AppResult<Vec<RemoteAccess>> {
    remote_access::list_accesses()
}

#[tauri::command]
pub async fn remote_access_pick_identity_file(
    title: String,
    app: AppHandle,
) -> AppResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_title(title);
    if let Some(home) = dirs::home_dir() {
        let ssh_dir = home.join(".ssh");
        if ssh_dir.is_dir() {
            dialog = dialog.set_directory(ssh_dir);
        }
    }
    dialog.pick_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = rx
        .await
        .map_err(|e| AppError::Other(format!("dialog cancelled: {e}")))?;
    picked.map(file_path_to_string).transpose()
}

#[tauri::command]
pub async fn remote_access_save(draft: RemoteAccessDraft) -> AppResult<RemoteAccess> {
    remote_access::save_access(draft)
}

#[tauri::command]
pub async fn remote_access_remove(id: String) -> AppResult<()> {
    let dependent_count = projects::remote_dependency_count(&id)?;
    if dependent_count > 0 {
        return Err(AppError::Other(format!(
            "remove remote projects before deleting this SSH access ({dependent_count} projects use it)"
        )));
    }
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

#[tauri::command]
pub async fn add_remote_projects(
    access_id: String,
    selections: Vec<RemoteProjectSelection>,
    app: AppHandle,
) -> AppResult<Vec<Project>> {
    tokio::task::spawn_blocking(move || {
        let mut requested = Vec::<(String, Option<String>)>::new();
        for project in selections {
            let path = remote_access::normalize_remote_path(&project.path)?;
            if requested
                .iter()
                .all(|(existing, _): &(String, Option<String>)| existing != &path)
            {
                requested.push((path, project.name));
            }
        }

        let paths = requested
            .iter()
            .map(|(path, _)| path.clone())
            .collect::<Vec<_>>();
        let safe_paths = remote_access::validate_project_candidates(&access_id, &paths)?;
        let entries = safe_paths
            .into_iter()
            .filter_map(|safe_path| {
                requested
                    .iter()
                    .find(|(path, _)| path == &safe_path)
                    .map(|(_, name)| (safe_path, name.clone()))
            })
            .collect::<Vec<_>>();
        projects::add_remote_many(&app, access_id, entries)
    })
    .await
    .map_err(|e| crate::error::AppError::Other(format!("join: {e}")))?
}
