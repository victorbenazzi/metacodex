use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::Serialize;

use super::event_journal::PtyEventEnvelope;
use super::supervisor::{PtyLifecycleState, PtyStopReason, PtySupervisor};
use super::PtySpawnSpec;

pub struct PreparedPtySession {
    pub id: String,
    pub spec: PtySpawnSpec,
    pub supervisor: Arc<PtySupervisor>,
    pub created_at: DateTime<Utc>,
}

impl PreparedPtySession {
    pub fn new(id: String, spec: PtySpawnSpec) -> Self {
        Self {
            supervisor: Arc::new(PtySupervisor::new(id.clone(), false)),
            id,
            spec,
            created_at: Utc::now(),
        }
    }

    pub fn attach(&self) -> Result<(), String> {
        self.supervisor.confirm_attachment()
    }

    pub fn begin_start(&self) -> Result<(), String> {
        self.supervisor.begin_start()
    }

    pub fn cancel(&self) {
        self.supervisor.request_stop(PtyStopReason::Killed);
    }

    pub fn child_start_authorized(&self) -> bool {
        matches!(
            self.supervisor.state(),
            PtyLifecycleState::Starting | PtyLifecycleState::Running
        ) && self.supervisor.current_stop_reason().is_running()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyPrepareResponse {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyAttachResponse {
    pub events: Vec<PtyEventEnvelope>,
    pub last_seq: u64,
    pub state: PtyLifecycleState,
}

#[cfg(test)]
mod tests {
    use super::PreparedPtySession;
    use crate::pty::supervisor::PtyStopReason;
    use crate::pty::{PtyKind, PtySpawnSpec};

    fn spec() -> PtySpawnSpec {
        PtySpawnSpec {
            project_id: Some("project".into()),
            cwd: "/project".into(),
            rows: 28,
            cols: 100,
            kind: PtyKind::Plain,
            label: "Shell".into(),
            cli_id: None,
            theme_kind: Some("dark".into()),
        }
    }

    #[test]
    fn child_does_not_start_before_attach() {
        let prepared = PreparedPtySession::new("session".into(), spec());

        assert!(prepared.begin_start().is_err());
        assert!(!prepared.child_start_authorized());
    }

    #[test]
    fn attach_authorizes_exactly_one_start() {
        let prepared = PreparedPtySession::new("session".into(), spec());

        prepared.attach().expect("attach");
        prepared.begin_start().expect("first start");

        assert!(prepared.child_start_authorized());
        assert!(prepared.begin_start().is_err());
    }

    #[test]
    fn canceled_prepared_session_never_authorizes_a_child() {
        let prepared = PreparedPtySession::new("session".into(), spec());

        prepared.cancel();

        assert!(prepared.attach().is_err());
        assert!(prepared.begin_start().is_err());
        assert!(!prepared.child_start_authorized());
    }

    #[test]
    fn delivers_exit_when_child_exits_before_start_returns() {
        let prepared = PreparedPtySession::new("session".into(), spec());
        prepared.attach().expect("attach");
        prepared.begin_start().expect("start authorization");

        let data = prepared
            .supervisor
            .record_data("ZmFzdA==".into())
            .expect("initial output");
        let exit = prepared
            .supervisor
            .record_exit(PtyStopReason::NormalExit { code: 0 })
            .expect("fast exit");

        assert_eq!([data.seq, exit.seq], [1, 2]);
        let replay = prepared.supervisor.replay_after(0);
        assert_eq!(replay.len(), 2);
        assert_eq!(replay[1].seq, 2);
    }
}
