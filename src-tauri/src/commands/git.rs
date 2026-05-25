use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::git::{file_head_content, git_info, GitInfo};
use crate::projects::ProjectsCache;
use crate::util::paths;

#[tauri::command]
pub async fn git_status(app: AppHandle, root: String) -> AppResult<Option<GitInfo>> {
    {
        let cache = app.state::<Arc<ProjectsCache>>();
        let roots = cache.project_roots();
        if roots.is_empty() {
            return Err(AppError::PathNotAllowed(
                "no project roots registered yet".into(),
            ));
        }
        paths::ensure_within_roots(&root, &roots)?;
    }
    tokio::task::spawn_blocking(move || git_info(&root))
        .await
        .map_err(|e| AppError::Other(format!("join: {e}")))?
}

/// Committed (HEAD) text of a file, for the editor's change gutter. Read-only.
#[tauri::command]
pub async fn git_file_head_content(app: AppHandle, path: String) -> AppResult<Option<String>> {
    {
        let cache = app.state::<Arc<ProjectsCache>>();
        let roots = cache.project_roots();
        if roots.is_empty() {
            return Err(AppError::PathNotAllowed(
                "no project roots registered yet".into(),
            ));
        }
        paths::ensure_within_roots(&path, &roots)?;
    }
    tokio::task::spawn_blocking(move || file_head_content(&path))
        .await
        .map_err(|e| AppError::Other(format!("join: {e}")))?
}
