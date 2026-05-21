use std::io::Write;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use portable_pty::{ChildKiller, MasterPty, PtySize};
use tokio::sync::Notify;

/// A single PTY session — one shell or CLI subprocess attached to a pty pair.
/// The reader and waiter live in their own tasks; this struct only owns the
/// pieces needed for the *control surface*: write, resize, kill.
pub struct PtySession {
    pub id: String,
    pub project_id: Option<String>,
    pub label: String,
    pub cwd: String,
    pub kind: String, // "shell" | "cli"
    pub cli_id: Option<String>,
    pub created_at: DateTime<Utc>,

    pub(crate) writer: Mutex<Box<dyn Write + Send>>,
    pub(crate) master: Mutex<Box<dyn MasterPty + Send>>,
    pub(crate) killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub(crate) cancel: Arc<Notify>,
}

impl PtySession {
    pub fn write_bytes(&self, data: &[u8]) -> std::io::Result<()> {
        let mut w = self.writer.lock();
        w.write_all(data)?;
        w.flush()
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let m = self.master.lock();
        m.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {e}"))
    }

    pub fn kill(&self) {
        self.cancel.notify_waiters();
        let mut k = self.killer.lock();
        let _ = k.kill();
    }
}
