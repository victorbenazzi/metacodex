use serde::{Deserialize, Serialize};

use crate::config_paths;
use crate::error::AppResult;

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

/// Persist a project's workspace state to `~/.metacodex/state/workspace/{id}.json`.
#[tauri::command]
pub async fn save_workspace_state(project_id: String, state: WorkspaceState) -> AppResult<()> {
    let path = config_paths::workspace_file(&project_id)?;
    config_paths::write_json_atomic(&path, &state)
}

/// Load a project's workspace state. Returns `None` when the project has no
/// saved state yet (the file is absent).
#[tauri::command]
pub async fn load_workspace_state(project_id: String) -> AppResult<Option<WorkspaceState>> {
    let path = config_paths::workspace_file(&project_id)?;
    config_paths::read_json_opt::<WorkspaceState>(&path)
}
