use tauri::AppHandle;

use crate::error::AppResult;
use crate::fs_ops::{self, BytesFile, DirEntry, FileMeta, TextFile};

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
    fs_ops::rename_path(&app, &path, &new_name)
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
    fs_ops::move_path(&app, &from, &to_dir)
}
