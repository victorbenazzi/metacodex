use chrono::Utc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

use crate::error::{AppError, AppResult};

const STORE_FILE: &str = "metacodex.store.json";
const KEY_PROJECTS: &str = "projects";
const KEY_ACTIVE: &str = "lastActiveProjectId";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: String,
    pub icon: String,
    pub created_at: String,
    pub last_opened_at: String,
}

/// In-memory cache of the project list, kept in sync with the persisted store.
/// Used by other modules (e.g. fs commands) to validate path containment without
/// re-reading the JSON file on every request.
#[derive(Default)]
pub struct ProjectsCache {
    inner: RwLock<Vec<Project>>,
}

impl ProjectsCache {
    pub fn replace(&self, projects: Vec<Project>) {
        *self.inner.write() = projects;
    }
    pub fn snapshot(&self) -> Vec<Project> {
        self.inner.read().clone()
    }
    pub fn project_roots(&self) -> Vec<String> {
        self.inner.read().iter().map(|p| p.path.clone()).collect()
    }
}

/// Read the persisted projects (and active id) from disk and warm the cache.
/// Also runs a one-shot color migration so projects created against a prior
/// palette pick up the current swatch for their hue.
pub fn hydrate(app: &AppHandle) -> AppResult<()> {
    let mut projects = load_projects(app)?;
    let mut mutated = false;
    for p in projects.iter_mut() {
        if let Some(migrated) = migrate_color(&p.color) {
            p.color = migrated;
            mutated = true;
        }
    }
    if mutated {
        save_projects(app, &projects)?;
    }
    let cache = app.state::<Arc<ProjectsCache>>();
    cache.replace(projects);
    Ok(())
}

fn load_projects(app: &AppHandle) -> AppResult<Vec<Project>> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Store(format!("open store: {e}")))?;
    let raw = store.get(KEY_PROJECTS).unwrap_or(Value::Null);
    if raw.is_null() {
        return Ok(Vec::new());
    }
    serde_json::from_value::<Vec<Project>>(raw)
        .map_err(|e| AppError::Store(format!("parse projects: {e}")))
}

fn save_projects(app: &AppHandle, projects: &[Project]) -> AppResult<()> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Store(format!("open store: {e}")))?;
    store.set(KEY_PROJECTS, json!(projects));
    store
        .save()
        .map_err(|e| AppError::Store(format!("save store: {e}")))?;
    Ok(())
}

fn save_active(app: &AppHandle, id: Option<&str>) -> AppResult<()> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Store(format!("open store: {e}")))?;
    match id {
        Some(s) => store.set(KEY_ACTIVE, json!(s)),
        None => store.set(KEY_ACTIVE, Value::Null),
    }
    store
        .save()
        .map_err(|e| AppError::Store(format!("save store: {e}")))?;
    Ok(())
}

/// Generate a 12-char id similar to nanoid.
fn new_id() -> String {
    use uuid::Uuid;
    Uuid::new_v4().to_string().replace('-', "").chars().take(12).collect()
}

/// Canonical (light-theme) hex for each accent. Must match the `hex` column
/// of `PROJECT_PALETTE` in `src/features/projects/project.types.ts`.
const PALETTE: [&str; 12] = [
    "#8a7d63", // stone
    "#a85040", // terracotta
    "#b87420", // amber
    "#828c3f", // olive
    "#4a9070", // sage
    "#2e7892", // ocean
    "#4658a8", // indigo
    "#7a52a8", // lavender
    "#a3548b", // mauve
    "#bb4565", // rose
    "#6a6e75", // cool gray
    "#5d5c46", // deep olive
];

/// Map every retired palette entry to its closest counterpart in the current
/// one. Returns Some(new_hex) only when migration is needed.
fn migrate_color(current: &str) -> Option<String> {
    let lower = current.to_lowercase();
    // (old hex, new canonical hex)
    const MIGRATIONS: &[(&str, &str)] = &[
        // First-ever palette (8 muted tones)
        ("#7c7666", "#8a7d63"), // stone -> stone
        ("#8a6f4c", "#a85040"), // brown -> terracotta
        ("#6f7a6a", "#4a9070"), // muted sage -> sage
        ("#7a6470", "#7a52a8"), // muted plum -> lavender
        ("#5f6e7a", "#2e7892"), // muted slate -> ocean
        ("#806a5a", "#b87420"), // muted warm -> amber
        ("#6a6b6f", "#6a6e75"), // cool gray -> cool gray
        ("#73716a", "#5d5c46"), // taupe -> deep olive
        // Second palette (12 entries, slightly desaturated)
        ("#9b5d4b", "#a85040"),
        ("#b07a3a", "#b87420"),
        ("#7d8a48", "#828c3f"),
        ("#4e8a6c", "#4a9070"),
        ("#3f7c93", "#2e7892"),
        ("#566ca8", "#4658a8"),
        ("#7d5fa5", "#7a52a8"),
        ("#a05c87", "#a3548b"),
        ("#c0556b", "#bb4565"),
        ("#5c5c50", "#5d5c46"),
    ];
    for (old, new) in MIGRATIONS {
        if lower == *old {
            return Some((*new).to_string());
        }
    }
    None
}

fn assign_color(existing: &[Project]) -> String {
    PALETTE[existing.len() % PALETTE.len()].to_string()
}

fn basename(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

pub fn add(app: &AppHandle, path: String) -> AppResult<Project> {
    let path = path.trim_end_matches('/').to_string();
    // Guard: reject empty / non-existent paths
    if path.is_empty() {
        return Err(AppError::Other("empty path".into()));
    }
    if !std::path::Path::new(&path).is_dir() {
        return Err(AppError::NotFound(format!("not a directory: {path}")));
    }

    let mut projects = load_projects(app)?;
    if let Some(existing) = projects.iter().find(|p| p.path == path) {
        // Refresh last_opened_at and return the existing entry — opening the same
        // folder twice should not create duplicates.
        let id = existing.id.clone();
        let now = Utc::now().to_rfc3339();
        for p in projects.iter_mut() {
            if p.id == id {
                p.last_opened_at = now.clone();
            }
        }
        save_projects(app, &projects)?;
        app.state::<Arc<ProjectsCache>>().replace(projects.clone());
        return Ok(projects.into_iter().find(|p| p.id == id).unwrap());
    }

    let now = Utc::now().to_rfc3339();
    let project = Project {
        id: new_id(),
        name: basename(&path),
        path: path.clone(),
        color: assign_color(&projects),
        icon: "Folder".into(),
        created_at: now.clone(),
        last_opened_at: now,
    };
    projects.push(project.clone());
    save_projects(app, &projects)?;
    app.state::<Arc<ProjectsCache>>().replace(projects);
    Ok(project)
}

pub fn remove(app: &AppHandle, id: &str) -> AppResult<()> {
    let mut projects = load_projects(app)?;
    let initial = projects.len();
    projects.retain(|p| p.id != id);
    if projects.len() == initial {
        return Err(AppError::NotFound(format!("project {id}")));
    }
    save_projects(app, &projects)?;
    app.state::<Arc<ProjectsCache>>().replace(projects);

    // If the removed project was active, clear it.
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Store(format!("open store: {e}")))?;
    if let Some(Value::String(active)) = store.get(KEY_ACTIVE) {
        if active == id {
            save_active(app, None)?;
        }
    }
    Ok(())
}

pub fn rename(app: &AppHandle, id: &str, name: String) -> AppResult<Project> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Other("name cannot be empty".into()));
    }
    let mut projects = load_projects(app)?;
    let found_idx = projects
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound(format!("project {id}")))?;
    projects[found_idx].name = trimmed;
    save_projects(app, &projects)?;
    app.state::<Arc<ProjectsCache>>().replace(projects.clone());
    Ok(projects.into_iter().nth(found_idx).unwrap())
}

pub fn update_meta(
    app: &AppHandle,
    id: &str,
    color: Option<String>,
    icon: Option<String>,
) -> AppResult<Project> {
    let mut projects = load_projects(app)?;
    let found_idx = projects
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound(format!("project {id}")))?;
    if let Some(c) = color {
        projects[found_idx].color = c;
    }
    if let Some(i) = icon {
        projects[found_idx].icon = i;
    }
    save_projects(app, &projects)?;
    app.state::<Arc<ProjectsCache>>().replace(projects.clone());
    Ok(projects.into_iter().nth(found_idx).unwrap())
}

pub fn list(app: &AppHandle) -> AppResult<Vec<Project>> {
    load_projects(app)
}

/// Persist a new order for the project rail. `ordered_ids` must contain every
/// existing project id exactly once — any mismatch is rejected so the cache
/// can't get out of sync with the persisted set.
pub fn reorder(app: &AppHandle, ordered_ids: Vec<String>) -> AppResult<Vec<Project>> {
    let projects = load_projects(app)?;

    if ordered_ids.len() != projects.len() {
        return Err(AppError::Other(format!(
            "reorder: expected {} ids, got {}",
            projects.len(),
            ordered_ids.len()
        )));
    }

    let mut reordered: Vec<Project> = Vec::with_capacity(projects.len());
    for id in &ordered_ids {
        let found = projects
            .iter()
            .find(|p| &p.id == id)
            .ok_or_else(|| AppError::NotFound(format!("project {id}")))?;
        reordered.push(found.clone());
    }

    save_projects(app, &reordered)?;
    app.state::<Arc<ProjectsCache>>().replace(reordered.clone());
    Ok(reordered)
}

pub fn set_active(app: &AppHandle, id: &str) -> AppResult<()> {
    let mut projects = load_projects(app)?;
    let found_idx = projects
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound(format!("project {id}")))?;
    projects[found_idx].last_opened_at = Utc::now().to_rfc3339();
    save_projects(app, &projects)?;
    app.state::<Arc<ProjectsCache>>().replace(projects);
    save_active(app, Some(id))?;
    Ok(())
}

pub fn get_active_id(app: &AppHandle) -> AppResult<Option<String>> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Store(format!("open store: {e}")))?;
    Ok(match store.get(KEY_ACTIVE) {
        Some(Value::String(s)) => Some(s),
        _ => None,
    })
}
