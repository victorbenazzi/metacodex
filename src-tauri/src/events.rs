pub const EV_PTY_DATA: &str = "pty://data";
pub const EV_PTY_EXIT: &str = "pty://exit";
pub const EV_PROJECT_CHANGED: &str = "project://changed";
pub const EV_FS_ERROR: &str = "fs://error";

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
}
