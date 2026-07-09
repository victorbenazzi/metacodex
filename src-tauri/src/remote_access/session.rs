//! Connection pool for remote SSH access.
//!
//! Without pooling, every remote filesystem call (`read_dir`, `stat`, a single
//! keystroke's worth of editor read/write) paid a full DNS + TCP + SSH handshake
//! + auth + SFTP-channel open. On a link with real latency that is seconds per
//! click. This keeps ONE live session per `access_id`, guarded by a mutex so
//! operations over a single connection serialize (libssh2 is not safe for
//! concurrent use of one session), and transparently reconnects when the
//! transport dies.
//!
//! It is a lazily-initialized process global rather than Tauri managed state:
//! the pool needs no app handle to construct, and the free `fs` functions that
//! consume it have none to thread through. Sessions drop with the process; an
//! access that is edited or removed is evicted eagerly (see `store`).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use ssh2::{Session, Sftp};

use crate::error::AppResult;

use super::ssh::connect_access;
use super::store::get_access;
use super::types::RemoteAccess;

struct Live {
    session: Session,
    sftp: Sftp,
}

#[derive(Default)]
struct Handle {
    /// `None` until first use or after the transport was found dead. Holding
    /// this lock is what serializes all operations on the shared connection.
    inner: Mutex<Option<Live>>,
}

static POOL: OnceLock<Mutex<HashMap<String, Arc<Handle>>>> = OnceLock::new();

fn pool() -> &'static Mutex<HashMap<String, Arc<Handle>>> {
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn handle_for(access_id: &str) -> Arc<Handle> {
    let mut map = pool().lock().unwrap_or_else(PoisonError::into_inner);
    map.entry(access_id.to_string()).or_default().clone()
}

/// Drop any pooled session for `access_id`. Called when the access is saved
/// (endpoint may have changed) or removed, so the next use reconnects fresh.
pub(crate) fn invalidate(access_id: &str) {
    if let Some(handle) = pool()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(access_id)
        .cloned()
    {
        *handle.inner.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }
}

fn connect_live(access: &RemoteAccess) -> AppResult<Live> {
    let session = connect_access(access)?;
    let sftp = session.sftp().map_err(|e| super::ssh_error("sftp", e))?;
    Ok(Live { session, sftp })
}

/// Run `f` against a live SFTP channel for `access_id`, reusing the pooled
/// connection. If the operation fails and a liveness probe shows the transport
/// is dead, the session is reconnected and `f` is retried exactly once.
pub(crate) fn with_sftp<T>(
    access_id: &str,
    f: impl Fn(&RemoteAccess, &Sftp) -> AppResult<T>,
) -> AppResult<T> {
    let access = get_access(access_id)?;
    let handle = handle_for(access_id);
    let mut guard = handle.inner.lock().unwrap_or_else(PoisonError::into_inner);
    if guard.is_none() {
        *guard = Some(connect_live(&access)?);
    }

    let live = guard.as_ref().expect("session just ensured");
    match f(&access, &live.sftp) {
        Ok(value) => Ok(value),
        Err(err) => {
            // A round-trip probe distinguishes a dead transport (reconnect and
            // retry) from a legitimate application error like "file not found"
            // (keep the connection, surface the error). Opening a throwaway
            // channel is a definitive liveness test; it also keeps `session`
            // load-bearing (the Sftp holds the connection alive on its own).
            if live.session.channel_session().is_ok() {
                return Err(err);
            }
            *guard = Some(connect_live(&access)?);
            let live = guard.as_ref().expect("session just reconnected");
            f(&access, &live.sftp)
        }
    }
}
