use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::events::{OpenFilePayload, EV_OPEN_FILE};

/// Files the OS asked us to open that arrived before the webview was listening
/// (cold start: the app was launched *by* the open). Drained by the frontend via
/// `take_pending_open_files` on mount.
#[derive(Default)]
pub struct PendingOpenFiles {
    inner: Mutex<Vec<String>>,
}

impl PendingOpenFiles {
    pub fn push(&self, paths: &[String]) {
        let mut g = self.inner.lock();
        for p in paths {
            if !g.contains(p) {
                g.push(p.clone());
            }
        }
    }

    pub fn drain(&self) -> Vec<String> {
        std::mem::take(&mut *self.inner.lock())
    }
}

fn filter_allowed<I: IntoIterator<Item = String>>(paths: I) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| crate::fs_ops::preview_ext_allowed_any(p))
        .collect()
}

/// Push to the pending queue AND emit `app://open-file`. Both, always: the live
/// event covers warm opens (app already running), the queue covers cold-start races
/// (the open fired before the webview mounted its listener). The frontend dedups by
/// path, so receiving a path through both channels is harmless.
pub fn deliver(app: &AppHandle, paths: Vec<String>) {
    let paths = filter_allowed(paths);
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<Arc<PendingOpenFiles>>() {
        state.push(&paths);
    }
    let _ = app.emit(EV_OPEN_FILE, OpenFilePayload { paths });
}

/// Convert the `file://` URLs from `RunEvent::Opened` (Finder double-click / "Open
/// With") into local paths and deliver them.
#[cfg(target_os = "macos")]
pub fn handle_opened(app: &AppHandle, urls: Vec<tauri::Url>) {
    let paths: Vec<String> = urls
        .into_iter()
        .filter(|u| u.scheme() == "file")
        .filter_map(|u| u.to_file_path().ok())
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    deliver(app, paths);
}
