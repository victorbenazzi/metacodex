use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config_paths;
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    #[serde(default)]
    pub open_tabs: Vec<SerializedTab>,
    #[serde(default)]
    pub active_tab_id: Option<String>,
    #[serde(default)]
    pub expanded_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedWorkspace {
    #[serde(default)]
    revision: u64,
    #[serde(flatten)]
    state: WorkspaceState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLoadResult {
    pub revision: u64,
    #[serde(flatten)]
    pub state: WorkspaceState,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorkspaceSaveResult {
    Accepted { revision: u64 },
    Stale { accepted_revision: u64 },
}

pub struct WorkspaceStore {
    accepted: Mutex<HashMap<String, u64>>,
    workspace_dir: Option<PathBuf>,
}

impl Default for WorkspaceStore {
    fn default() -> Self {
        Self {
            accepted: Mutex::new(HashMap::new()),
            workspace_dir: None,
        }
    }
}

impl WorkspaceStore {
    fn path(&self, project_id: &str) -> AppResult<PathBuf> {
        if let Some(dir) = &self.workspace_dir {
            return Ok(dir.join(format!("{project_id}.json")));
        }
        config_paths::workspace_file(project_id)
    }

    #[cfg(test)]
    fn at(workspace_dir: PathBuf) -> Self {
        Self {
            accepted: Mutex::new(HashMap::new()),
            workspace_dir: Some(workspace_dir),
        }
    }

    pub fn save(
        &self,
        project_id: &str,
        revision: u64,
        state: WorkspaceState,
    ) -> AppResult<WorkspaceSaveResult> {
        let mut accepted = self.accepted.lock();
        let accepted_revision = match accepted.get(project_id).copied() {
            Some(value) => value,
            None => {
                let path = self.path(project_id)?;
                let value = config_paths::read_json_opt::<PersistedWorkspace>(&path)?
                    .map(|saved| saved.revision)
                    .unwrap_or(0);
                accepted.insert(project_id.to_string(), value);
                value
            }
        };
        if revision < accepted_revision {
            return Ok(WorkspaceSaveResult::Stale { accepted_revision });
        }
        let path = self.path(project_id)?;
        config_paths::write_json_atomic(&path, &PersistedWorkspace { revision, state })?;
        accepted.insert(project_id.to_string(), revision);
        Ok(WorkspaceSaveResult::Accepted { revision })
    }

    pub fn load(&self, project_id: &str) -> AppResult<Option<WorkspaceLoadResult>> {
        let path = self.path(project_id)?;
        let saved = config_paths::read_json_opt::<PersistedWorkspace>(&path)?;
        if let Some(saved) = saved {
            self.accepted
                .lock()
                .insert(project_id.to_string(), saved.revision);
            Ok(Some(WorkspaceLoadResult {
                revision: saved.revision,
                state: saved.state,
            }))
        } else {
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn save_workspace_state(
    store: State<'_, Arc<WorkspaceStore>>,
    project_id: String,
    revision: u64,
    state: WorkspaceState,
) -> AppResult<WorkspaceSaveResult> {
    store.save(&project_id, revision, state)
}

#[tauri::command]
pub async fn load_workspace_state(
    store: State<'_, Arc<WorkspaceStore>>,
    project_id: String,
) -> AppResult<Option<WorkspaceLoadResult>> {
    store.load(&project_id)
}

#[cfg(test)]
mod tests {
    use super::{WorkspaceSaveResult, WorkspaceState, WorkspaceStore};

    fn project_id(name: &str) -> String {
        format!("{name}-{}", uuid::Uuid::new_v4())
    }

    fn store() -> (WorkspaceStore, std::path::PathBuf) {
        let dir =
            std::env::temp_dir().join(format!("metacodex-workspace-{}", uuid::Uuid::new_v4()));
        (WorkspaceStore::at(dir.clone()), dir)
    }

    fn state(active: &str) -> WorkspaceState {
        WorkspaceState {
            active_tab_id: Some(active.into()),
            ..WorkspaceState::default()
        }
    }

    #[test]
    fn stale_revision_cannot_replace_newer_state() {
        let (store, dir) = store();
        let id = project_id("stale");
        assert_eq!(
            store.save(&id, 2, state("new")).unwrap(),
            WorkspaceSaveResult::Accepted { revision: 2 }
        );
        assert_eq!(
            store.save(&id, 1, state("old")).unwrap(),
            WorkspaceSaveResult::Stale {
                accepted_revision: 2
            }
        );
        let loaded = store.load(&id).unwrap().unwrap();
        assert_eq!(loaded.revision, 2);
        assert_eq!(loaded.state.active_tab_id.as_deref(), Some("new"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn loads_revisionless_fixture_as_revision_zero() {
        let (store, dir) = store();
        let id = project_id("legacy");
        let path = dir.join(format!("{id}.json"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"openTabs":[],"activeTabId":"legacy","expandedPaths":[]}"#,
        )
        .unwrap();
        let loaded = store.load(&id).unwrap().unwrap();
        assert_eq!(loaded.revision, 0);
        assert_eq!(loaded.state.active_tab_id.as_deref(), Some("legacy"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
