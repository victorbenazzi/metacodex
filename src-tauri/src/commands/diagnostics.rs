use std::fs;

use crate::config_paths;
use crate::error::AppResult;

/// Best-effort dump of the in-memory diagnostics ring buffer to
/// `~/.metacodex/state/last-session.log`. Called from the frontend right
/// before app quit (handshake via `app://before-quit`).
///
/// Caps the payload at 2 MB (cutting the head, not the tail) so a runaway
/// log buffer can't bloat the disk. Plain non-atomic write BY DESIGN: this
/// runs inside the ~300ms quit budget, and a torn log is acceptable for a
/// best-effort diagnostics dump (tmp+rename+fsync would spend quit time for
/// no user-facing gain).
#[tauri::command]
pub async fn write_session_log(payload: String) -> AppResult<()> {
    let path = config_paths::last_session_log_file()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    const CAP: usize = 2 * 1024 * 1024;
    let bytes = payload.as_bytes();
    let to_write = if bytes.len() > CAP {
        &bytes[bytes.len() - CAP..]
    } else {
        bytes
    };
    fs::write(&path, to_write)?;
    Ok(())
}

/// Persist the last React render-time crash so the user (or support) can read
/// it after relaunch. Same atomicity guarantees as other config files.
#[tauri::command]
pub async fn write_crash(payload: String) -> AppResult<()> {
    let path = config_paths::last_crash_file()?;
    config_paths::write_string_atomic(&path, &payload)
}
