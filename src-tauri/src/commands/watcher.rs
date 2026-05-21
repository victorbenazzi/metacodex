use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::error::AppResult;
use crate::watcher::WatcherManager;

#[tauri::command]
pub async fn watcher_watch(
    project_id: String,
    path: String,
    mgr: State<'_, Arc<WatcherManager>>,
) -> AppResult<()> {
    mgr.watch(project_id, PathBuf::from(path))
}

#[tauri::command]
pub async fn watcher_unwatch(
    project_id: String,
    mgr: State<'_, Arc<WatcherManager>>,
) -> AppResult<()> {
    mgr.unwatch(&project_id);
    Ok(())
}
