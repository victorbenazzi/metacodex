pub const EV_PTY_DATA: &str = "pty://data";
pub const EV_PTY_EXIT: &str = "pty://exit";
pub const EV_PTY_BACKPRESSURE: &str = "pty://backpressure";
pub const EV_FS_RENAMED: &str = "fs://renamed";
pub const EV_PREPARE_QUIT: &str = "app://prepare-quit";
pub const EV_QUIT_BLOCKED: &str = "app://quit-blocked";
pub const EV_GIT_CLONE_PROGRESS: &str = "git://clone-progress";
pub const EV_OPEN_FILE: &str = "app://open-file";
pub const EV_BROWSER_NAVIGATED: &str = "browser://navigated";
pub const EV_BROWSER_PICKED: &str = "browser://picked";
pub const EV_BROWSER_CAPTURE_SELECTED: &str = "browser://capture-selected";
pub const EV_BROWSER_MODE: &str = "browser://mode";

use serde::Serialize;

use crate::preview_grants::PreviewGrant;

#[derive(Serialize, Clone)]
pub struct PtyDataPayload {
    pub session_id: String,
    pub seq: u64,
    pub data_b64: String,
}

#[derive(Serialize, Clone)]
pub struct PtyExitPayload {
    pub session_id: String,
    pub seq: u64,
    pub exit_code: i32,
    // "normal" (child exited on its own), "reader_error" (reader thread died),
    // "killed" (kill_all on quit), "drainer_stalled" (blocking_send timeout).
    // Old callers ignore this field; backwards-compatible additive change.
    pub reason: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PtyBackpressurePayload {
    pub session_id: String,
    pub seq: u64,
    pub queue_depth: usize,
    pub stalled_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsRenamedPayload {
    pub project_id: String,
    pub old_path: String,
    pub new_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCloneProgressPayload {
    pub op_id: String,
    pub phase: String,
    pub percent: u32,
}

/// Files the OS asked us to open, delivered to the frontend with backend grants
/// for preview mode.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenFilePayload {
    pub files: Vec<PreviewGrant>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BrowserNavigatedPayload {
    pub url: String,
    pub title: String,
    pub loading: bool,
}
