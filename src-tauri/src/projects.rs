use chrono::Utc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

use crate::config_paths;
use crate::error::{AppError, AppResult};

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

/// On-disk shape of `~/.metacodex/state/projects.json`: the registry plus the
/// last-active id co-located in one document (so they stay atomic together).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProjectsFile {
    #[serde(default)]
    projects: Vec<Project>,
    #[serde(default)]
    last_active_project_id: Option<String>,
}

/// In-memory cache of the project list, kept in sync with the persisted file.
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

    /// Path authorization: target must sit inside a registered Project root.
    /// Empty registry denies. See `util::paths::require_within_project_roots`.
    pub fn require_within_project_roots(&self, path: &str) -> AppResult<()> {
        crate::util::paths::require_within_project_roots(&self.project_roots(), path)
    }

    /// Path authorization against one Project by id (NotFound if unknown id).
    pub fn require_within_project(&self, project_id: &str, path: &str) -> AppResult<()> {
        let root = {
            let guard = self.inner.read();
            guard
                .iter()
                .find(|p| p.id == project_id)
                .map(|p| p.path.clone())
        };
        let root = root.ok_or_else(|| AppError::NotFound(format!("project {project_id}")))?;
        crate::util::paths::require_within_project(&root, path)
    }

    /// Find the project (id, path) whose root is a prefix of `path`. Picks the
    /// longest matching root in case the user has registered nested folders.
    /// Returns `None` when no project owns the path.
    pub fn find_owner(&self, path: &str) -> Option<(String, String)> {
        let normalized = crate::util::paths::normalize(std::path::Path::new(path));
        let mut best: Option<(String, String, usize)> = None;
        for p in self.inner.read().iter() {
            let root = crate::util::paths::normalize(std::path::Path::new(&p.path));
            if normalized == root || normalized.starts_with(&root) {
                let depth = root.components().count();
                if best.as_ref().map(|(_, _, d)| depth > *d).unwrap_or(true) {
                    best = Some((p.id.clone(), p.path.clone(), depth));
                }
            }
        }
        best.map(|(id, root, _)| (id, root))
    }
}

fn load_file() -> AppResult<ProjectsFile> {
    let path = config_paths::projects_file()?;
    let Some(mut raw) = config_paths::read_json_opt::<Value>(&path)? else {
        return Ok(ProjectsFile::default());
    };

    let removed_ids = raw
        .get("projects")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|project| project.pointer("/origin/kind").and_then(Value::as_str) == Some("ssh"))
        .filter_map(|project| project.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<HashSet<_>>();

    if !removed_ids.is_empty() {
        archive_removed_ssh_projects(&path, &removed_ids)?;
    }

    let mut migrated = false;
    let mut retained_ids = HashSet::new();
    if let Some(projects) = raw.get_mut("projects").and_then(Value::as_array_mut) {
        let original_len = projects.len();
        projects.retain(|project| {
            project.pointer("/origin/kind").and_then(Value::as_str) != Some("ssh")
        });
        migrated |= projects.len() != original_len;

        for project in projects {
            if let Some(id) = project.get("id").and_then(Value::as_str) {
                retained_ids.insert(id.to_string());
            }
            if project
                .as_object_mut()
                .is_some_and(|object| object.remove("origin").is_some())
            {
                migrated = true;
            }
        }
    }

    if let Some(active) = raw.get("lastActiveProjectId").and_then(Value::as_str) {
        if !retained_ids.contains(active) {
            if let Some(object) = raw.as_object_mut() {
                object.insert("lastActiveProjectId".into(), Value::Null);
                migrated = true;
            }
        }
    }

    let file = match serde_json::from_value::<ProjectsFile>(raw) {
        Ok(file) => file,
        Err(e) => {
            eprintln!(
                "[metacodex] config parse failed for {}: {e}; using defaults",
                path.display()
            );
            return Ok(ProjectsFile::default());
        }
    };
    if migrated {
        save_file(&file)?;
    }
    Ok(file)
}

fn archive_removed_ssh_projects(path: &Path, project_ids: &HashSet<String>) -> AppResult<()> {
    let legacy = config_paths::legacy_ssh_dir()?;
    fs::create_dir_all(&legacy)?;
    let projects_backup = legacy.join("projects.json");
    if !projects_backup.exists() {
        let original = fs::read_to_string(path)?;
        config_paths::write_string_atomic(&projects_backup, &original)?;
    }

    let workspace_archive = legacy.join("workspace");
    for project_id in project_ids {
        let source = config_paths::workspace_file(project_id)?;
        if !source.exists() {
            continue;
        }
        fs::create_dir_all(&workspace_archive)?;
        let dest = workspace_archive.join(format!("{project_id}.json"));
        if dest.exists() {
            continue;
        }
        if let Err(e) = fs::rename(&source, &dest) {
            eprintln!(
                "[metacodex] failed to archive removed SSH workspace {}: {e}",
                source.display()
            );
        }
    }
    Ok(())
}

fn save_file(file: &ProjectsFile) -> AppResult<()> {
    let path = config_paths::projects_file()?;
    config_paths::write_json_atomic(&path, file)
}

/// Read the persisted projects (and active id) from disk and warm the cache.
/// Also runs a one-shot color migration so projects created against a prior
/// palette pick up the current swatch for their hue.
pub fn hydrate(app: &AppHandle) -> AppResult<()> {
    let mut file = load_file()?;
    let mut mutated = false;
    for p in file.projects.iter_mut() {
        if let Some(migrated) = migrate_color(&p.color) {
            p.color = migrated;
            mutated = true;
        }
    }
    if mutated {
        save_file(&file)?;
    }
    let cache = app.state::<Arc<ProjectsCache>>();
    cache.replace(file.projects);
    Ok(())
}

/// Generate a 12-char id similar to nanoid.
fn new_id() -> String {
    use uuid::Uuid;
    Uuid::new_v4()
        .to_string()
        .replace('-', "")
        .chars()
        .take(12)
        .collect()
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
    // Trim trailing separators of either flavor so `C:\proj\` and `C:\proj`
    // dedupe to the same project entry, same as `/proj/` and `/proj` on Unix.
    let path = path.trim_end_matches(['/', '\\']).to_string();
    // Guard: reject empty / non-existent paths
    if path.is_empty() {
        return Err(AppError::Other("empty path".into()));
    }
    if !std::path::Path::new(&path).is_dir() {
        return Err(AppError::NotFound(format!("not a directory: {path}")));
    }

    let mut file = load_file()?;
    if let Some(existing) = file.projects.iter().find(|p| p.path == path) {
        // Refresh last_opened_at and return the existing entry. Opening the same
        // folder twice should not create duplicates.
        let id = existing.id.clone();
        let now = Utc::now().to_rfc3339();
        for p in file.projects.iter_mut() {
            if p.id == id {
                p.last_opened_at = now.clone();
            }
        }
        save_file(&file)?;
        app.state::<Arc<ProjectsCache>>()
            .replace(file.projects.clone());
        return Ok(file.projects.into_iter().find(|p| p.id == id).unwrap());
    }

    let now = Utc::now().to_rfc3339();
    let project = Project {
        id: new_id(),
        name: basename(&path),
        path: path.clone(),
        color: assign_color(&file.projects),
        icon: "Folder".into(),
        created_at: now.clone(),
        last_opened_at: now,
    };
    file.projects.push(project.clone());
    save_file(&file)?;
    app.state::<Arc<ProjectsCache>>().replace(file.projects);
    Ok(project)
}

/// Create a brand-new project folder under `directory` and register it. `name`
/// becomes a single new sub-folder; the resulting path is then handed to `add`
/// (so naming / color / dedup all stay in one place). Refuses to clobber.
///
// SECURITY: this creates a directory outside the registered roots. A project
// doesn't exist yet, so it can't go through `ensure_within_roots`. Mitigated by:
// `directory` comes from the native folder dialog (an explicit OS-level user
// grant, same trust model as `add`), and `name` must be a single safe path
// segment (no separators, no `.`/`..`).
pub fn create(app: &AppHandle, directory: String, name: String) -> AppResult<Project> {
    let directory = directory.trim_end_matches('/').to_string();
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Other("empty project name".into()));
    }
    if name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err(AppError::Other("invalid project name".into()));
    }
    if !std::path::Path::new(&directory).is_dir() {
        return Err(AppError::NotFound(format!("not a directory: {directory}")));
    }
    let full = std::path::Path::new(&directory).join(&name);
    if full.exists() {
        return Err(AppError::Other(format!(
            "already exists: {}",
            full.display()
        )));
    }
    std::fs::create_dir(&full).map_err(|e| AppError::Other(format!("create project dir: {e}")))?;
    add(app, full.to_string_lossy().into_owned())
}

pub fn remove(app: &AppHandle, id: &str) -> AppResult<()> {
    let mut file = load_file()?;
    let initial = file.projects.len();
    file.projects.retain(|p| p.id != id);
    if file.projects.len() == initial {
        return Err(AppError::NotFound(format!("project {id}")));
    }
    // If the removed project was active, clear it (same file, one atomic write).
    if file.last_active_project_id.as_deref() == Some(id) {
        file.last_active_project_id = None;
    }
    save_file(&file)?;
    app.state::<Arc<ProjectsCache>>().replace(file.projects);
    // Backend-authoritative watcher teardown. The frontend also calls
    // `unwatch_project`, but that call is best-effort (errors swallowed); if
    // it never lands, the debouncer would keep emitting fs://changed for a
    // project the app no longer knows about.
    app.state::<Arc<crate::watcher::WatcherManager>>()
        .unwatch(id);
    Ok(())
}

pub fn rename(app: &AppHandle, id: &str, name: String) -> AppResult<Project> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Other("name cannot be empty".into()));
    }
    let mut file = load_file()?;
    let found_idx = file
        .projects
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound(format!("project {id}")))?;
    file.projects[found_idx].name = trimmed;
    save_file(&file)?;
    app.state::<Arc<ProjectsCache>>()
        .replace(file.projects.clone());
    Ok(file.projects.into_iter().nth(found_idx).unwrap())
}

pub fn update_meta(
    app: &AppHandle,
    id: &str,
    color: Option<String>,
    icon: Option<String>,
) -> AppResult<Project> {
    let mut file = load_file()?;
    let found_idx = file
        .projects
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound(format!("project {id}")))?;
    if let Some(c) = color {
        file.projects[found_idx].color = c;
    }
    if let Some(i) = icon {
        file.projects[found_idx].icon = i;
    }
    save_file(&file)?;
    app.state::<Arc<ProjectsCache>>()
        .replace(file.projects.clone());
    Ok(file.projects.into_iter().nth(found_idx).unwrap())
}

pub fn list() -> AppResult<Vec<Project>> {
    Ok(load_file()?.projects)
}

/// Persist a new order for the project rail. `ordered_ids` must contain every
/// existing project id exactly once. Any mismatch is rejected so the cache
/// can't get out of sync with the persisted set.
pub fn reorder(app: &AppHandle, ordered_ids: Vec<String>) -> AppResult<Vec<Project>> {
    let mut file = load_file()?;

    if ordered_ids.len() != file.projects.len() {
        return Err(AppError::Other(format!(
            "reorder: expected {} ids, got {}",
            file.projects.len(),
            ordered_ids.len()
        )));
    }

    let mut reordered: Vec<Project> = Vec::with_capacity(file.projects.len());
    for id in &ordered_ids {
        let found = file
            .projects
            .iter()
            .find(|p| &p.id == id)
            .ok_or_else(|| AppError::NotFound(format!("project {id}")))?;
        reordered.push(found.clone());
    }

    file.projects = reordered.clone();
    save_file(&file)?;
    app.state::<Arc<ProjectsCache>>().replace(reordered.clone());
    Ok(reordered)
}

pub fn set_active(app: &AppHandle, id: &str) -> AppResult<()> {
    let mut file = load_file()?;
    let found_idx = file
        .projects
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound(format!("project {id}")))?;
    file.projects[found_idx].last_opened_at = Utc::now().to_rfc3339();
    file.last_active_project_id = Some(id.to_string());
    save_file(&file)?;
    app.state::<Arc<ProjectsCache>>().replace(file.projects);
    Ok(())
}

pub fn get_active_id() -> AppResult<Option<String>> {
    Ok(load_file()?.last_active_project_id)
}
