use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::projects::ProjectsCache;
use crate::util::paths;
use crate::watcher::WatcherManager;

/// Watcher setup/teardown joins the FSEvents run-loop thread on macOS, which
/// can briefly block. Run it on the blocking pool so a watch/unwatch during a
/// project switch can't stall an async IPC worker that also pumps PTY data.
async fn blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("join: {e}")))?
}

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
    let mgr = mgr.inner().clone();
    blocking(move || mgr.watch(project.id, root)).await
}

#[tauri::command]
pub async fn watcher_unwatch(
    project_id: String,
    mgr: State<'_, Arc<WatcherManager>>,
) -> AppResult<()> {
    let mgr = mgr.inner().clone();
    blocking(move || {
        mgr.unwatch(&project_id);
        Ok(())
    })
    .await
}
