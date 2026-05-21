use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::pty::{PtyManager, PtySessionInfo, PtySpawnSpec};

#[tauri::command]
pub async fn pty_spawn(
    spec: PtySpawnSpec,
    mgr: State<'_, PtyManager>,
) -> AppResult<String> {
    mgr.spawn(spec)
}

#[tauri::command]
pub async fn pty_write(
    session_id: String,
    data_b64: String,
    mgr: State<'_, PtyManager>,
) -> AppResult<()> {
    let bytes = STANDARD
        .decode(&data_b64)
        .map_err(|e| AppError::Pty(format!("invalid base64: {e}")))?;
    mgr.write(&session_id, &bytes)
}

#[tauri::command]
pub async fn pty_resize(
    session_id: String,
    rows: u16,
    cols: u16,
    mgr: State<'_, PtyManager>,
) -> AppResult<()> {
    mgr.resize(&session_id, rows, cols)
}

#[tauri::command]
pub async fn pty_kill(session_id: String, mgr: State<'_, PtyManager>) -> AppResult<()> {
    mgr.kill(&session_id)
}

#[tauri::command]
pub async fn pty_list(mgr: State<'_, PtyManager>) -> AppResult<Vec<PtySessionInfo>> {
    Ok(mgr.list())
}
