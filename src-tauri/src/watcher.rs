use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

pub const EV_FS_CHANGED: &str = "fs://changed";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsChangedPayload {
    pub project_id: String,
    pub paths: Vec<String>,
}

/// One file watcher per project root, owned in a hashmap. Dropping a debouncer
/// releases its OS-level watcher.
pub struct WatcherManager {
    by_project: Mutex<HashMap<String, Debouncer<notify::RecommendedWatcher>>>,
    app_handle: AppHandle,
}

impl WatcherManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            by_project: Mutex::new(HashMap::new()),
            app_handle,
        }
    }

    pub fn watch(&self, project_id: String, path: PathBuf) -> AppResult<()> {
        // If we're already watching this project, refresh by dropping the old one first.
        self.by_project.lock().remove(&project_id);

        let app = self.app_handle.clone();
        let pid = project_id.clone();
        let mut debouncer = new_debouncer(
            Duration::from_millis(250),
            move |res: DebounceEventResult| {
                let events = match res {
                    Ok(events) => events,
                    Err(err) => {
                        eprintln!("[watcher] error: {err}");
                        return;
                    }
                };
                if events.is_empty() {
                    return;
                }
                let mut paths: Vec<String> = events
                    .iter()
                    .map(|e| e.path.display().to_string())
                    .collect();
                paths.sort();
                paths.dedup();
                let _ = app.emit(
                    EV_FS_CHANGED,
                    FsChangedPayload {
                        project_id: pid.clone(),
                        paths,
                    },
                );
            },
        )
        .map_err(|e| AppError::Other(format!("notify debouncer: {e}")))?;

        debouncer
            .watcher()
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|e| AppError::Other(format!("watch {}: {e}", path.display())))?;

        self.by_project.lock().insert(project_id, debouncer);
        Ok(())
    }

    pub fn unwatch(&self, project_id: &str) {
        self.by_project.lock().remove(project_id);
    }
}

pub type SharedWatcher = Arc<WatcherManager>;
