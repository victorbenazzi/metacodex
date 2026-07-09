use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::config_paths;
use crate::error::{AppError, AppResult};

use super::paths::normalize_remote_path;
use super::ssh::{
    authenticate, check_or_trust_host, connect_transport, host_fingerprint, HostTrust,
};
use super::types::{RemoteAccess, RemoteAccessDraft, RemoteAccessTestResult};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RemoteAccessesFile {
    #[serde(default)]
    accesses: Vec<RemoteAccess>,
}

fn new_id() -> String {
    uuid::Uuid::new_v4()
        .to_string()
        .replace('-', "")
        .chars()
        .take(12)
        .collect()
}

fn load_file() -> AppResult<RemoteAccessesFile> {
    config_paths::read_json::<RemoteAccessesFile>(&config_paths::remote_accesses_file()?)
}

fn save_file(file: &RemoteAccessesFile) -> AppResult<()> {
    config_paths::write_json_atomic(&config_paths::remote_accesses_file()?, file)
}

pub fn list_accesses() -> AppResult<Vec<RemoteAccess>> {
    Ok(load_file()?.accesses)
}

pub fn get_access(id: &str) -> AppResult<RemoteAccess> {
    load_file()?
        .accesses
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| AppError::NotFound(format!("remote access {id}")))
}

pub fn remove_access(id: &str) -> AppResult<()> {
    let mut file = load_file()?;
    let before = file.accesses.len();
    file.accesses.retain(|a| a.id != id);
    if file.accesses.len() == before {
        return Err(AppError::NotFound(format!("remote access {id}")));
    }
    save_file(&file)
}

pub fn save_access(draft: RemoteAccessDraft) -> AppResult<RemoteAccess> {
    let normalized = normalize_draft(draft)?;
    let mut file = load_file()?;
    let now = Utc::now().to_rfc3339();
    let id = normalized.id.clone().unwrap_or_else(new_id);
    let existing = file.accesses.iter().position(|a| a.id == id);
    let created_at = existing
        .and_then(|idx| file.accesses.get(idx).map(|a| a.created_at.clone()))
        .unwrap_or_else(|| now.clone());
    let previous_access = existing.and_then(|idx| file.accesses.get(idx));
    let same_endpoint = previous_access
        .map(|a| {
            a.host == normalized.host && a.port == normalized.port && a.user == normalized.user
        })
        .unwrap_or(false);
    let known_host_sha256 = previous_access
        .filter(|_| same_endpoint)
        .and_then(|a| a.known_host_sha256.clone());
    let last_connected_at = previous_access
        .filter(|_| same_endpoint)
        .and_then(|a| a.last_connected_at.clone());

    let access = RemoteAccess {
        id,
        label: normalized.label,
        host: normalized.host,
        port: normalized.port,
        user: normalized.user,
        identity_file: normalized.identity_file,
        root_paths: normalized.root_paths,
        known_host_sha256,
        created_at,
        last_connected_at,
    };
    if let Some(idx) = file.accesses.iter().position(|a| a.id == access.id) {
        file.accesses[idx] = access.clone();
    } else {
        file.accesses.push(access.clone());
    }
    save_file(&file)?;
    Ok(access)
}

pub fn test_access(
    draft: RemoteAccessDraft,
    trust_host: bool,
) -> AppResult<RemoteAccessTestResult> {
    let normalized = normalize_draft(draft)?;
    let mut session = connect_transport(&normalized)?;
    let fingerprint = host_fingerprint(&session)?;
    match check_or_trust_host(&mut session, &normalized, trust_host)? {
        HostTrust::Untrusted => Ok(RemoteAccessTestResult {
            status: "untrusted".into(),
            fingerprint_sha256: fingerprint,
            message: None,
        }),
        HostTrust::Trusted => {
            authenticate(&session, &normalized)?;
            if let Some(id) = normalized.id.as_deref() {
                let _ = touch_access(id, Some(fingerprint.clone()));
            }
            Ok(RemoteAccessTestResult {
                status: "trusted".into(),
                fingerprint_sha256: fingerprint,
                message: None,
            })
        }
    }
}

pub(crate) fn touch_access(id: &str, fingerprint: Option<String>) -> AppResult<()> {
    let mut file = load_file()?;
    let Some(access) = file.accesses.iter_mut().find(|a| a.id == id) else {
        return Ok(());
    };
    access.last_connected_at = Some(Utc::now().to_rfc3339());
    if let Some(fingerprint) = fingerprint {
        access.known_host_sha256 = Some(fingerprint);
    }
    save_file(&file)
}

fn normalize_draft(mut draft: RemoteAccessDraft) -> AppResult<RemoteAccessDraft> {
    draft.label = draft.label.trim().to_string();
    draft.host = draft.host.trim().to_string();
    draft.user = draft.user.trim().to_string();
    draft.identity_file = draft
        .identity_file
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if draft.label.is_empty() {
        draft.label = draft.host.clone();
    }
    if draft.host.is_empty() {
        return Err(AppError::Other("host cannot be empty".into()));
    }
    if draft.host.contains('\0') || draft.user.contains('\0') {
        return Err(AppError::Other("invalid ssh access value".into()));
    }
    if draft.port == 0 {
        return Err(AppError::Other("invalid ssh port".into()));
    }
    if draft.user.is_empty() {
        return Err(AppError::Other("user cannot be empty".into()));
    }
    let mut roots = Vec::new();
    for root in draft.root_paths {
        let path = normalize_remote_path(&root)?;
        if !roots.contains(&path) {
            roots.push(path);
        }
    }
    if roots.is_empty() {
        return Err(AppError::Other(
            "at least one remote root path is required".into(),
        ));
    }
    draft.root_paths = roots;
    Ok(draft)
}
