use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;
use tauri::{AppHandle, Manager, State};

use crate::error::AppResult;
use crate::projects::ProjectsCache;
use crate::search::{list_files as list_files_impl, search, SearchOptions, SearchResults};

#[derive(Default)]
pub struct SearchRegistry {
    by_root: Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>,
}

impl SearchRegistry {
    fn start(&self, root: &str) -> Arc<AtomicBool> {
        let mut guard = self.by_root.lock();
        if let Some(prev) = guard.insert(root.to_string(), Arc::new(AtomicBool::new(false))) {
            prev.store(true, Ordering::SeqCst);
        }
        guard.get(root).cloned().expect("token inserted")
    }

    fn finish(&self, root: &str, token: &Arc<AtomicBool>) {
        let mut guard = self.by_root.lock();
        if guard
            .get(root)
            .map(|current| Arc::ptr_eq(current, token))
            .unwrap_or(false)
        {
            guard.remove(root);
        }
    }
}

#[tauri::command]
pub async fn search_in_project(
    app: AppHandle,
    registry: State<'_, Arc<SearchRegistry>>,
    root: String,
    query: String,
    options: Option<SearchOptions>,
) -> AppResult<SearchResults> {
    // Search/list MUST honor path authorization or they become a read-anywhere primitive.
    app.state::<Arc<ProjectsCache>>()
        .require_within_project_roots(&root)?;
    let opts = options.unwrap_or(SearchOptions {
        case_sensitive: false,
        whole_word: false,
        regex: false,
        max_matches: 500,
    });
    let token = registry.start(&root);
    let registry_for_finish = registry.inner().clone();
    let root_for_finish = root.clone();
    let token_for_finish = token.clone();
    // Run in a blocking task so we don't tie up the tokio runtime.
    let result = tokio::task::spawn_blocking(move || search(&root, &query, opts, Some(token)))
        .await
        .map_err(|e| crate::error::AppError::Other(format!("join: {e}")))?;
    registry_for_finish.finish(&root_for_finish, &token_for_finish);
    result
}

/// Flat list of files in a project, for the command palette's go-to-file.
#[tauri::command]
pub async fn list_files(app: AppHandle, root: String, max: Option<usize>) -> AppResult<Vec<String>> {
    app.state::<Arc<ProjectsCache>>()
        .require_within_project_roots(&root)?;
    let limit = max.unwrap_or(20_000);
    tokio::task::spawn_blocking(move || list_files_impl(&root, limit))
        .await
        .map_err(|e| crate::error::AppError::Other(format!("join: {e}")))?
}
