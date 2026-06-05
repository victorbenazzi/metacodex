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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsChangedPayload {
    pub project_id: String,
    pub paths: Vec<String>,
}

/// One file watcher per project root, owned in a hashmap. Dropping a debouncer
/// releases its OS-level watcher.
pub struct WatcherManager {
    by_project: Mutex<HashMap<String, Debouncer<notify::RecommendedWatcher>>>,
    /// Path we asked notify to watch for each project. Used to make `watch()`
    /// idempotent — a no-op when called twice with the same (id, path) — so
    /// the rapid project-switch path doesn't drop in-flight events from the
    /// existing debouncer's 80ms window.
    paths_by_project: Mutex<HashMap<String, PathBuf>>,
    app_handle: AppHandle,
}

impl WatcherManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            by_project: Mutex::new(HashMap::new()),
            paths_by_project: Mutex::new(HashMap::new()),
            app_handle,
        }
    }

    pub fn watch(&self, project_id: String, path: PathBuf) -> AppResult<()> {
        // Idempotent: if the same (project, path) pair is already wired, keep
        // the existing debouncer alive — its in-flight events would otherwise
        // be lost in the 80ms gap between remove() and the new insert.
        if let Some(existing) = self.paths_by_project.lock().get(&project_id) {
            if existing == &path {
                return Ok(());
            }
        }
        // Different path (or no entry): drop the old debouncer OUTSIDE the
        // lock so its callback thread can't try to re-acquire the lock during
        // shutdown (which would deadlock with parking_lot::Mutex). Take the
        // value out, release the guard, then drop the value.
        let old_debouncer = {
            let mut guard = self.by_project.lock();
            guard.remove(&project_id)
        };
        drop(old_debouncer);

        let app = self.app_handle.clone();
        let pid = project_id.clone();
        // FSEvents on macOS always reports *canonicalized* paths (symlinks and
        // firmlinks resolved, e.g. iCloud-synced `~/Documents`, `/var` ->
        // `/private/var`, a project added through a symlinked path). The
        // explorer, however, caches directories under the path we were *asked*
        // to watch (the raw project root from `projects.json`). If the two
        // forms differ, an emitted event path can never string-match a cached
        // dir key, so `AppShell`'s listener skips every refresh and the
        // explorer silently never updates. Capture both forms and rewrite each
        // emitted path's canonical prefix back to the requested root so the
        // frontend's exact-prefix matching works regardless of symlinks.
        let requested_root = path.clone();
        let canonical_root = path.canonicalize().unwrap_or_else(|_| path.clone());
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
                    // Drop `.metacodex/worktrees/*` — those are parallel
                    // checkouts of THIS repo; the main project's git status
                    // is unaffected by edits inside them, and forwarding the
                    // events triggers redundant explorer refreshes for files
                    // the user can't see (the explorer hides hidden dirs).
                    .filter(|p| !p.contains("/.metacodex/worktrees/"))
                    .collect();
                paths.sort();
                paths.dedup();
                if paths.is_empty() {
                    return;
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

        self.paths_by_project
            .lock()
            .insert(project_id.clone(), path);
        self.by_project.lock().insert(project_id, debouncer);
        Ok(())
    }

    pub fn unwatch(&self, project_id: &str) {
        self.paths_by_project.lock().remove(project_id);
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
