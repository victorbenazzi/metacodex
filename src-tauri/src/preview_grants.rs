use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

// Grants are minted per preview pick and per OS "Open With" delivery, and are
// only explicitly revoked by move_into_project, so a long session would grow
// the map forever. FIFO-evict beyond this cap: 512 far exceeds realistic
// per-session preview tabs, and resolve stays O(1) (no LRU touch on the
// preview read/save hot path). A grant that gets evicted while somehow still
// in use degrades to the existing "unknown preview grant" error, never a panic.
const MAX_GRANTS: usize = 512;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGrant {
    pub path: String,
    pub grant_id: String,
}

#[derive(Default)]
struct Inner {
    by_id: HashMap<String, String>,
    /// Insertion order for FIFO eviction. May contain ids already revoked;
    /// stale entries drain harmlessly through future evictions.
    order: VecDeque<String>,
}

#[derive(Default)]
pub struct PreviewGrants {
    inner: Mutex<Inner>,
}

impl PreviewGrants {
    pub fn grant_path(&self, path: String) -> PreviewGrant {
        let grant_id = Uuid::new_v4().to_string();
        let mut inner = self.inner.lock();
        while inner.by_id.len() >= MAX_GRANTS {
            let Some(old) = inner.order.pop_front() else {
                break; // order drained (only via stale ids); never spin
            };
            inner.by_id.remove(&old);
        }
        inner.order.push_back(grant_id.clone());
        inner.by_id.insert(grant_id.clone(), path.clone());
        PreviewGrant { path, grant_id }
    }

    pub fn resolve(&self, grant_id: &str) -> AppResult<String> {
        self.inner
            .lock()
            .by_id
            .get(grant_id)
            .cloned()
            .ok_or_else(|| AppError::PathNotAllowed("unknown preview grant".into()))
    }

    pub fn revoke(&self, grant_id: &str) {
        // Leaves the id in `order`; the eviction loop treats it as a no-op.
        self.inner.lock().by_id.remove(grant_id);
    }
}
