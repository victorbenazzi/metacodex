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

#[tauri::command]
pub async fn write_file_text(path: String, content: String, app: AppHandle) -> AppResult<()> {
    fs_ops::write_file_text(&app, &path, &content)
}
