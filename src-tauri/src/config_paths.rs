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

/// `~/.metacodex/state/legacy-agent`, archived state from the removed Agent View.
pub fn legacy_agent_dir() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("legacy-agent"))
}

/// `~/.metacodex/state/resume.json`, terminal CLI session resume registry.
pub fn resume_file() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("resume.json"))
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
    archive_legacy_agent_state()?;
    Ok(())
}

fn archive_legacy_agent_state() -> AppResult<()> {
    let state = state_dir()?;
    let legacy = legacy_agent_dir()?;
    let root = config_root()?;
    for path in [
        state.join("agent-ui.json"),
        state.join("agent-mcp.json"),
        state.join("opencode-config.json"),
        state.join("agent-cron.json"),
        state.join("agent-drafts.json"),
        state.join("opencode-runtime.json"),
        state.join("opencode.log"),
        root.join("agents"),
    ] {
        if !path.exists() {
            continue;
        }
        fs::create_dir_all(&legacy)?;
        let Some(name) = path.file_name() else {
            continue;
        };
        let dest = legacy.join(name);
        if dest.exists() {
            continue;
        }
        if let Err(e) = fs::rename(&path, &dest) {
            eprintln!(
                "[metacodex] failed to archive legacy agent state {}: {e}",
                path.display()
            );
        }
    }
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
/// path here. Same documented precedent as `fs_ops::read_project_icon_image`.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Other(format!("serialize config: {e}")))?;
    write_string_atomic(path, &json)
}

/// Atomic, durable string write: `<file>.metacodex.tmp` + write + `sync_all`,
/// then rename. The `sync_all` puts the data on disk BEFORE the rename makes
/// it visible, so a power loss right after the rename can't leave a truncated
/// or zero-length file. No parent-dir fsync on purpose: losing the rename
/// itself just means the OLD version survives, which is acceptable for config
/// files and avoids a second fsync on the settings hot path.
/// Shares the SECURITY carve-out documented on [`write_json_atomic`].
pub fn write_string_atomic(path: &Path, contents: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = tmp_path(path);
    let written = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(AppError::Io(e));
    }
    // Windows: AV / OneDrive briefly hold handles on the destination during
    // scans; retry the atomic rename twice with short backoff before surfacing.
    let mut last_err: Option<std::io::Error> = None;
    for attempt in 0..3 {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                if attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_millis(50 * (attempt + 1)));
                }
            }
        }
    }
    let _ = fs::remove_file(&tmp);
    Err(AppError::Io(last_err.expect("retry loop ran")))
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
