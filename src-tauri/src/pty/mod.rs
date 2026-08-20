pub mod event_journal;
#[cfg(windows)]
pub mod job;
pub mod protocol;
pub mod session;
pub mod shell;
pub mod supervisor;

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::events::{EV_PTY_BACKPRESSURE, EV_PTY_DATA, EV_PTY_EXIT};

use protocol::{PreparedPtySession, PtyAttachResponse, PtyPrepareResponse};
pub use session::PtySession;
use supervisor::{PtyCleanupOutcome, PtyStopReason, PtySupervisor};

const PTY_FLUSH_BYTES: usize = 64 * 1024;
const PTY_FLUSH_MS: u64 = 16;
const PTY_RETAINED_SESSIONS: usize = 64;

fn emit_pty_buffer(app: &AppHandle, supervisor: &PtySupervisor, pending: &mut Vec<u8>) {
    if pending.is_empty() {
        return;
    }
    let bytes = std::mem::take(pending);
    if let Some(payload) = supervisor.record_data(STANDARD.encode(&bytes)) {
        let _ = app.emit(EV_PTY_DATA, payload);
    }
}

fn evict_session_ownership<T>(
    session_id: &str,
    sessions: &Mutex<HashMap<String, T>>,
    waiters: &Mutex<HashSet<String>>,
    supervisor: &PtySupervisor,
    cleanup_failure: Option<String>,
) {
    sessions.lock().remove(session_id);
    waiters.lock().remove(session_id);
    supervisor.mark_cleanup_complete(cleanup_failure);
}

fn retain_terminal_supervisor(
    session_id: &str,
    retained: &Mutex<VecDeque<(String, Arc<PtySupervisor>)>>,
    supervisor: Arc<PtySupervisor>,
) {
    let mut retained = retained.lock();
    retained.retain(|(id, _)| id != session_id);
    retained.push_back((session_id.to_string(), supervisor));
    while retained.len() > PTY_RETAINED_SESSIONS {
        retained.pop_front();
    }
}

#[cfg(test)]
mod characterization_tests {
    use std::collections::{HashMap, HashSet};

    use parking_lot::Mutex;

    use super::{evict_session_ownership, PtyCleanupOutcome, PtyStopReason, PtySupervisor};

    const SOURCE: &str = include_str!("mod.rs");

    #[test]
    fn no_drop_transport_uses_bounded_blocking_send() {
        assert!(SOURCE.contains("mpsc::channel::<Vec<u8>>(4096)"));
        assert!(SOURCE.contains("tx.blocking_send(chunk)"));
        let forbidden_drop = ["TrySendError::Full(", "_) => return"].concat();
        assert!(!SOURCE.contains(&forbidden_drop));
    }

    #[test]
    fn reader_failure_uses_persistent_supervisor_state() {
        assert!(SOURCE.contains("request_stop(PtyStopReason::ReaderError)"));
        assert!(SOURCE.contains("subscribe_stop()"));
    }

    #[tokio::test]
    async fn kill_finalization_emits_once_and_evicts_all_ownership() {
        let supervisor = PtySupervisor::new("session".into(), true);
        supervisor.request_stop(PtyStopReason::Killed);
        let sessions = Mutex::new(HashMap::from([("session".to_string(), ())]));
        let waiters = Mutex::new(HashSet::from(["session".to_string()]));

        assert!(supervisor.record_exit(PtyStopReason::Killed).is_some());
        assert!(supervisor.record_exit(PtyStopReason::Killed).is_none());
        evict_session_ownership("session", &sessions, &waiters, &supervisor, None);

        assert!(sessions.lock().is_empty());
        assert!(waiters.lock().is_empty());
        assert_eq!(supervisor.cleanup_outcome(), PtyCleanupOutcome::Complete);
        supervisor.wait_for_cleanup().await.expect("clean stop");
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PtyKind {
    Plain,
    Cli {
        executable: String,
        args: Vec<String>,
        #[serde(default)]
        environment: HashMap<String, String>,
    },
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
    /// App theme kind at spawn time ("light" | "dark"). Exported as
    /// COLORFGBG so background-detecting TUIs (Claude Code, vim, ...) start
    /// with colors matching the app theme instead of assuming a dark
    /// terminal.
    #[serde(default)]
    pub theme_kind: Option<String>,
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
    pub state: String,
    pub latest_seq: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PtyKillAllReport {
    pub requested: usize,
    pub completed: usize,
    pub failed: usize,
    pub timed_out: usize,
}

type RetainedSupervisors = Arc<Mutex<VecDeque<(String, Arc<PtySupervisor>)>>>;

pub struct PtyManager {
    prepared: Arc<Mutex<HashMap<String, Arc<PreparedPtySession>>>>,
    sessions: Arc<Mutex<HashMap<String, Arc<PtySession>>>>,
    /// Live waiter ownership. Entries are inserted before task creation and
    /// removed only after exit emission and session eviction.
    waiters: Arc<Mutex<HashSet<String>>>,
    retained: RetainedSupervisors,
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
            prepared: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            waiters: Arc::new(Mutex::new(HashSet::new())),
            retained: Arc::new(Mutex::new(VecDeque::new())),
            #[cfg(windows)]
            spawn_lock: Mutex::new(()),
            app_handle,
        }
    }

    pub fn prepare(&self, spec: PtySpawnSpec) -> AppResult<PtyPrepareResponse> {
        let id = Uuid::new_v4().to_string();
        let prepared = Arc::new(PreparedPtySession::new(id.clone(), spec));
        self.prepared.lock().insert(id.clone(), prepared);
        Ok(PtyPrepareResponse { session_id: id })
    }

    pub fn attach(&self, session_id: &str, after_seq: u64) -> AppResult<PtyAttachResponse> {
        let supervisor = if let Some(prepared) = self.prepared.lock().get(session_id).cloned() {
            prepared.attach().map_err(AppError::Pty)?;
            prepared.supervisor.clone()
        } else {
            self.find_supervisor(session_id)
                .ok_or_else(|| AppError::NotFound(format!("pty session {session_id}")))?
        };

        Ok(PtyAttachResponse {
            events: supervisor.replay_after(after_seq),
            last_seq: supervisor.last_seq(),
            state: supervisor.state(),
        })
    }

    pub fn start(&self, session_id: &str) -> AppResult<()> {
        let prepared = self
            .prepared
            .lock()
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("prepared pty session {session_id}")))?;
        prepared.begin_start().map_err(AppError::Pty)?;
        let result = self.spawn_started(
            prepared.id.clone(),
            prepared.spec.clone(),
            prepared.supervisor.clone(),
        );
        if result.is_err() && !self.sessions.lock().contains_key(session_id) {
            self.finish_prepared(&prepared, PtyStopReason::SpawnFailed);
        }
        result
    }

    fn find_supervisor(&self, session_id: &str) -> Option<Arc<PtySupervisor>> {
        if let Some(session) = self.sessions.lock().get(session_id).cloned() {
            return Some(session.supervisor.clone());
        }
        self.retained
            .lock()
            .iter()
            .rev()
            .find(|(id, _)| id == session_id)
            .map(|(_, supervisor)| supervisor.clone())
    }

    fn finish_prepared(&self, prepared: &PreparedPtySession, reason: PtyStopReason) {
        prepared.supervisor.request_stop(reason.clone());
        let final_reason = prepared.supervisor.current_stop_reason();
        if let Some(payload) = prepared.supervisor.record_exit(final_reason) {
            let _ = self.app_handle.emit(EV_PTY_EXIT, payload);
        }
        prepared.supervisor.mark_exited();
        retain_terminal_supervisor(&prepared.id, &self.retained, prepared.supervisor.clone());
        self.prepared.lock().remove(&prepared.id);
        prepared.supervisor.mark_cleanup_complete(None);
    }

    fn spawn_started(
        &self,
        id: String,
        spec: PtySpawnSpec,
        supervisor: Arc<PtySupervisor>,
    ) -> AppResult<()> {
        #[cfg(windows)]
        let _spawn_guard = self.spawn_lock.lock();

        let (program, args, kind_label, cli_id) = match &spec.kind {
            PtyKind::Plain => {
                let (p, a) = shell::detect_login_shell();
                (p, a, "shell".to_string(), None)
            }
            PtyKind::Cli {
                executable, args, ..
            } => {
                let (p, a) = shell::cli_launch_args(executable, args);
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
        if let PtyKind::Cli { environment, .. } = &spec.kind {
            for (key, value) in environment {
                cmd.env(key, value);
            }
        }
        // Signal light/dark to background-detecting TUIs (Claude Code, Codex,
        // vim, …) at spawn. COLORFGBG is the rxvt "fg;bg" ANSI-index convention
        // (light = 0;15, dark = 15;0). CLITHEME is the newer explicit hint.
        // Detection is startup-only: a running session keeps the palette it
        // picked; xterm.js still swaps the emulator colors live.
        if let Some(kind) = spec.theme_kind.as_deref() {
            let light = kind == "light";
            cmd.env("COLORFGBG", if light { "0;15" } else { "15;0" });
            cmd.env("CLITHEME", if light { "light" } else { "dark" });
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

        // Drop the slave handle , once the child has been spawned with it, we no
        // longer need it. Keeping it open can prevent the master from seeing EOF
        // when the child exits.
        drop(pair.slave);

        // Windows: assign the spawned process to a KILL_ON_JOB_CLOSE Job Object
        // so dropping the session terminates the whole descendant tree (the
        // shell + `claude.cmd` + `node.exe`). Best-effort: if any Win32 call
        // fails we still return the session , the user just loses descendant
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
            supervisor: supervisor.clone(),
            cwd_override: Mutex::new(None),
            #[cfg(windows)]
            job,
        });

        self.sessions.lock().insert(id.clone(), session.clone());
        self.prepared.lock().remove(&id);
        supervisor.mark_running();

        // ----- reader thread: blocking std::thread, pushes chunks into channel -----
        // Bounded channel (4096 chunks of ~8KiB each ≈ 32MiB max in-flight). When
        // the drainer can't keep up , e.g. `cat /dev/urandom`, runaway log dumps,
        // an infinite stack trace , `blocking_send` parks the reader instead of
        // unbounded growth. The PTY's pipe buffer then back-pressures the child
        // process via natural SIGPIPE/EAGAIN semantics, which TUIs handle cleanly.
        //
        // We intentionally do NOT drop chunks here: TUIs like Claude Code / Codex
        // emit stateful ESC sequences (cursor positioning, color); a missing chunk
        // mid-redraw leaves the screen incoherent until Ctrl+L.
        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(4096);
        let id_for_thread = id.clone();
        let app_pressure = self.app_handle.clone();
        let supervisor_for_reader = supervisor.clone();
        let (reader_done_tx, mut reader_done_rx) = oneshot::channel::<()>();
        let reader_spawned = std::thread::Builder::new()
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
                                        break;
                                    }
                                    let stalled_ms =
                                        started.elapsed().as_millis().min(u128::from(u64::MAX))
                                            as u64;
                                    if stalled_ms > 0
                                        && last_pressure_emit.elapsed() > Duration::from_secs(1)
                                    {
                                        last_pressure_emit = std::time::Instant::now();
                                        if let Some(payload) = supervisor_for_reader
                                            .record_backpressure(4096, stalled_ms)
                                        {
                                            let _ = app_pressure.emit(EV_PTY_BACKPRESSURE, payload);
                                        }
                                    }
                                }
                                Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => break,
                            }
                        }
                        Err(_) => {
                            supervisor_for_reader.request_stop(PtyStopReason::ReaderError);
                            break;
                        }
                    }
                }
                let _ = reader_done_tx.send(());
            });
        if let Err(e) = reader_spawned {
            // The session was already registered, but the waiter and drainer
            // below never spawn without a reader: nothing would ever reap the
            // child or evict the map entry. Undo both before bailing.
            self.sessions.lock().remove(&id);
            supervisor.request_stop(PtyStopReason::SpawnFailed);
            let _ = session.killer.lock().kill();
            return Err(AppError::Pty(format!("reader thread: {e}")));
        }

        let (drain_tx, mut drain_rx) = oneshot::channel::<()>();
        let app_d = self.app_handle.clone();
        let supervisor_for_drainer = supervisor.clone();
        let mut drainer_handle = tokio::spawn(async move {
            let mut pending = Vec::with_capacity(PTY_FLUSH_BYTES);
            let mut ticker = tokio::time::interval(Duration::from_millis(PTY_FLUSH_MS));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tokio::select! {
                    biased;
                    _ = &mut drain_rx => {
                        rx.close();
                        while let Some(chunk) = rx.recv().await {
                            pending.extend_from_slice(&chunk);
                            if pending.len() >= PTY_FLUSH_BYTES {
                                emit_pty_buffer(&app_d, &supervisor_for_drainer, &mut pending);
                            }
                        }
                        break;
                    }
                    maybe_chunk = rx.recv() => {
                        match maybe_chunk {
                            Some(chunk) => {
                                pending.extend_from_slice(&chunk);
                                if pending.len() >= PTY_FLUSH_BYTES {
                                    emit_pty_buffer(&app_d, &supervisor_for_drainer, &mut pending);
                                }
                            }
                            None => break,
                        }
                    }
                    _ = ticker.tick() => {
                        emit_pty_buffer(&app_d, &supervisor_for_drainer, &mut pending);
                    }
                }
            }
            emit_pty_buffer(&app_d, &supervisor_for_drainer, &mut pending);
        });

        let app_w = self.app_handle.clone();
        let id_w = id.clone();
        let sessions_ref = self.sessions.clone();
        let waiters_ref = self.waiters.clone();
        let retained_ref = self.retained.clone();
        let session_for_waiter = session.clone();
        let supervisor_for_waiter = supervisor.clone();
        self.waiters.lock().insert(id.clone());
        tokio::spawn(async move {
            let mut child = child;
            let mut stop_rx = supervisor_for_waiter.subscribe_stop();
            let mut final_reason;
            let mut cleanup_failure = None;

            loop {
                let requested = stop_rx.borrow().clone();
                if !requested.is_running() {
                    final_reason = requested;
                    break;
                }

                match child.try_wait() {
                    Ok(Some(status)) => {
                        final_reason = PtyStopReason::NormalExit {
                            code: status.exit_code() as i32,
                        };
                        break;
                    }
                    Ok(None) => {}
                    Err(_) => {
                        supervisor_for_waiter.request_stop(PtyStopReason::ReaderError);
                        final_reason = PtyStopReason::ReaderError;
                        break;
                    }
                }

                tokio::select! {
                    changed = stop_rx.changed() => {
                        if changed.is_err() {
                            final_reason = PtyStopReason::ReaderError;
                            break;
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_millis(40)) => {}
                }
            }

            if !matches!(final_reason, PtyStopReason::NormalExit { .. }) {
                let _ = child.kill();
                let pid = session_for_waiter.pid;
                let grace = Instant::now() + Duration::from_millis(400);
                let deadline = Instant::now() + Duration::from_millis(1_750);
                let mut hard_killed = false;
                let mut reaped = false;
                loop {
                    if let Ok(Some(_)) = child.try_wait() {
                        reaped = true;
                        break;
                    }
                    let now = Instant::now();
                    if !hard_killed && now >= grace && pid != 0 {
                        #[cfg(unix)]
                        unsafe {
                            libc::kill(-(pid as i32), libc::SIGKILL);
                            libc::kill(pid as i32, libc::SIGKILL);
                        }
                        hard_killed = true;
                    }
                    if now >= deadline {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(40)).await;
                }
                if !reaped {
                    cleanup_failure = Some("child process did not reap within 1750ms".to_string());
                }
            }

            match tokio::time::timeout(Duration::from_millis(400), &mut reader_done_rx).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => {
                    cleanup_failure = Some("reader thread ended without completion signal".into());
                }
                Err(_) => {
                    cleanup_failure = Some("reader thread exceeded the 400ms stop bound".into());
                }
            }

            let _ = drain_tx.send(());
            match tokio::time::timeout(Duration::from_millis(400), &mut drainer_handle).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => {
                    final_reason = PtyStopReason::DrainerStalled;
                    cleanup_failure = Some("drainer task failed before completion".to_string());
                }
                Err(_) => {
                    drainer_handle.abort();
                    let _ = drainer_handle.await;
                    final_reason = PtyStopReason::DrainerStalled;
                    cleanup_failure =
                        Some("drainer task exceeded the 400ms drain bound".to_string());
                }
            }

            if !matches!(final_reason, PtyStopReason::DrainerStalled) {
                let current_reason = supervisor_for_waiter.current_stop_reason();
                if !current_reason.is_running() {
                    final_reason = current_reason;
                }
            }

            if let Some(payload) = supervisor_for_waiter.record_exit(final_reason) {
                let _ = app_w.emit(EV_PTY_EXIT, payload);
            }
            supervisor_for_waiter.mark_exited();
            retain_terminal_supervisor(&id_w, &retained_ref, supervisor_for_waiter.clone());
            evict_session_ownership(
                &id_w,
                &sessions_ref,
                &waiters_ref,
                &supervisor_for_waiter,
                cleanup_failure,
            );
        });

        Ok(())
    }

    pub async fn kill_all(&self) -> PtyKillAllReport {
        let prepared: Vec<Arc<PreparedPtySession>> =
            self.prepared.lock().values().cloned().collect();
        let sessions: Vec<Arc<PtySession>> = { self.sessions.lock().values().cloned().collect() };
        let mut requested_ids = HashSet::new();
        for entry in &prepared {
            requested_ids.insert(entry.id.clone());
            entry.cancel();
            if entry.supervisor.state() != supervisor::PtyLifecycleState::Starting {
                self.finish_prepared(entry, PtyStopReason::Killed);
            }
        }
        for s in &sessions {
            requested_ids.insert(s.id.clone());
            s.kill();
        }
        let requested = requested_ids.len();

        let mut supervisors = HashMap::<String, Arc<PtySupervisor>>::new();
        for entry in &prepared {
            supervisors.insert(entry.id.clone(), entry.supervisor.clone());
        }
        for session in &sessions {
            supervisors.insert(session.id.clone(), session.supervisor.clone());
        }

        let wait_result = tokio::time::timeout(Duration::from_secs(3), async {
            for supervisor in supervisors.values() {
                let _ = supervisor.wait_for_cleanup().await;
            }
        })
        .await;

        let remaining_prepared = self.prepared.lock().len();
        let remaining_sessions = self.sessions.lock().len();
        let remaining_waiters = self.waiters.lock().len();
        let timed_out = remaining_prepared
            .max(remaining_sessions)
            .max(remaining_waiters);
        let failed = supervisors
            .values()
            .filter(|supervisor| {
                matches!(supervisor.cleanup_outcome(), PtyCleanupOutcome::Failed(_))
            })
            .count();
        let completed = requested.saturating_sub(timed_out).saturating_sub(failed);
        if wait_result.is_ok() && timed_out == 0 && failed == 0 {
            eprintln!("[metacodex] kill_all reaped {completed} pty session(s)");
        } else {
            eprintln!(
                "[metacodex] kill_all incomplete: {failed} failed, {remaining_prepared} prepared, {remaining_sessions} session(s) and {remaining_waiters} waiter(s) still owned"
            );
        }

        PtyKillAllReport {
            requested,
            completed,
            failed,
            timed_out,
        }
    }

    pub async fn kill_project(&self, project_id: &str) -> Vec<String> {
        let ids = self
            .list()
            .into_iter()
            .filter(|session| session.project_id.as_deref() == Some(project_id))
            .map(|session| session.id)
            .collect::<Vec<_>>();
        let mut warnings = Vec::new();
        for id in ids {
            if let Err(error) = self.kill(&id).await {
                warnings.push(format!("{id}: {error}"));
            }
        }
        warnings
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

    pub async fn kill(&self, session_id: &str) -> AppResult<()> {
        let prepared = { self.prepared.lock().get(session_id).cloned() };
        if let Some(prepared) = prepared {
            prepared.cancel();
            if prepared.supervisor.state() != supervisor::PtyLifecycleState::Starting {
                self.finish_prepared(&prepared, PtyStopReason::Killed);
            }
            let cleanup = tokio::time::timeout(
                Duration::from_secs(3),
                prepared.supervisor.wait_for_cleanup(),
            )
            .await
            .map_err(|_| {
                AppError::Pty(format!(
                    "stop timed out after 3s: prepared=true, state={}",
                    prepared.supervisor.state_label()
                ))
            })?;
            return cleanup.map_err(|resource| {
                AppError::Pty(format!("stop failed while releasing resource: {resource}"))
            });
        }

        let session = self.sessions.lock().get(session_id).cloned();
        if let Some(s) = session {
            s.kill();
            let cleanup =
                tokio::time::timeout(Duration::from_secs(3), s.supervisor.wait_for_cleanup())
                    .await
                    .map_err(|_| {
                        let session_owned = self.sessions.lock().contains_key(session_id);
                        let waiter_owned = self.waiters.lock().contains(session_id);
                        AppError::Pty(format!(
                        "stop timed out after 3s: session={session_owned}, waiter={waiter_owned}"
                    ))
                    })?;
            cleanup.map_err(|resource| {
                AppError::Pty(format!("stop failed while releasing resource: {resource}"))
            })?;
        }
        Ok(())
    }

    pub fn list(&self) -> Vec<PtySessionInfo> {
        let mut infos: Vec<PtySessionInfo> = self
            .sessions
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
                state: s.supervisor.state_label().to_string(),
                latest_seq: s.supervisor.last_seq(),
            })
            .collect();
        infos.extend(self.prepared.lock().values().map(|entry| PtySessionInfo {
            id: entry.id.clone(),
            project_id: entry.spec.project_id.clone(),
            label: entry.spec.label.clone(),
            cwd: entry.spec.cwd.clone(),
            kind: match &entry.spec.kind {
                PtyKind::Plain => "shell".into(),
                PtyKind::Cli { .. } => "cli".into(),
            },
            cli_id: entry.spec.cli_id.clone(),
            created_at: entry.created_at.to_rfc3339(),
            state: entry.supervisor.state_label().to_string(),
            latest_seq: entry.supervisor.last_seq(),
        }));
        infos
    }

    /// Snapshot (id, pid, current_cwd) tuples for a list of session ids , used
    /// by `pty_metadata_batch` to do the slow per-session work after releasing
    /// the manager's mutex. Missing sessions are silently skipped.
    pub fn sessions_for_metadata(
        &self,
        ids: &[String],
    ) -> Vec<(String, u32, String, Option<Vec<u32>>)> {
        let sessions = self.sessions.lock();
        ids.iter()
            .filter_map(|id| {
                sessions.get(id).map(|session| {
                    #[cfg(target_os = "windows")]
                    let owned_pids = session.job.as_ref().and_then(|job| job.process_ids().ok());
                    #[cfg(not(target_os = "windows"))]
                    let owned_pids = None;
                    (id.clone(), session.pid, session.current_cwd(), owned_pids)
                })
            })
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
