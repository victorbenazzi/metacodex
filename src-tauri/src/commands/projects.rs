use tauri::AppHandle;

use crate::error::AppResult;
use crate::projects::{self, Project};

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
pub async fn set_active_project(id: String, app: AppHandle) -> AppResult<()> {
    projects::set_active(&app, &id)
}

#[tauri::command]
pub async fn get_active_project_id(app: AppHandle) -> AppResult<Option<String>> {
    projects::get_active_id(&app)
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
