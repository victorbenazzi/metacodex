use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

pub const EV_FS_CHANGED: &str = "fs://changed";
const MAX_PATHS_PER_BATCH: usize = 512;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsChangedPayload {
    pub project_id: String,
    pub paths: Vec<String>,
}

struct WatchEntry {
    /// Path we asked notify to watch. Makes `watch()` idempotent , a no-op
    /// when called twice with the same (id, path) , so the rapid
    /// project-switch path doesn't drop in-flight events from the existing
    /// debouncer's 80ms window.
    path: PathBuf,
    /// Never read, held for ownership: dropping it releases the OS watcher.
    #[allow(dead_code)]
    debouncer: Debouncer<notify::RecommendedWatcher>,
}

/// One file watcher per project root. A single map holds path + debouncer so
/// watch/unwatch swap both atomically (two maps could desync under the
/// concurrent watch/unwatch Tauri allows). Dropping a debouncer releases its
/// OS-level watcher.
pub struct WatcherManager {
    by_project: Mutex<HashMap<String, WatchEntry>>,
    app_handle: AppHandle,
}

impl WatcherManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            by_project: Mutex::new(HashMap::new()),
            app_handle,
        }
    }

    pub fn watch(&self, project_id: String, path: PathBuf) -> AppResult<()> {
        // Idempotent: if the same (project, path) pair is already wired, keep
        // the existing debouncer alive.
        if let Some(existing) = self.by_project.lock().get(&project_id) {
            if existing.path == path {
                return Ok(());
            }
        }

        let app = self.app_handle.clone();
        let pid = project_id.clone();
        // FSEvents on macOS always reports *canonicalized* paths (symlinks and
        // firmlinks resolved, e.g. iCloud-synced `~/Documents`, `/var` ->
        // `/private/var`, a project added through a symlinked path). The
        // explorer, however, caches directories under the path we were *asked*
        // to watch (the raw project root from `projects.json`). If the two
        // forms differ, an emitted event path can never string-match a cached
        // dir key, so the fs://changed listener skips every refresh and the
        // explorer silently never updates. Capture both forms and rewrite each
        // emitted path's canonical prefix back to the requested root so the
        // frontend's exact-prefix matching works regardless of symlinks.
        let requested_root = path.clone();
        let canonical_root = path.canonicalize().unwrap_or_else(|_| path.clone());
        // Agents constantly run git; `.git/{index,objects,refs,logs}` churn
        // would otherwise dominate a batch (and can push it past the 512
        // collapse-to-root limit, degrading per-file granularity exactly when
        // the user is waiting for new files to pop in). Collapse everything
        // under `.git/` to the `.git` dir itself: still one event to drive
        // the git-status refresh and the visible `.git` row, near-zero budget.
        let git_dir = requested_root.join(".git").display().to_string();
        // 80ms keeps fs events feeling near-instant in the explorer (the IA
        // creates files via the terminal and the user expects them to pop in
        // immediately). Below ~50ms we'd start seeing redundant churn for
        // editor saves; above ~150ms the lag becomes perceptible.
        let mut debouncer = new_debouncer(
            Duration::from_millis(80),
            move |res: DebounceEventResult| {
                let events = match res {
                    Ok(events) => events,
                    Err(err) => {
                        eprintln!("[watcher] error: {err}");
                        return;
                    }
                };
                if events.is_empty() {
                    return;
                }
                let mut paths: Vec<String> = events
                    .iter()
                    .map(|e| match e.path.strip_prefix(&canonical_root) {
                        // Re-root canonical event paths under the requested
                        // root so they line up with the explorer's cache keys.
                        Ok(rel) => requested_root.join(rel).display().to_string(),
                        Err(_) => e.path.display().to_string(),
                    })
                    .map(|p| {
                        // Collapse `.git` internals to the `.git` dir (see above).
                        let is_git_internal = p.len() > git_dir.len()
                            && p.starts_with(git_dir.as_str())
                            && matches!(p.as_bytes()[git_dir.len()], b'/' | b'\\');
                        if is_git_internal {
                            git_dir.clone()
                        } else {
                            p
                        }
                    })
                    // Drop `.metacodex/worktrees/*` , those are parallel
                    // checkouts of THIS repo; the main project's git status
                    // is unaffected by edits inside them, and forwarding the
                    // events triggers redundant explorer refreshes for files
                    // the user can't see (the explorer hides hidden dirs).
                    // Match both Unix and Windows separators since notify
                    // reports `\` on Windows and `/` on Unix.
                    .filter(|p| {
                        !p.contains("/.metacodex/worktrees/")
                            && !p.contains("\\.metacodex\\worktrees\\")
                    })
                    .collect();
                paths.sort();
                paths.dedup();
                if paths.is_empty() {
                    return;
                }
                if paths.len() > MAX_PATHS_PER_BATCH {
                    paths.clear();
                    paths.push(requested_root.display().to_string());
                }
                let _ = app.emit(
                    EV_FS_CHANGED,
                    FsChangedPayload {
                        project_id: pid.clone(),
                        paths,
                    },
                );
            },
        )
        .map_err(|e| AppError::Other(format!("notify debouncer: {e}")))?;

        debouncer
            .watcher()
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|e| AppError::Other(format!("watch {}: {e}", path.display())))?;

        // Swap in the new entry, then drop any replaced one OUTSIDE the lock
        // so its callback thread can't try to re-acquire the lock during
        // shutdown (which would deadlock with parking_lot::Mutex).
        let old = {
            let mut guard = self.by_project.lock();
            guard.insert(project_id, WatchEntry { path, debouncer })
        };
        drop(old);
        Ok(())
    }

    pub fn unwatch(&self, project_id: &str) {
        // Same drop-outside-the-lock rule as watch(): keep the callback
        // thread from racing the lock during Drop.
        let old = {
            let mut guard = self.by_project.lock();
            guard.remove(project_id)
        };
        drop(old);
    }
}

pub type SharedWatcher = Arc<WatcherManager>;
