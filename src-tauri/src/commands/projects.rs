use tauri::AppHandle;

use crate::error::AppResult;
use crate::projects::{self, Project};

#[tauri::command]
pub async fn add_project(path: String, app: AppHandle) -> AppResult<Project> {
    projects::add(&app, path)
}

/// Create a new project folder (`directory/name`) and register it. Backs the
/// Agent View's "Start from scratch" flow.
#[tauri::command]
pub async fn create_project(
    directory: String,
    name: String,
    app: AppHandle,
) -> AppResult<Project> {
    projects::create(&app, directory, name)
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
pub async fn list_projects() -> AppResult<Vec<Project>> {
    projects::list()
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
pub async fn get_active_project_id() -> AppResult<Option<String>> {
    projects::get_active_id()
}

/// Reveal a path in the OS file manager (Finder / Explorer / nautilus).
/// Implemented here rather than via tauri-plugin-opener so we don't add another dep.
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> AppResult<()> {
    use crate::error::AppError;
    use crate::util::process::silent_command;

    #[cfg(target_os = "macos")]
    {
        silent_command("open")
            .args(["-R", &path])
            .status()
            .map_err(|e| AppError::Other(format!("open -R failed: {e}")))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // `explorer /select,<path>` needs the path quoted when it contains
        // spaces — and `Command::args` quotes EACH arg, which mangles the
        // `/select,` + path combo. Use raw_arg so the OS receives a single,
        // properly-quoted command line. Strip embedded quotes defensively.
        // Also: do NOT wait on `explorer` — it returns non-zero exit codes
        // even on success (selecting an existing item still yields 1), so
        // a `.status()?.success()` check would falsely report failure.
        use std::os::windows::process::CommandExt;
        let sanitized = path.replace('"', "");
        silent_command("explorer")
            .raw_arg(format!("/select,\"{}\"", sanitized))
            .spawn()
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
        silent_command("xdg-open")
            .arg(parent.as_os_str())
            .status()
            .map_err(|e| AppError::Other(format!("xdg-open failed: {e}")))?;
        Ok(())
    }
}
