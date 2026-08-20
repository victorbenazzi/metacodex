use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

const MAX_RETAINED_EVENTS: usize = 1_024;
const MAX_RETAINED_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PtyEvent {
    Data { data_b64: String },
    Backpressure { queue_depth: usize, stalled_ms: u64 },
    Exit { exit_code: i32, reason: String },
}

impl PtyEvent {
    fn retained_bytes(&self) -> usize {
        match self {
            Self::Data { data_b64 } => data_b64.len(),
            Self::Backpressure { .. } => std::mem::size_of::<usize>() + std::mem::size_of::<u64>(),
            Self::Exit { reason, .. } => reason.len() + std::mem::size_of::<i32>(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyEventEnvelope {
    pub session_id: String,
    pub seq: u64,
    pub event: PtyEvent,
}

pub struct PtyEventJournal {
    session_id: String,
    next_seq: u64,
    retained_bytes: usize,
    attachment_confirmed: bool,
    terminal: bool,
    events: VecDeque<PtyEventEnvelope>,
}

impl PtyEventJournal {
    pub fn new(session_id: String, attachment_confirmed: bool) -> Self {
        Self {
            session_id,
            next_seq: 1,
            retained_bytes: 0,
            attachment_confirmed,
            terminal: false,
            events: VecDeque::new(),
        }
    }

    pub fn confirm_attachment(&mut self) {
        self.attachment_confirmed = true;
        self.trim();
    }

    pub fn push(&mut self, event: PtyEvent) -> Option<PtyEventEnvelope> {
        if self.terminal {
            return None;
        }

        let is_exit = matches!(event, PtyEvent::Exit { .. });
        let retained_bytes = event.retained_bytes();
        let envelope = PtyEventEnvelope {
            session_id: self.session_id.clone(),
            seq: self.next_seq,
            event,
        };
        self.next_seq = self.next_seq.saturating_add(1);
        self.retained_bytes = self.retained_bytes.saturating_add(retained_bytes);
        self.events.push_back(envelope.clone());
        self.terminal = is_exit;
        self.trim();
        Some(envelope)
    }

    pub fn replay_after(&self, after_seq: u64) -> Vec<PtyEventEnvelope> {
        self.events
            .iter()
            .filter(|envelope| envelope.seq > after_seq)
            .cloned()
            .collect()
    }

    pub fn last_seq(&self) -> u64 {
        self.next_seq.saturating_sub(1)
    }

    fn trim(&mut self) {
        if !self.attachment_confirmed {
            return;
        }

        while self.events.len() > MAX_RETAINED_EVENTS || self.retained_bytes > MAX_RETAINED_BYTES {
            let Some(removed) = self.events.pop_front() else {
                break;
            };
            self.retained_bytes = self
                .retained_bytes
                .saturating_sub(removed.event.retained_bytes());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{PtyEvent, PtyEventJournal};

    #[test]
    fn assigns_strictly_increasing_sequence_numbers() {
        let mut journal = PtyEventJournal::new("session".into(), true);

        let first = journal
            .push(PtyEvent::Data {
                data_b64: "YQ==".into(),
            })
            .expect("first event");
        let second = journal
            .push(PtyEvent::Backpressure {
                queue_depth: 4_096,
                stalled_ms: 7,
            })
            .expect("second event");
        let third = journal
            .push(PtyEvent::Exit {
                exit_code: 0,
                reason: "normal".into(),
            })
            .expect("exit event");

        assert_eq!([first.seq, second.seq, third.seq], [1, 2, 3]);
        assert_eq!(journal.last_seq(), 3);
    }

    #[test]
    fn retains_every_event_until_attachment_is_confirmed() {
        let mut journal = PtyEventJournal::new("session".into(), false);
        for value in 0..1_100 {
            journal
                .push(PtyEvent::Data {
                    data_b64: value.to_string(),
                })
                .expect("data event");
        }

        assert_eq!(journal.replay_after(0).len(), 1_100);
        journal.confirm_attachment();
        assert_eq!(journal.replay_after(0).len(), 1_024);
    }

    #[test]
    fn emits_no_event_after_final_exit_envelope() {
        let mut journal = PtyEventJournal::new("session".into(), true);
        journal
            .push(PtyEvent::Exit {
                exit_code: 0,
                reason: "normal".into(),
            })
            .expect("exit event");

        assert!(journal
            .push(PtyEvent::Data {
                data_b64: "bGF0ZQ==".into(),
            })
            .is_none());
        assert_eq!(journal.last_seq(), 1);
    }

    #[test]
    fn serializes_replay_envelopes_for_the_frontend_contract() {
        let mut journal = PtyEventJournal::new("session".into(), true);
        let envelope = journal
            .push(PtyEvent::Data {
                data_b64: "YQ==".into(),
            })
            .expect("data event");

        assert_eq!(
            serde_json::to_value(envelope).expect("serialize envelope"),
            serde_json::json!({
                "sessionId": "session",
                "seq": 1,
                "event": { "type": "data", "data_b64": "YQ==" }
            })
        );
    }
}
