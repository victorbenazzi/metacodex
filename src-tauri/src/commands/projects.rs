use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::projects::{self, Project, ProjectsCache};

#[tauri::command]
pub async fn add_project(path: String, app: AppHandle) -> AppResult<Project> {
    projects::add(&app, path)
}

#[tauri::command]
pub async fn remove_project(id: String, app: AppHandle) -> AppResult<()> {
    projects::remove(&app, &id)
}

#[tauri::command]
pub async fn rename_project(id: String, name: String, app: AppHandle) -> AppResult<Project> {
    projects::rename(&app, &id, name)
}

#[tauri::command]
pub async fn update_project_meta(
    id: String,
    color: Option<String>,
    icon: Option<String>,
    app: AppHandle,
) -> AppResult<Project> {
    projects::update_meta(&app, &id, color, icon)
}

#[tauri::command]
pub async fn list_projects(app: AppHandle) -> AppResult<Vec<Project>> {
    projects::list(&app)
}

#[tauri::command]
pub async fn reorder_projects(
    ordered_ids: Vec<String>,
    app: AppHandle,
) -> AppResult<Vec<Project>> {
    projects::reorder(&app, ordered_ids)
}

#[tauri::command]
pub async fn set_active_project(id: String, app: AppHandle) -> AppResult<()> {
    projects::set_active(&app, &id)
}

#[tauri::command]
pub async fn get_active_project_id(app: AppHandle) -> AppResult<Option<String>> {
    projects::get_active_id(&app)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaviconCandidate {
    /// Absolute filesystem path — used by `read_file_bytes` to load the icon.
    pub path: String,
    /// Path relative to the project root, for display ("favicon.png", "public/favicon.svg").
    pub rel_path: String,
    pub mime: String,
}

/// Look for `favicon.{ico,png,svg}` in the project root and in `public/`. The
/// project id resolves through the cached `ProjectsCache` so we can't be tricked
/// into scanning an arbitrary path — the path is whatever the user registered.
#[tauri::command]
pub async fn detect_project_favicons(
    project_id: String,
    app: AppHandle,
) -> AppResult<Vec<FaviconCandidate>> {
    let cache = app.state::<Arc<ProjectsCache>>();
    let projects = cache.snapshot();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::NotFound(format!("project {project_id}")))?;

    let root = std::path::PathBuf::from(&project.path);

    const CANDIDATES: &[(&str, &str)] = &[
        ("favicon.ico", "image/x-icon"),
        ("favicon.png", "image/png"),
        ("favicon.svg", "image/svg+xml"),
    ];
    const DIRS: &[&str] = &[".", "public"];

    let mut out: Vec<FaviconCandidate> = Vec::new();
    for dir in DIRS {
        let base = if *dir == "." { root.clone() } else { root.join(dir) };
        if !base.is_dir() {
            continue;
        }
        for (name, mime) in CANDIDATES {
            let p = base.join(name);
            if p.is_file() {
                let rel = if *dir == "." {
                    (*name).to_string()
                } else {
                    format!("{dir}/{name}")
                };
                out.push(FaviconCandidate {
                    path: p.to_string_lossy().to_string(),
                    rel_path: rel,
                    mime: (*mime).to_string(),
                });
            }
        }
    }

    Ok(out)
}

/// Reveal a path in the OS file manager (Finder / Explorer / nautilus).
/// Implemented here rather than via tauri-plugin-opener so we don't add another dep.
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> AppResult<()> {
    use crate::error::AppError;
    use std::process::Command;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .status()
            .map_err(|e| AppError::Other(format!("open -R failed: {e}")))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path])
            .status()
            .map_err(|e| AppError::Other(format!("explorer failed: {e}")))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Best-effort for Linux: open the parent directory in the default file manager.
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from(&path));
        Command::new("xdg-open")
            .arg(parent.as_os_str())
            .status()
            .map_err(|e| AppError::Other(format!("xdg-open failed: {e}")))?;
        Ok(())
    }
}
