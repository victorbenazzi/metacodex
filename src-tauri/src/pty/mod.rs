#[cfg(windows)]
pub mod job;
pub mod session;
pub mod shell;

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Notify};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::events::{
    PtyBackpressurePayload, PtyDataPayload, PtyExitPayload, EV_PTY_BACKPRESSURE, EV_PTY_DATA,
    EV_PTY_EXIT,
};

pub use session::PtySession;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PtyKind {
    Plain,
    Cli { command: String },
}

#[derive(Debug, Clone, Deserialize)]
pub struct PtySpawnSpec {
    pub project_id: Option<String>,
    pub cwd: String,
    pub rows: u16,
    pub cols: u16,
    pub kind: PtyKind,
    pub label: String,
    #[serde(default)]
    pub cli_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtySessionInfo {
    pub id: String,
    pub project_id: Option<String>,
    pub label: String,
    pub cwd: String,
    pub kind: String,
    pub cli_id: Option<String>,
    pub created_at: String,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, Arc<PtySession>>>>,
    /// JoinHandles of the per-session waiter tasks. We capture them so
    /// `kill_all` (called from the window-close handler) can await every
    /// waiter to actually reap its child — without these handles, the tokio
    /// runtime shutdown would abandon the waiters mid-`child.wait()` and leak
    /// the children as zombies / orphans.
    waiters: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    /// Windows-only: serializes ConPTY spawns. Concurrent `openpty` + spawn
    /// calls on Windows can leave one PTY with a stalled output pipe (see the
    /// portable-pty notes); a single mutex around the spawn critical section
    /// is the documented fix and has negligible overhead.
    #[cfg(windows)]
    spawn_lock: Mutex<()>,
    app_handle: AppHandle,
}

impl PtyManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            waiters: Arc::new(Mutex::new(HashMap::new())),
            #[cfg(windows)]
            spawn_lock: Mutex::new(()),
            app_handle,
        }
    }

    pub fn spawn(&self, spec: PtySpawnSpec) -> AppResult<String> {
        #[cfg(windows)]
        let _spawn_guard = self.spawn_lock.lock();

        let id = Uuid::new_v4().to_string();

        let (program, args, kind_label, cli_id) = match &spec.kind {
            PtyKind::Plain => {
                let (p, a) = shell::detect_login_shell();
                (p, a, "shell".to_string(), None)
            }
            PtyKind::Cli { command } => {
                let (p, a) = shell::cli_launch_args(command);
                (p, a, "cli".to_string(), spec.cli_id.clone())
            }
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: spec.rows.max(1),
                cols: spec.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Pty(format!("openpty: {e}")))?;

        let mut cmd = CommandBuilder::new(&program);
        for a in &args {
            cmd.arg(a);
        }
        cmd.cwd(&spec.cwd);
        cmd.env_clear();
        for (k, v) in shell::build_env(Path::new(&spec.cwd)) {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Pty(format!("spawn: {e}")))?;

        let pid = child.process_id().unwrap_or(0);
        let killer = child.clone_killer();
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Pty(format!("take_writer: {e}")))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Pty(format!("clone_reader: {e}")))?;

        // Drop the slave handle — once the child has been spawned with it, we no
        // longer need it. Keeping it open can prevent the master from seeing EOF
        // when the child exits.
        drop(pair.slave);

        let cancel = Arc::new(Notify::new());

        // Windows: assign the spawned process to a KILL_ON_JOB_CLOSE Job Object
        // so dropping the session terminates the whole descendant tree (the
        // shell + `claude.cmd` + `node.exe`). Best-effort: if any Win32 call
        // fails we still return the session — the user just loses descendant
        // cleanup, which is what we had before this change.
        #[cfg(windows)]
        let job = if pid > 0 {
            match job::PtyJob::assign_pid(pid) {
                Ok(j) => Some(j),
                Err(e) => {
                    eprintln!("[pty] PtyJob::assign_pid failed for pid={pid}: {e}");
                    None
                }
            }
        } else {
            None
        };

        let session = Arc::new(PtySession {
            id: id.clone(),
            project_id: spec.project_id.clone(),
            label: spec.label.clone(),
            cwd: spec.cwd.clone(),
            kind: kind_label,
            cli_id,
            created_at: Utc::now(),
            pid,
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            killer: Mutex::new(killer),
            cancel: cancel.clone(),
            reader_failed: AtomicBool::new(false),
            killed: AtomicBool::new(false),
            cwd_override: Mutex::new(None),
            #[cfg(windows)]
            job,
        });

        self.sessions.lock().insert(id.clone(), session.clone());

        // ----- reader thread: blocking std::thread, pushes chunks into channel -----
        // Bounded channel (4096 chunks of ~8KiB each ≈ 32MiB max in-flight). When
        // the drainer can't keep up — e.g. `cat /dev/urandom`, runaway log dumps,
        // an infinite stack trace — `blocking_send` parks the reader instead of
        // unbounded growth. The PTY's pipe buffer then back-pressures the child
        // process via natural SIGPIPE/EAGAIN semantics, which TUIs handle cleanly.
        //
        // We intentionally do NOT drop chunks here: TUIs like Claude Code / Codex
        // emit stateful ESC sequences (cursor positioning, color); a missing chunk
        // mid-redraw leaves the screen incoherent until Ctrl+L.
        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(4096);
        let id_for_thread = id.clone();
        let app_pressure = self.app_handle.clone();
        let id_for_pressure = id.clone();
        let session_for_reader = session.clone();
        std::thread::Builder::new()
            .name(format!("pty-reader-{id_for_thread}"))
            .spawn(move || {
                let mut reader = reader;
                let mut buf = [0u8; 8192];
                let mut last_pressure_emit = std::time::Instant::now()
                    .checked_sub(Duration::from_secs(1))
                    .unwrap_or_else(std::time::Instant::now);
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break, // EOF
                        Ok(n) => {
                            let chunk = buf[..n].to_vec();
                            // Fast path: try_send is non-blocking. If it fails
                            // (channel full → drainer is lagging), fall back to
                            // blocking_send and time how long we stalled. Emit
                            // a single backpressure event per second so the
                            // diagnostic panel can show the pattern without
                            // flooding the IPC bus.
                            match tx.try_send(chunk) {
                                Ok(()) => {}
                                Err(tokio::sync::mpsc::error::TrySendError::Full(chunk)) => {
                                    let started = std::time::Instant::now();
                                    if tx.blocking_send(chunk).is_err() {
                                        return;
                                    }
                                    let stalled_ms =
                                        started.elapsed().as_millis().min(u128::from(u64::MAX))
                                            as u64;
                                    if stalled_ms > 0
                                        && last_pressure_emit.elapsed() > Duration::from_secs(1)
                                    {
                                        last_pressure_emit = std::time::Instant::now();
                                        let _ = app_pressure.emit(
                                            EV_PTY_BACKPRESSURE,
                                            PtyBackpressurePayload {
                                                session_id: id_for_pressure.clone(),
                                                queue_depth: 4096,
                                                stalled_ms,
                                            },
                                        );
                                    }
                                }
                                Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => return,
                            }
                        }
                        Err(_) => {
                            // Mark failure + kick the cancel notifier so the
                            // waiter task ends and emits a *single* exit event
                            // with reason "reader_error". This keeps emit
                            // ownership in one place (the waiter), preventing
                            // double notifications on the frontend.
                            session_for_reader
                                .reader_failed
                                .store(true, Ordering::SeqCst);
                            session_for_reader.cancel.notify_waiters();
                            break;
                        }
                    }
                }
            })
            .map_err(|e| AppError::Pty(format!("reader thread: {e}")))?;

        // ----- drainer task: emits pty://data events -----
        let app_d = self.app_handle.clone();
        let id_d = id.clone();
        tokio::spawn(async move {
            while let Some(chunk) = rx.recv().await {
                let payload = PtyDataPayload {
                    session_id: id_d.clone(),
                    data_b64: STANDARD.encode(&chunk),
                };
                let _ = app_d.emit(EV_PTY_DATA, payload);
            }
        });

        // ----- waiter task: polls try_wait + emits pty://exit + removes session -----
        let app_w = self.app_handle.clone();
        let id_w = id.clone();
        let sessions_ref = self.sessions.clone();
        let waiters_ref = self.waiters.clone();
        let cancel_w = cancel.clone();
        let id_for_waiter_key = id.clone();
        let session_for_waiter = session.clone();
        let waiter_handle = tokio::spawn(async move {
            let mut child = child;
            let mut exit_reason: Option<&'static str> = None;
            loop {
                // Level-triggered cancel check: covers a lost `Notify` wakeup
                // (kill landing before this task first polls `notified()`).
                if session_for_waiter.killed.load(Ordering::SeqCst) {
                    exit_reason = Some(
                        if session_for_waiter.reader_failed.load(Ordering::SeqCst) {
                            "reader_error"
                        } else {
                            "killed"
                        },
                    );
                    break;
                }
                let exited = tokio::select! {
                    _ = cancel_w.notified() => {
                        // Disambiguate: reader thread sets `reader_failed` then
                        // notifies cancel for IO errors; kill_all / per-tab kill
                        // notifies cancel without touching the flag.
                        exit_reason = Some(
                            if session_for_waiter.reader_failed.load(Ordering::SeqCst) {
                                "reader_error"
                            } else {
                                "killed"
                            },
                        );
                        true
                    }
                    _ = tokio::time::sleep(Duration::from_millis(250)) => {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                let code = status.exit_code() as i32;
                                let _ = app_w.emit(EV_PTY_EXIT, PtyExitPayload {
                                    session_id: id_w.clone(),
                                    exit_code: code,
                                    reason: "normal".into(),
                                });
                                sessions_ref.lock().remove(&id_w);
                                true
                            }
                            Ok(None) => false,
                            Err(_) => {
                                let _ = app_w.emit(EV_PTY_EXIT, PtyExitPayload {
                                    session_id: id_w.clone(),
                                    exit_code: -1,
                                    reason: "reader_error".into(),
                                });
                                sessions_ref.lock().remove(&id_w);
                                true
                            }
                        }
                    }
                };
                if exited {
                    break;
                }
            }
            // If the loop broke via cancel (kill_all or explicit kill), the child
            // may still be alive — finish it and emit so the frontend can stop
            // showing "running". portable-pty's killer only sends SIGHUP, which a
            // HUP-ignoring child survives; if we then blocked on `child.wait()` we
            // would pin this tokio worker forever. So poll non-blockingly and
            // escalate to SIGKILL, never doing a blocking wait on the runtime.
            if let Some(reason) = exit_reason {
                let _ = child.kill(); // SIGHUP (or TerminateProcess on Windows)
                let pid = session_for_waiter.pid;
                let grace = Instant::now() + Duration::from_millis(400);
                let deadline = Instant::now() + Duration::from_secs(3);
                let mut hard_killed = false;
                let mut exit_code = -1;
                loop {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            exit_code = status.exit_code() as i32;
                            break;
                        }
                        _ => {}
                    }
                    let now = Instant::now();
                    if !hard_killed && now >= grace && pid != 0 {
                        #[cfg(unix)]
                        unsafe {
                            // SIGKILL the whole process group (the child is a
                            // session leader via setsid, so descendants die too).
                            libc::kill(-(pid as i32), libc::SIGKILL);
                            libc::kill(pid as i32, libc::SIGKILL);
                        }
                        hard_killed = true;
                    }
                    if now >= deadline {
                        break; // SIGKILL is unignorable; this is a paranoia backstop
                    }
                    tokio::time::sleep(Duration::from_millis(40)).await;
                }
                let _ = app_w.emit(EV_PTY_EXIT, PtyExitPayload {
                    session_id: id_w.clone(),
                    exit_code,
                    reason: reason.into(),
                });
                sessions_ref.lock().remove(&id_w);
            }
            // Self-evict from the waiter handle map once we're really done.
            // `kill_all` may have already drained the map; either path is fine.
            waiters_ref.lock().remove(&id_w);
        });
        self.waiters.lock().insert(id_for_waiter_key, waiter_handle);

        Ok(id)
    }

    /// Reap every live PTY session: notify cancel + send SIGKILL to each, then
    /// await every waiter task with an overall 2s budget so the children are
    /// actually finished (not just signaled) before the runtime shuts down.
    /// Called from the `WindowEvent::CloseRequested` handler on app quit.
    pub async fn kill_all(&self) {
        // Snapshot the live sessions outside the lock so the kill calls below
        // don't hold the mutex across awaits.
        let sessions: Vec<Arc<PtySession>> = {
            self.sessions.lock().values().cloned().collect()
        };
        let count = sessions.len();
        for s in &sessions {
            s.kill();
        }
        let handles: Vec<tokio::task::JoinHandle<()>> = {
            let mut waiters = self.waiters.lock();
            std::mem::take(&mut *waiters).into_values().collect()
        };
        // Sequential await is fine — the tasks were already in flight, so the
        // total wall-time is bounded by the slowest, not the sum. The outer
        // timeout caps the whole reap at 2s for snappy Cmd+Q.
        let _ = tokio::time::timeout(Duration::from_secs(2), async move {
            for h in handles {
                let _ = h.await;
            }
        })
        .await;
        eprintln!("[metacodex] kill_all reaped {count} pty session(s)");
    }

    pub fn write(&self, session_id: &str, bytes: &[u8]) -> AppResult<()> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("pty session {session_id}")))?;
        session
            .write_bytes(bytes)
            .map_err(|e| AppError::Pty(format!("write: {e}")))?;
        Ok(())
    }

    pub fn resize(&self, session_id: &str, rows: u16, cols: u16) -> AppResult<()> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("pty session {session_id}")))?;
        session.resize(rows, cols).map_err(AppError::Pty)
    }

    pub fn kill(&self, session_id: &str) -> AppResult<()> {
        let session = self.sessions.lock().get(session_id).cloned();
        if let Some(s) = session {
            s.kill();
        }
        // Removal happens in the waiter task when it observes the exit.
        Ok(())
    }

    pub fn list(&self) -> Vec<PtySessionInfo> {
        self.sessions
            .lock()
            .values()
            .map(|s| PtySessionInfo {
                id: s.id.clone(),
                project_id: s.project_id.clone(),
                label: s.label.clone(),
                cwd: s.cwd.clone(),
                kind: s.kind.clone(),
                cli_id: s.cli_id.clone(),
                created_at: s.created_at.to_rfc3339(),
            })
            .collect()
    }

    /// Snapshot (id, pid, current_cwd) tuples for a list of session ids — used
    /// by `pty_metadata_batch` to do the slow per-session work after releasing
    /// the manager's mutex. Missing sessions are silently skipped.
    pub fn sessions_for_metadata(&self, ids: &[String]) -> Vec<(String, u32, String)> {
        let sessions = self.sessions.lock();
        ids.iter()
            .filter_map(|id| sessions.get(id).map(|s| (id.clone(), s.pid, s.current_cwd())))
            .collect()
    }

    /// Project owning a session, if any. Used by `pty_update_cwd` to decide
    /// whether the incoming cwd needs to live inside the project sandbox.
    pub fn project_id_of(&self, session_id: &str) -> Option<String> {
        self.sessions
            .lock()
            .get(session_id)
            .and_then(|s| s.project_id.clone())
    }

    /// Push a cwd hint to a live session (OSC 7).
    pub fn set_cwd_override(&self, session_id: &str, cwd: String) -> AppResult<()> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("pty session {session_id}")))?;
        session.set_cwd_override(cwd);
        Ok(())
    }
}
