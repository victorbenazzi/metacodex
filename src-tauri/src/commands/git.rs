use crate::error::{AppError, AppResult};
use crate::git::{git_info, GitInfo};

#[tauri::command]
pub async fn git_status(root: String) -> AppResult<Option<GitInfo>> {
    tokio::task::spawn_blocking(move || git_info(&root))
        .await
        .map_err(|e| AppError::Other(format!("join: {e}")))?
}
