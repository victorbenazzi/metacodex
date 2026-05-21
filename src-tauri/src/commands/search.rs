use crate::error::AppResult;
use crate::search::{search, SearchOptions, SearchResults};

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
