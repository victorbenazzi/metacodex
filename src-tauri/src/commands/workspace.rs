use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::error::{AppError, AppResult};

const STORE_FILE: &str = "metacodex.store.json";

/// Per-project workspace state — only the parts safe to restore on reopen.
/// Terminals/CLI sessions are intentionally NOT persisted: spec says don't
/// auto-respawn shells on app start.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    #[serde(default)]
    pub open_tabs: Vec<SerializedTab>,
    #[serde(default)]
    pub active_tab_id: Option<String>,
    #[serde(default)]
    pub expanded_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedTab {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub mode: Option<String>,
}

fn key_for(project_id: &str) -> String {
    format!("workspaceState.{project_id}")
}

#[tauri::command]
pub async fn save_workspace_state(
    project_id: String,
    state: WorkspaceState,
    app: AppHandle,
) -> AppResult<()> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Store(format!("open store: {e}")))?;
    store.set(key_for(&project_id), json!(state));
    store
        .save()
        .map_err(|e| AppError::Store(format!("save store: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn load_workspace_state(
    project_id: String,
    app: AppHandle,
) -> AppResult<Option<WorkspaceState>> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Store(format!("open store: {e}")))?;
    let raw = store.get(key_for(&project_id)).unwrap_or(Value::Null);
    if raw.is_null() {
        return Ok(None);
    }
    let state = serde_json::from_value::<WorkspaceState>(raw)
        .map_err(|e| AppError::Store(format!("parse workspace state: {e}")))?;
    Ok(Some(state))
}
