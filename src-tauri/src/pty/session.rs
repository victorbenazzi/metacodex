use std::io::Write;
use std::sync::atomic::AtomicBool;
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
    /// PID of the child process, captured at spawn time. Zero if the platform
    /// didn't expose it for whatever reason (`portable_pty::Child::process_id`
    /// is `Option<u32>`). Used by `pty_metadata` to query lsof / branch.
    pub pid: u32,

    pub(crate) writer: Mutex<Box<dyn Write + Send>>,
    pub(crate) master: Mutex<Box<dyn MasterPty + Send>>,
    pub(crate) killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub(crate) cancel: Arc<Notify>,
    /// Set by the reader thread when its blocking read returns an error.
    /// The waiter task observes this on the cancel path and emits exit with
    /// reason "reader_error" instead of "killed" so the frontend banner can
    /// distinguish "I aborted this" from "the PTY broke under us".
    pub(crate) reader_failed: AtomicBool,
    /// Set by `kill()` so the waiter task observes the cancel even if the
    /// `Notify` wakeup is lost (e.g. a kill that lands before the waiter first
    /// polls `notified()`, as in the StrictMode immediate-unmount race).
    /// Level-triggered: the waiter checks this every loop iteration.
    pub(crate) killed: AtomicBool,
    /// Latest cwd hint pushed by the frontend via OSC 7. When `None`, fall
    /// back to `cwd` (the spawn-time directory).
    pub cwd_override: Mutex<Option<String>>,
    /// Windows-only: KILL_ON_JOB_CLOSE Job Object holding the spawned process.
    /// When the session is dropped the kernel terminates every descendant
    /// (`claude.cmd` → `node.exe` chains) so agents can't outlive their tab.
    /// Field is unread by design — its lifetime is the kill mechanism.
    #[cfg(windows)]
    #[allow(dead_code)]
    pub(crate) job: Option<crate::pty::job::PtyJob>,
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
        self.killed.store(true, std::sync::atomic::Ordering::SeqCst);
        self.cancel.notify_waiters();
        let mut k = self.killer.lock();
        let _ = k.kill();
    }

    /// Current working directory — favors the OSC 7 override if any, else the
    /// spawn-time cwd.
    pub fn current_cwd(&self) -> String {
        self.cwd_override
            .lock()
            .clone()
            .unwrap_or_else(|| self.cwd.clone())
    }

    /// Replace the cwd hint from OSC 7. The caller is responsible for the
    /// `ensure_within_roots` check when there's an active project.
    pub fn set_cwd_override(&self, cwd: String) {
        *self.cwd_override.lock() = Some(cwd);
    }
}
