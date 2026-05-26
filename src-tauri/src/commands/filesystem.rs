use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppResult;
use crate::events::{FsRenamedPayload, EV_FS_RENAMED};
use crate::fs_ops::{self, BytesFile, DirEntry, FileMeta, TextFile};
use crate::projects::ProjectsCache;

/// Look up the owning project id for `path` and emit `fs://renamed` so the
/// frontend can update open editor tabs without losing their unsaved buffer.
/// Best-effort: missing project / emit failure is logged, never propagated.
fn emit_renamed(app: &AppHandle, old_path: &str, new_path: &str) {
    let cache = app.state::<Arc<ProjectsCache>>();
    if let Some((project_id, _root)) = cache.find_owner(new_path) {
        let _ = app.emit(
            EV_FS_RENAMED,
            FsRenamedPayload {
                project_id,
                old_path: old_path.to_string(),
                new_path: new_path.to_string(),
            },
        );
    }
}

#[tauri::command]
pub async fn read_dir(path: String, app: AppHandle) -> AppResult<Vec<DirEntry>> {
    fs_ops::read_dir(&app, &path)
}

#[tauri::command]
pub async fn stat(path: String, app: AppHandle) -> AppResult<FileMeta> {
    fs_ops::stat(&app, &path)
}

#[tauri::command]
pub async fn read_file_text(
    path: String,
    max_bytes: Option<u64>,
    app: AppHandle,
) -> AppResult<TextFile> {
    fs_ops::read_file_text(&app, &path, max_bytes)
}

#[tauri::command]
pub async fn read_file_bytes(
    path: String,
    max_bytes: Option<u64>,
    app: AppHandle,
) -> AppResult<BytesFile> {
    fs_ops::read_file_bytes(&app, &path, max_bytes)
}

/// Read a user-picked image (from the native dialog) for use as a project icon.
/// Intentionally bypasses the project-root check — see `fs_ops::read_icon_image`.
#[tauri::command]
pub async fn read_icon_image(path: String) -> AppResult<BytesFile> {
    fs_ops::read_icon_image(&path)
}

#[tauri::command]
pub async fn write_file_text(path: String, content: String, app: AppHandle) -> AppResult<()> {
    fs_ops::write_file_text(&app, &path, &content)
}

#[tauri::command]
pub async fn delete_path(path: String, app: AppHandle) -> AppResult<()> {
    fs_ops::delete_path(&app, &path)
}

#[tauri::command]
pub async fn rename_path(path: String, new_name: String, app: AppHandle) -> AppResult<String> {
    let new_path = fs_ops::rename_path(&app, &path, &new_name)?;
    emit_renamed(&app, &path, &new_path);
    Ok(new_path)
}

#[tauri::command]
pub async fn create_file(parent: String, name: String, app: AppHandle) -> AppResult<String> {
    fs_ops::create_file(&app, &parent, &name)
}

#[tauri::command]
pub async fn create_dir(parent: String, name: String, app: AppHandle) -> AppResult<String> {
    fs_ops::create_dir(&app, &parent, &name)
}

#[tauri::command]
pub async fn move_path(from: String, to_dir: String, app: AppHandle) -> AppResult<String> {
    let new_path = fs_ops::move_path(&app, &from, &to_dir)?;
    emit_renamed(&app, &from, &new_path);
    Ok(new_path)
}
