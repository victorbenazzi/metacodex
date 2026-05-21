use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
pub struct CliDetectResult {
    pub installed: bool,
    pub path: Option<String>,
}

#[tauri::command]
pub async fn cli_detect(command: String) -> AppResult<CliDetectResult> {
    Ok(match which::which(&command) {
        Ok(p) => CliDetectResult {
            installed: true,
            path: Some(p.display().to_string()),
        },
        Err(_) => CliDetectResult {
            installed: false,
            path: None,
        },
    })
}
