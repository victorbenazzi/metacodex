pub mod session;
pub mod shell;

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Notify};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::events::{PtyDataPayload, PtyExitPayload, EV_PTY_DATA, EV_PTY_EXIT};

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
    app_handle: AppHandle,
}

impl PtyManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            app_handle,
        }
    }

    pub fn spawn(&self, spec: PtySpawnSpec) -> AppResult<String> {
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

        let session = Arc::new(PtySession {
            id: id.clone(),
            project_id: spec.project_id.clone(),
            label: spec.label.clone(),
            cwd: spec.cwd.clone(),
            kind: kind_label,
            cli_id,
            created_at: Utc::now(),
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            killer: Mutex::new(killer),
            cancel: cancel.clone(),
        });

        self.sessions.lock().insert(id.clone(), session.clone());

        // ----- reader thread: blocking std::thread, pushes chunks into channel -----
        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let id_for_thread = id.clone();
        std::thread::Builder::new()
            .name(format!("pty-reader-{id_for_thread}"))
            .spawn(move || {
                let mut reader = reader;
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break, // EOF
                        Ok(n) => {
                            if tx.send(buf[..n].to_vec()).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
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
        let cancel_w = cancel.clone();
        tokio::spawn(async move {
            let mut child = child;
            loop {
                let exited = tokio::select! {
                    _ = cancel_w.notified() => true,
                    _ = tokio::time::sleep(Duration::from_millis(250)) => {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                let code = status.exit_code() as i32;
                                let _ = app_w.emit(EV_PTY_EXIT, PtyExitPayload {
                                    session_id: id_w.clone(),
                                    exit_code: code,
                                });
                                sessions_ref.lock().remove(&id_w);
                                true
                            }
                            Ok(None) => false,
                            Err(_) => {
                                let _ = app_w.emit(EV_PTY_EXIT, PtyExitPayload {
                                    session_id: id_w.clone(),
                                    exit_code: -1,
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
            // Best-effort final kill if the loop broke via cancel (kill request).
            // The child may already be dead — ignore errors.
            let _ = child.kill();
            let _ = child.wait();
        });

        Ok(id)
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
}
