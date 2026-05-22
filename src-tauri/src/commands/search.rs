use crate::error::AppResult;
use crate::search::{list_files as list_files_impl, search, SearchOptions, SearchResults};

#[tauri::command]
pub async fn search_in_project(
    root: String,
    query: String,
    options: Option<SearchOptions>,
) -> AppResult<SearchResults> {
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
pub async fn list_files(root: String, max: Option<usize>) -> AppResult<Vec<String>> {
    let limit = max.unwrap_or(20_000);
    tokio::task::spawn_blocking(move || list_files_impl(&root, limit))
        .await
        .map_err(|e| crate::error::AppError::Other(format!("join: {e}")))?
}
