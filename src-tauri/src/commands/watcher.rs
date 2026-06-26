use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::projects::ProjectsCache;
use crate::util::paths;
use crate::watcher::WatcherManager;

#[tauri::command]
pub async fn watcher_watch(
    project_id: String,
    path: String,
    mgr: State<'_, Arc<WatcherManager>>,
    projects: State<'_, Arc<ProjectsCache>>,
) -> AppResult<()> {
    let project = projects
        .snapshot()
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::NotFound(format!("project {project_id}")))?;
    let requested = PathBuf::from(path);
    let root = PathBuf::from(&project.path);
    if !(paths::is_within(&root, &requested) && paths::is_within(&requested, &root)) {
        return Err(AppError::PathNotAllowed(requested.display().to_string()));
    }
    mgr.watch(project.id, root)
}

#[tauri::command]
pub async fn watcher_unwatch(
    project_id: String,
    mgr: State<'_, Arc<WatcherManager>>,
) -> AppResult<()> {
    mgr.unwatch(&project_id);
    Ok(())
}
