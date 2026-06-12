use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::projects::ProjectsCache;
use crate::search::{list_files as list_files_impl, search, SearchOptions, SearchResults};
use crate::util::paths;

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
    // Run in a blocking task so we don't tie up the tokio runtime.
    tokio::task::spawn_blocking(move || search(&root, &query, opts))
        .await
        .map_err(|e| crate::error::AppError::Other(format!("join: {e}")))?
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
