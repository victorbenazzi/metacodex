use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub const QUIT_DEADLINE: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuitFailure {
    pub area: String,
    pub code: String,
    pub message: String,
}

impl QuitFailure {
    pub fn new(
        area: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            area: area.into(),
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareQuitPayload {
    pub token: String,
    pub deadline_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuitBlockedPayload {
    pub token: String,
    pub failures: Vec<QuitFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuitTransition {
    Ignored,
    StopResources,
    Blocked(Vec<QuitFailure>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RuntimeState {
    Running,
    Quiescing { token: String },
    Stopping { token: String },
    Stopped,
}

#[derive(Debug)]
struct RuntimeInner {
    state: RuntimeState,
    blocked_token: Option<String>,
}

pub struct RuntimeSupervisor {
    inner: Mutex<RuntimeInner>,
}

impl Default for RuntimeSupervisor {
    fn default() -> Self {
        Self {
            inner: Mutex::new(RuntimeInner {
                state: RuntimeState::Running,
                blocked_token: None,
            }),
        }
    }
}

impl RuntimeSupervisor {
    pub fn ensure_running(&self) -> AppResult<()> {
        let inner = self.inner.lock();
        if inner.state == RuntimeState::Running {
            Ok(())
        } else {
            Err(AppError::AppQuiescing)
        }
    }

    pub fn begin_quit(&self) -> Option<PrepareQuitPayload> {
        let mut inner = self.inner.lock();
        if inner.state != RuntimeState::Running || inner.blocked_token.is_some() {
            return None;
        }
        Some(Self::start_quiescing(&mut inner))
    }

    pub fn active_token(&self) -> Option<String> {
        let inner = self.inner.lock();
        match &inner.state {
            RuntimeState::Quiescing { token } | RuntimeState::Stopping { token } => {
                Some(token.clone())
            }
            RuntimeState::Running | RuntimeState::Stopped => None,
        }
    }

    pub fn acknowledge(&self, token: &str, failures: Vec<QuitFailure>) -> QuitTransition {
        let mut inner = self.inner.lock();
        if inner.state
            != (RuntimeState::Quiescing {
                token: token.to_string(),
            })
        {
            return QuitTransition::Ignored;
        }
        if failures.is_empty() {
            inner.state = RuntimeState::Stopping {
                token: token.to_string(),
            };
            QuitTransition::StopResources
        } else {
            inner.state = RuntimeState::Running;
            inner.blocked_token = Some(token.to_string());
            QuitTransition::Blocked(failures)
        }
    }

    pub fn timeout(&self, token: &str) -> Option<Vec<QuitFailure>> {
        let failure = QuitFailure::new(
            "quit",
            "flush_timeout",
            "Saving did not finish within five seconds.",
        );
        match self.acknowledge(token, vec![failure.clone()]) {
            QuitTransition::Blocked(failures) => Some(failures),
            QuitTransition::Ignored | QuitTransition::StopResources => None,
        }
    }

    pub fn retry(&self, blocked_token: &str) -> Option<PrepareQuitPayload> {
        let mut inner = self.inner.lock();
        if inner.state != RuntimeState::Running
            || inner.blocked_token.as_deref() != Some(blocked_token)
        {
            return None;
        }
        inner.blocked_token = None;
        Some(Self::start_quiescing(&mut inner))
    }

    pub fn force(&self, blocked_token: &str) -> bool {
        let mut inner = self.inner.lock();
        if inner.state != RuntimeState::Running
            || inner.blocked_token.as_deref() != Some(blocked_token)
        {
            return false;
        }
        inner.blocked_token = None;
        inner.state = RuntimeState::Stopping {
            token: blocked_token.to_string(),
        };
        true
    }

    pub fn cleanup_failed(&self, token: &str, failures: Vec<QuitFailure>) -> bool {
        let mut inner = self.inner.lock();
        if inner.state
            != (RuntimeState::Stopping {
                token: token.to_string(),
            })
        {
            return false;
        }
        inner.state = RuntimeState::Running;
        inner.blocked_token = Some(token.to_string());
        !failures.is_empty()
    }

    pub fn mark_stopped(&self, token: &str) -> bool {
        let mut inner = self.inner.lock();
        if inner.state
            != (RuntimeState::Stopping {
                token: token.to_string(),
            })
        {
            return false;
        }
        inner.state = RuntimeState::Stopped;
        true
    }

    fn start_quiescing(inner: &mut RuntimeInner) -> PrepareQuitPayload {
        let token = Uuid::new_v4().to_string();
        inner.state = RuntimeState::Quiescing {
            token: token.clone(),
        };
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        PrepareQuitPayload {
            token,
            deadline_ms: (now + QUIT_DEADLINE).as_millis().min(u64::MAX as u128) as u64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{QuitFailure, QuitTransition, RuntimeSupervisor};

    #[test]
    fn repeated_close_requests_create_one_quit_token() {
        let runtime = RuntimeSupervisor::default();
        let first = runtime.begin_quit().expect("first close starts quiescing");
        assert!(runtime.begin_quit().is_none());
        assert_eq!(
            runtime.active_token().as_deref(),
            Some(first.token.as_str())
        );
    }

    #[test]
    fn rejects_pty_and_clone_starts_while_quiescing() {
        let runtime = RuntimeSupervisor::default();
        runtime.begin_quit().expect("quit token");
        let err = runtime.ensure_running().expect_err("must reject new work");
        assert_eq!(serde_json::to_value(err).unwrap()["code"], "app_quiescing");
    }

    #[test]
    fn failed_acknowledgement_returns_to_running_and_can_retry() {
        let runtime = RuntimeSupervisor::default();
        let first = runtime.begin_quit().expect("quit token");
        let failure = QuitFailure::new("workspace", "save_failed", "disk full");
        let transition = runtime.acknowledge(&first.token, vec![failure.clone()]);
        assert_eq!(transition, QuitTransition::Blocked(vec![failure]));
        assert!(runtime.ensure_running().is_ok());
        let retry = runtime.retry(&first.token).expect("retry token");
        assert_ne!(retry.token, first.token);
    }

    #[test]
    fn successful_acknowledgement_enters_stopping() {
        let runtime = RuntimeSupervisor::default();
        let prepare = runtime.begin_quit().expect("quit token");
        assert_eq!(
            runtime.acknowledge(&prepare.token, Vec::new()),
            QuitTransition::StopResources
        );
        assert!(runtime.ensure_running().is_err());
    }

    #[test]
    fn timeout_keeps_app_open_and_requires_explicit_retry_or_force() {
        let runtime = RuntimeSupervisor::default();
        let prepare = runtime.begin_quit().expect("quit token");
        let failures = runtime
            .timeout(&prepare.token)
            .expect("timeout blocks quit");
        assert_eq!(failures[0].area, "quit");
        assert_eq!(failures[0].code, "flush_timeout");
        assert!(runtime.ensure_running().is_ok());
        assert!(runtime.begin_quit().is_none());
        assert!(runtime.force(&prepare.token));
    }
}
