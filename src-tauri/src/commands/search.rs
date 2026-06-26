use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::projects::ProjectsCache;
use crate::search::{list_files as list_files_impl, search, SearchOptions, SearchResults};
use crate::util::paths;

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

/// Reject roots that aren't inside a registered project. Mirrors the guard every
/// other filesystem-touching command uses; search/list MUST honor the sandbox
/// or they become a read-anywhere primitive.
fn ensure_root_allowed(app: &AppHandle, root: &str) -> AppResult<()> {
    let cache = app.state::<Arc<ProjectsCache>>();
    let roots = cache.project_roots();
    if roots.is_empty() {
        return Err(AppError::PathNotAllowed(
            "no project roots registered yet".into(),
        ));
    }
    paths::ensure_within_roots(root, &roots)
}

#[tauri::command]
pub async fn search_in_project(
    app: AppHandle,
    registry: State<'_, Arc<SearchRegistry>>,
    root: String,
    query: String,
    options: Option<SearchOptions>,
) -> AppResult<SearchResults> {
    ensure_root_allowed(&app, &root)?;
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
    ensure_root_allowed(&app, &root)?;
    let limit = max.unwrap_or(20_000);
    tokio::task::spawn_blocking(move || list_files_impl(&root, limit))
        .await
        .map_err(|e| crate::error::AppError::Other(format!("join: {e}")))?
}
