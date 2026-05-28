pub const EV_PTY_DATA: &str = "pty://data";
pub const EV_PTY_EXIT: &str = "pty://exit";
pub const EV_PTY_BACKPRESSURE: &str = "pty://backpressure";
pub const EV_PROJECT_CHANGED: &str = "project://changed";
pub const EV_FS_ERROR: &str = "fs://error";
pub const EV_FS_RENAMED: &str = "fs://renamed";
pub const EV_BEFORE_QUIT: &str = "app://before-quit";
pub const EV_GIT_CLONE_PROGRESS: &str = "git://clone-progress";

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct PtyDataPayload {
    pub session_id: String,
    pub data_b64: String,
}

#[derive(Serialize, Clone)]
pub struct PtyExitPayload {
    pub session_id: String,
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
