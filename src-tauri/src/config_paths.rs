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
///
/// Honors `METACODEX_HOME` when set + non-empty, so a dev build can run with an
/// isolated state dir (e.g. `METACODEX_HOME=~/.metacodex-dev pnpm tauri dev`)
/// without clobbering an installed metacodex's projects/settings/workspace.
pub fn config_root() -> AppResult<PathBuf> {
    if let Ok(dir) = std::env::var("METACODEX_HOME") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    dirs::home_dir()
        .map(|h| h.join(".metacodex"))
        .ok_or_else(|| AppError::Other("could not resolve home directory".into()))
}

/// `~/.metacodex/settings.json`, user preferences, hand-editable.
pub fn settings_file() -> AppResult<PathBuf> {
    Ok(config_root()?.join("settings.json"))
}

/// `~/.metacodex/keybindings.json`, keyboard-shortcut overrides.
pub fn keybindings_file() -> AppResult<PathBuf> {
    Ok(config_root()?.join("keybindings.json"))
}

/// `~/.metacodex/state`, app-managed state (not meant for hand-editing).
pub fn state_dir() -> AppResult<PathBuf> {
    Ok(config_root()?.join("state"))
}

/// `~/.metacodex/state/projects.json`, the projects registry + active id.
pub fn projects_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("projects.json"))
}

/// `~/.metacodex/state/workspace`, one file per project.
pub fn workspace_dir() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("workspace"))
}

/// `~/.metacodex/state/resume.json`, agent-session resume registry.
pub fn resume_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("resume.json"))
}

/// `~/.metacodex/state/agent-ui.json`, small Agent View UI state (composer
/// drafts, sidebar expansion choices), keyed by project directory. Opaque to
/// Rust (the frontend owns the schema), same contract as settings.json.
pub fn agent_ui_state_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("agent-ui.json"))
}

/// `~/.metacodex/state/agent-mcp.json`, MCP server registry for the Agent
/// View (source of truth; may contain API keys, written 0600 via
/// [`write_json_atomic_private`]).
pub fn agent_mcp_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("agent-mcp.json"))
}

/// `~/.metacodex/state/opencode-config.json`, GENERATED opencode config layer
/// (enabled MCP servers), passed to the sidecar via `OPENCODE_CONFIG`. Never
/// hand-edited: regenerated from `agent-mcp.json` before every spawn.
pub fn opencode_config_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("opencode-config.json"))
}

/// `~/.metacodex/state/last-session.log`, diagnostics ring-buffer dump on quit.
pub fn last_session_log_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("last-session.log"))
}

/// `~/.metacodex/state/last-crash.json`, last ErrorBoundary catch.
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

/// Like [`read_json`], but a corrupt existing file is renamed to
/// `<file>.corrupt` before defaults are returned. For stores whose boot path
/// persists right after loading (cron, MCP): without the rename, one bad
/// hand-edit would get the only copy of the data overwritten with defaults
/// (and the MCP registry holds API keys the UI can never re-show).
pub fn read_json_backed<T: DeserializeOwned + Default>(path: &Path) -> AppResult<T> {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<T>(&raw) {
            Ok(value) => Ok(value),
            Err(e) => {
                let backup = path.with_file_name(format!(
                    "{}.corrupt",
                    path.file_name().and_then(|s| s.to_str()).unwrap_or("config")
                ));
                eprintln!(
                    "[metacodex] config parse failed for {}: {e}; moving it to {} and using defaults",
                    path.display(),
                    backup.display()
                );
                let _ = fs::rename(path, &backup);
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
    let tmp = tmp_path(path);
    fs::write(&tmp, json.as_bytes())?;
    fs::rename(&tmp, path).map_err(|e| {
        // best-effort cleanup of the temp file
        let _ = fs::remove_file(&tmp);
        AppError::Io(e)
    })?;
    Ok(())
}

/// [`write_json_atomic`] with the temp file CREATED 0600, for files carrying
/// secrets (the MCP registry holds API keys in plaintext: accepted for a
/// local-first app, but the perms keep them to the user account). The mode is
/// set at create time, before any byte is written, so the secret is never
/// world-readable, even briefly.
pub fn write_json_atomic_private<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Other(format!("serialize config: {e}")))?;
    let tmp = tmp_path(path);
    {
        use std::io::Write;
        let mut open = fs::OpenOptions::new();
        open.create(true).write(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            open.mode(0o600);
        }
        let mut file = open.open(&tmp)?;
        file.write_all(json.as_bytes())?;
        // A pre-existing tmp (crash leftover) keeps its old mode; force it.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
        }
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        AppError::Io(e)
    })?;
    Ok(())
}

/// Unique-per-write temp path next to `path`. Uniqueness (pid + counter) keeps
/// two concurrent writers of the SAME file from clobbering each other's temp
/// and failing the rename with a spurious NotFound.
fn tmp_path(path: &Path) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("config");
    path.with_file_name(format!(
        "{file_name}.metacodex.tmp.{}.{n}",
        std::process::id()
    ))
}
