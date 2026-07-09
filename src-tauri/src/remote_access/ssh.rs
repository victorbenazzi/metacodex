use std::fs;
use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
    Engine as _,
};
use ssh2::{CheckResult, HashType, HostKeyType, KnownHostFileKind, Session};

use crate::config_paths;
use crate::error::{AppError, AppResult};

use super::paths::{path_within_root, sh_quote};
use super::store::get_access;
use super::types::{RemoteAccess, RemoteAccessDraft};
use super::{ssh_error, SSH_CONNECT_TIMEOUT_MS};

pub(crate) enum HostTrust {
    Trusted,
    Untrusted,
}

pub(crate) fn connect_transport(draft: &RemoteAccessDraft) -> AppResult<Session> {
    let address = if draft.host.contains(':') && !draft.host.starts_with('[') {
        format!("[{}]:{}", draft.host, draft.port)
    } else {
        format!("{}:{}", draft.host, draft.port)
    };
    let mut addrs = address
        .to_socket_addrs()
        .map_err(|e| AppError::Other(format!("resolve ssh host: {e}")))?;
    let addr = addrs
        .next()
        .ok_or_else(|| AppError::Other(format!("could not resolve ssh host: {}", draft.host)))?;
    let tcp = TcpStream::connect_timeout(&addr, Duration::from_millis(SSH_CONNECT_TIMEOUT_MS))
        .map_err(|e| AppError::Other(format!("connect ssh: {e}")))?;
    let _ = tcp.set_read_timeout(Some(Duration::from_millis(SSH_CONNECT_TIMEOUT_MS)));
    let _ = tcp.set_write_timeout(Some(Duration::from_millis(SSH_CONNECT_TIMEOUT_MS)));
    let mut session = Session::new().map_err(|e| ssh_error("ssh session", e))?;
    session.set_tcp_stream(tcp);
    session.set_timeout(SSH_CONNECT_TIMEOUT_MS as u32);
    session
        .handshake()
        .map_err(|e| ssh_error("ssh handshake", e))?;
    Ok(session)
}

pub(crate) fn check_or_trust_host(
    session: &mut Session,
    draft: &RemoteAccessDraft,
    trust_host: bool,
) -> AppResult<HostTrust> {
    let (key, key_type) = session
        .host_key()
        .ok_or_else(|| AppError::Other("ssh host did not present a host key".into()))?;
    let mut known_hosts = session
        .known_hosts()
        .map_err(|e| ssh_error("known_hosts", e))?;
    let known_hosts_path = config_paths::ssh_known_hosts_file()?;
    if known_hosts_path.exists() {
        known_hosts
            .read_file(&known_hosts_path, KnownHostFileKind::OpenSSH)
            .map_err(|e| ssh_error("read known_hosts", e))?;
    }
    match known_hosts.check_port(&draft.host, draft.port, key) {
        CheckResult::Match => Ok(HostTrust::Trusted),
        CheckResult::Mismatch => Err(AppError::PermissionDenied(format!(
            "ssh host key mismatch for {}:{}",
            draft.host, draft.port
        ))),
        CheckResult::NotFound => {
            if !trust_host {
                return Ok(HostTrust::Untrusted);
            }
            append_known_host(&known_hosts_path, &draft.host, draft.port, key, key_type)?;
            Ok(HostTrust::Trusted)
        }
        CheckResult::Failure => Err(AppError::Other("known_hosts check failed".into())),
    }
}

fn append_known_host(
    path: &Path,
    host: &str,
    port: u16,
    key: &[u8],
    key_type: HostKeyType,
) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let host_field = known_host_field(host, port);
    let key_name = host_key_name(key_type)?;
    let line = format!("{host_field} {key_name} {}\n", STANDARD.encode(key));
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(line.as_bytes())?;
    Ok(())
}

fn known_host_field(host: &str, port: u16) -> String {
    if port == 22 && !host.contains(':') {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

fn host_key_name(key_type: HostKeyType) -> AppResult<&'static str> {
    match key_type {
        HostKeyType::Rsa => Ok("ssh-rsa"),
        HostKeyType::Dss => Ok("ssh-dss"),
        HostKeyType::Ecdsa256 => Ok("ecdsa-sha2-nistp256"),
        HostKeyType::Ecdsa384 => Ok("ecdsa-sha2-nistp384"),
        HostKeyType::Ecdsa521 => Ok("ecdsa-sha2-nistp521"),
        HostKeyType::Ed25519 => Ok("ssh-ed25519"),
        HostKeyType::Unknown => Err(AppError::Other("unsupported ssh host key type".into())),
    }
}

pub(crate) fn host_fingerprint(session: &Session) -> AppResult<String> {
    let hash = session
        .host_key_hash(HashType::Sha256)
        .ok_or_else(|| AppError::Other("could not compute ssh host fingerprint".into()))?;
    Ok(format!("SHA256:{}", STANDARD_NO_PAD.encode(hash)))
}

pub(crate) fn authenticate(session: &Session, draft: &RemoteAccessDraft) -> AppResult<()> {
    if session.userauth_agent(&draft.user).is_ok() && session.authenticated() {
        return Ok(());
    }
    if let Some(identity) = draft.identity_file.as_deref() {
        let path = expand_tilde(identity);
        if session
            .userauth_pubkey_file(&draft.user, None, &path, None)
            .is_ok()
            && session.authenticated()
        {
            return Ok(());
        }
    }
    Err(AppError::PermissionDenied(format!(
        "ssh authentication failed for {}@{}",
        draft.user, draft.host
    )))
}

pub(crate) fn connect_access(access: &RemoteAccess) -> AppResult<Session> {
    let draft = RemoteAccessDraft {
        id: Some(access.id.clone()),
        label: access.label.clone(),
        host: access.host.clone(),
        port: access.port,
        user: access.user.clone(),
        identity_file: access.identity_file.clone(),
        root_paths: access.root_paths.clone(),
    };
    let normalized = normalize_access_draft(draft)?;
    let mut session = connect_transport(&normalized)?;
    match check_or_trust_host(&mut session, &normalized, false)? {
        HostTrust::Trusted => {}
        HostTrust::Untrusted => {
            return Err(AppError::PermissionDenied(format!(
                "ssh host key is not trusted for {}:{}",
                normalized.host, normalized.port
            )));
        }
    }
    authenticate(&session, &normalized)?;
    Ok(session)
}

fn normalize_access_draft(mut draft: RemoteAccessDraft) -> AppResult<RemoteAccessDraft> {
    draft.root_paths = draft
        .root_paths
        .into_iter()
        .map(|root| super::paths::normalize_remote_path(&root))
        .collect::<AppResult<Vec<_>>>()?;
    Ok(draft)
}

pub(crate) fn sftp_for_access(access_id: &str) -> AppResult<(RemoteAccess, ssh2::Sftp)> {
    let access = get_access(access_id)?;
    let session = connect_access(&access)?;
    let sftp = session.sftp().map_err(|e| ssh_error("sftp", e))?;
    Ok((access, sftp))
}

pub fn ssh_command_args(
    access_id: &str,
    cwd: &str,
    command: Option<&str>,
) -> AppResult<(String, Vec<String>)> {
    let access = get_access(access_id)?;
    if !access
        .root_paths
        .iter()
        .any(|root| path_within_root(root, cwd))
    {
        return Err(AppError::PathNotAllowed(format!(
            "remote cwd outside configured access roots: {cwd}"
        )));
    }
    let known_hosts = config_paths::ssh_known_hosts_file()?;
    let target = format!("{}@{}", access.user, access.host);
    let remote_command = if let Some(command) = command {
        format!("cd -- {} && exec {command}", sh_quote(cwd))
    } else {
        format!("cd -- {} && exec ${{SHELL:-/bin/sh}} -l", sh_quote(cwd))
    };
    let mut args = vec![
        "-tt".to_string(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=yes".to_string(),
        "-o".to_string(),
        format!("UserKnownHostsFile={}", known_hosts.to_string_lossy()),
        "-p".to_string(),
        access.port.to_string(),
    ];
    if let Some(identity) = access.identity_file.as_deref() {
        args.push("-i".to_string());
        args.push(expand_tilde(identity).to_string_lossy().to_string());
    }
    args.push(target);
    args.push(remote_command);
    Ok(("ssh".to_string(), args))
}

fn expand_tilde(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}
