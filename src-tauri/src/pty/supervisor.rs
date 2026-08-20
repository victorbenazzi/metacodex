use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::events::{PtyBackpressurePayload, PtyDataPayload, PtyExitPayload};

use super::event_journal::{PtyEvent, PtyEventEnvelope, PtyEventJournal};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PtyLifecycleState {
    Prepared,
    Attached,
    Starting,
    Running,
    Stopping,
    Exited,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyStopReason {
    Running,
    NormalExit { code: i32 },
    Killed,
    ReaderError,
    DrainerStalled,
    SpawnFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyCleanupOutcome {
    Pending,
    Complete,
    Failed(String),
}

impl PtyStopReason {
    pub fn is_running(&self) -> bool {
        matches!(self, Self::Running)
    }

    pub fn exit_code(&self) -> i32 {
        match self {
            Self::NormalExit { code } => *code,
            _ => -1,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Running | Self::NormalExit { .. } => "normal",
            Self::Killed => "killed",
            Self::ReaderError => "reader_error",
            Self::DrainerStalled => "drainer_stalled",
            Self::SpawnFailed => "spawn_failed",
        }
    }
}

pub struct PtySupervisor {
    session_id: String,
    lifecycle: Mutex<PtyLifecycleState>,
    stop_reason: Mutex<PtyStopReason>,
    stop_tx: watch::Sender<PtyStopReason>,
    cleanup_tx: watch::Sender<PtyCleanupOutcome>,
    journal: Mutex<PtyEventJournal>,
}

impl PtySupervisor {
    pub fn new(session_id: String, attachment_confirmed: bool) -> Self {
        let (stop_tx, _) = watch::channel(PtyStopReason::Running);
        let (cleanup_tx, _) = watch::channel(PtyCleanupOutcome::Pending);
        Self {
            lifecycle: Mutex::new(if attachment_confirmed {
                PtyLifecycleState::Running
            } else {
                PtyLifecycleState::Prepared
            }),
            stop_reason: Mutex::new(PtyStopReason::Running),
            stop_tx,
            cleanup_tx,
            journal: Mutex::new(PtyEventJournal::new(
                session_id.clone(),
                attachment_confirmed,
            )),
            session_id,
        }
    }

    pub fn subscribe_stop(&self) -> watch::Receiver<PtyStopReason> {
        self.stop_tx.subscribe()
    }

    pub fn request_stop(&self, reason: PtyStopReason) {
        let mut current = self.stop_reason.lock();
        if Self::should_replace_reason(&current, &reason) {
            *current = reason.clone();
            self.stop_tx.send_replace(reason);
        }
        drop(current);
        let mut lifecycle = self.lifecycle.lock();
        if *lifecycle != PtyLifecycleState::Exited {
            *lifecycle = PtyLifecycleState::Stopping;
        }
    }

    pub fn current_stop_reason(&self) -> PtyStopReason {
        self.stop_reason.lock().clone()
    }

    pub fn record_data(&self, data_b64: String) -> Option<PtyDataPayload> {
        let envelope = self.journal.lock().push(PtyEvent::Data { data_b64 })?;
        let PtyEvent::Data { data_b64 } = envelope.event else {
            unreachable!("data envelope contains a data event");
        };
        Some(PtyDataPayload {
            session_id: envelope.session_id,
            seq: envelope.seq,
            data_b64,
        })
    }

    pub fn record_backpressure(
        &self,
        queue_depth: usize,
        stalled_ms: u64,
    ) -> Option<PtyBackpressurePayload> {
        let envelope = self.journal.lock().push(PtyEvent::Backpressure {
            queue_depth,
            stalled_ms,
        })?;
        Some(PtyBackpressurePayload {
            session_id: envelope.session_id,
            seq: envelope.seq,
            queue_depth,
            stalled_ms,
        })
    }

    pub fn record_exit(&self, reason: PtyStopReason) -> Option<PtyExitPayload> {
        let exit_code = reason.exit_code();
        let reason_label = reason.as_str().to_string();
        let envelope = self.journal.lock().push(PtyEvent::Exit {
            exit_code,
            reason: reason_label.clone(),
        })?;
        Some(PtyExitPayload {
            session_id: envelope.session_id,
            seq: envelope.seq,
            exit_code,
            reason: reason_label,
        })
    }

    pub fn mark_exited(&self) {
        *self.lifecycle.lock() = PtyLifecycleState::Exited;
    }

    pub fn mark_cleanup_complete(&self, failure: Option<String>) {
        self.cleanup_tx.send_replace(match failure {
            Some(message) => PtyCleanupOutcome::Failed(message),
            None => PtyCleanupOutcome::Complete,
        });
    }

    pub fn cleanup_outcome(&self) -> PtyCleanupOutcome {
        self.cleanup_tx.borrow().clone()
    }

    pub async fn wait_for_cleanup(&self) -> Result<(), String> {
        let mut cleanup_rx = self.cleanup_tx.subscribe();
        if let Some(result) = Self::cleanup_result(&cleanup_rx.borrow()) {
            return result;
        }
        while cleanup_rx.changed().await.is_ok() {
            if let Some(result) = Self::cleanup_result(&cleanup_rx.borrow()) {
                return result;
            }
        }
        Err("cleanup coordinator closed before reporting an outcome".into())
    }

    pub fn replay_after(&self, after_seq: u64) -> Vec<PtyEventEnvelope> {
        self.journal.lock().replay_after(after_seq)
    }

    pub fn confirm_attachment(&self) -> Result<(), String> {
        let mut lifecycle = self.lifecycle.lock();
        match *lifecycle {
            PtyLifecycleState::Prepared => {
                *lifecycle = PtyLifecycleState::Attached;
            }
            PtyLifecycleState::Attached => {}
            state => return Err(format!("cannot attach PTY in state {state:?}")),
        }
        drop(lifecycle);
        self.journal.lock().confirm_attachment();
        Ok(())
    }

    pub fn begin_start(&self) -> Result<(), String> {
        let stop_reason = self.stop_reason.lock();
        if !stop_reason.is_running() {
            return Err("cannot start a canceled PTY".into());
        }
        let mut lifecycle = self.lifecycle.lock();
        if *lifecycle != PtyLifecycleState::Attached {
            return Err(format!("cannot start PTY in state {:?}", *lifecycle));
        }
        *lifecycle = PtyLifecycleState::Starting;
        Ok(())
    }

    pub fn mark_running(&self) {
        let stop_reason = self.stop_reason.lock();
        let mut lifecycle = self.lifecycle.lock();
        if *lifecycle == PtyLifecycleState::Starting && stop_reason.is_running() {
            *lifecycle = PtyLifecycleState::Running;
        }
    }

    pub fn last_seq(&self) -> u64 {
        self.journal.lock().last_seq()
    }

    pub fn state(&self) -> PtyLifecycleState {
        *self.lifecycle.lock()
    }

    pub fn state_label(&self) -> &'static str {
        match self.state() {
            PtyLifecycleState::Prepared => "prepared",
            PtyLifecycleState::Attached => "attached",
            PtyLifecycleState::Starting => "starting",
            PtyLifecycleState::Running => "running",
            PtyLifecycleState::Stopping => "stopping",
            PtyLifecycleState::Exited => "exited",
        }
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    fn should_replace_reason(current: &PtyStopReason, next: &PtyStopReason) -> bool {
        match (current, next) {
            (PtyStopReason::Running, _) => true,
            (PtyStopReason::Killed, PtyStopReason::ReaderError) => true,
            (PtyStopReason::Killed, PtyStopReason::DrainerStalled) => true,
            (_, _) => false,
        }
    }

    fn cleanup_result(outcome: &PtyCleanupOutcome) -> Option<Result<(), String>> {
        match outcome {
            PtyCleanupOutcome::Pending => None,
            PtyCleanupOutcome::Complete => Some(Ok(())),
            PtyCleanupOutcome::Failed(message) => Some(Err(message.clone())),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{PtyStopReason, PtySupervisor};

    #[tokio::test]
    async fn reader_error_persists_when_it_happens_before_waiter_polling() {
        let supervisor = PtySupervisor::new("session".into(), true);
        supervisor.request_stop(PtyStopReason::ReaderError);

        let receiver = supervisor.subscribe_stop();
        assert_eq!(*receiver.borrow(), PtyStopReason::ReaderError);
        let exit = supervisor
            .record_exit(receiver.borrow().clone())
            .expect("one reader error exit");
        assert_eq!(exit.reason, "reader_error");
        assert!(supervisor.record_exit(PtyStopReason::ReaderError).is_none());
    }

    #[tokio::test]
    async fn reader_error_persists_when_it_happens_between_waiter_polls() {
        let supervisor = Arc::new(PtySupervisor::new("session".into(), true));
        let mut receiver = supervisor.subscribe_stop();
        assert_eq!(*receiver.borrow(), PtyStopReason::Running);

        supervisor.request_stop(PtyStopReason::ReaderError);
        receiver.changed().await.expect("persistent stop update");

        assert_eq!(*receiver.borrow(), PtyStopReason::ReaderError);
        let exit = supervisor
            .record_exit(receiver.borrow().clone())
            .expect("one reader error exit");
        assert_eq!(exit.reason, "reader_error");
        assert!(supervisor.record_exit(PtyStopReason::ReaderError).is_none());
    }

    #[test]
    fn reader_error_is_not_overwritten_by_a_later_kill() {
        let supervisor = PtySupervisor::new("session".into(), true);
        supervisor.request_stop(PtyStopReason::ReaderError);
        supervisor.request_stop(PtyStopReason::Killed);

        assert_eq!(supervisor.current_stop_reason(), PtyStopReason::ReaderError);
    }

    #[test]
    fn concurrent_kill_cannot_overwrite_reader_error() {
        for _ in 0..1_000 {
            let supervisor = Arc::new(PtySupervisor::new("session".into(), true));
            let reader = supervisor.clone();
            let killer = supervisor.clone();
            let reader_thread = std::thread::spawn(move || {
                reader.request_stop(PtyStopReason::ReaderError);
            });
            let killer_thread = std::thread::spawn(move || {
                killer.request_stop(PtyStopReason::Killed);
            });
            reader_thread.join().expect("reader signal thread");
            killer_thread.join().expect("kill signal thread");

            assert_eq!(supervisor.current_stop_reason(), PtyStopReason::ReaderError);
        }
    }

    #[test]
    fn emits_exactly_one_exit_and_no_later_data() {
        let supervisor = PtySupervisor::new("session".into(), true);

        let exit = supervisor.record_exit(PtyStopReason::ReaderError);

        assert_eq!(exit.expect("first exit").reason, "reader_error");
        assert!(supervisor.record_exit(PtyStopReason::ReaderError).is_none());
        assert!(supervisor.record_data("bGF0ZQ==".into()).is_none());
        assert_eq!(supervisor.last_seq(), 1);
    }
}
