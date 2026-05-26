//! Resolves and manages metacodex's on-disk config + state under `~/.metacodex`.
//!
//! Layout:
//! ```text
//! ~/.metacodex/
//! ├── settings.json          # user prefs (hand-editable)
//! ├── keybindings.json       # shortcut overrides
//! └── state/
//!     ├── projects.json       # { projects, lastActiveProjectId }
//!     └── workspace/
//!         └── {projectId}.json
//! ```
//!
//! All persistence writes plain, pretty-printed JSON directly (no
//! `tauri-plugin-store`) so the config files stay readable and survive
//! hand-edits.

use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Root of all metacodex config + state: `~/.metacodex`.
pub fn config_root() -> AppResult<PathBuf> {
    dirs::home_dir()
        .map(|h| h.join(".metacodex"))
        .ok_or_else(|| AppError::Other("could not resolve home directory".into()))
}

/// `~/.metacodex/settings.json` — user preferences, hand-editable.
pub fn settings_file() -> AppResult<PathBuf> {
    Ok(config_root()?.join("settings.json"))
}

/// `~/.metacodex/keybindings.json` — keyboard-shortcut overrides.
pub fn keybindings_file() -> AppResult<PathBuf> {
    Ok(config_root()?.join("keybindings.json"))
}

/// `~/.metacodex/state` — app-managed state (not meant for hand-editing).
pub fn state_dir() -> AppResult<PathBuf> {
    Ok(config_root()?.join("state"))
}

/// `~/.metacodex/state/projects.json` — the projects registry + active id.
pub fn projects_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("projects.json"))
}

/// `~/.metacodex/state/workspace` — one file per project.
pub fn workspace_dir() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("workspace"))
}

/// `~/.metacodex/state/resume.json` — agent-session resume registry.
pub fn resume_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("resume.json"))
}

/// `~/.metacodex/state/last-session.log` — diagnostics ring-buffer dump on quit.
pub fn last_session_log_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("last-session.log"))
}

/// `~/.metacodex/state/last-crash.json` — last ErrorBoundary catch.
pub fn last_crash_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("last-crash.json"))
}

/// Path to a single project's workspace file: `state/workspace/{id}.json`.
///
/// Guards the id (which is server-generated, but belt-and-suspenders) so a
/// malformed value can never escape the workspace directory.
pub fn workspace_file(project_id: &str) -> AppResult<PathBuf> {
    if project_id.is_empty()
        || project_id.starts_with('.')
        || project_id.contains('/')
        || project_id.contains('\\')
        || project_id.contains("..")
        || project_id.contains('\0')
    {
        return Err(AppError::Other(format!(
            "invalid project id for workspace file: {project_id:?}"
        )));
    }
    Ok(workspace_dir()?.join(format!("{project_id}.json")))
}

/// Create the `~/.metacodex` tree (root + state + workspace). Idempotent.
/// Creating the deepest dir (`workspace`) implies its ancestors.
pub fn ensure_dirs() -> AppResult<()> {
    fs::create_dir_all(workspace_dir()?)?;
    Ok(())
}

/// Read + deserialize a JSON config file.
///
/// - Absent file → `T::default()` (first run, not an error).
/// - Parse failure (corrupt / hand-edited) → `T::default()` + log; never crash.
/// - Real IO errors (e.g. permission denied) → propagate.
pub fn read_json<T: DeserializeOwned + Default>(path: &Path) -> AppResult<T> {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<T>(&raw) {
            Ok(value) => Ok(value),
            Err(e) => {
                eprintln!(
                    "[metacodex] config parse failed for {}: {e}; using defaults",
                    path.display()
                );
                Ok(T::default())
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Like [`read_json`] but returns `None` for an absent file, matching callers
/// whose contract is `Option<T>` (e.g. `load_workspace_state`). A corrupt file
/// is treated as `None` + log.
pub fn read_json_opt<T: DeserializeOwned>(path: &Path) -> AppResult<Option<T>> {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<T>(&raw) {
            Ok(value) => Ok(Some(value)),
            Err(e) => {
                eprintln!(
                    "[metacodex] config parse failed for {}: {e}; ignoring",
                    path.display()
                );
                Ok(None)
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Atomic, pretty-printed JSON write: serialize → `<file>.metacodex.tmp` → rename.
/// Creates parent directories as needed.
///
/// SECURITY: unlike the fs commands in `fs_ops`, this deliberately does NOT call
/// `paths::ensure_within_roots`. These files live under `~/.metacodex`, outside
/// every registered project root, so the roots check would reject them. It is
/// safe because the destination path is always app-derived: read commands take
/// no path argument, and write commands take only opaque JSON or a guarded
/// project id (see [`workspace_file`]). The webview can never inject an arbitrary
/// path here. Same documented precedent as `fs_ops::read_icon_image`.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Other(format!("serialize config: {e}")))?;
    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("config");
    let tmp = path.with_file_name(format!("{file_name}.metacodex.tmp"));
    fs::write(&tmp, json.as_bytes())?;
    fs::rename(&tmp, path).map_err(|e| {
        // best-effort cleanup of the temp file
        let _ = fs::remove_file(&tmp);
        AppError::Io(e)
    })?;
    Ok(())
}
