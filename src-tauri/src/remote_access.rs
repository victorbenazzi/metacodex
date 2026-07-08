use std::fs;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
    Engine as _,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use ssh2::{
    CheckResult, FileStat, HashType, HostKeyType, KnownHostFileKind, OpenFlags, OpenType, Session,
    Sftp,
};

use crate::config_paths;
use crate::error::{AppError, AppResult};
use crate::fs_ops::{BytesFile, DirEntry, FileMeta, TextFile};

const DEFAULT_TEXT_LIMIT: u64 = 25 * 1024 * 1024;
const DEFAULT_BYTES_LIMIT: u64 = 50 * 1024 * 1024;
const SSH_CONNECT_TIMEOUT_MS: u64 = 8_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccess {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub identity_file: Option<String>,
    #[serde(default)]
    pub root_paths: Vec<String>,
    #[serde(default)]
    pub known_host_sha256: Option<String>,
    pub created_at: String,
    pub last_connected_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub label: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub identity_file: Option<String>,
    #[serde(default)]
    pub root_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessTestResult {
    pub status: String,
    pub fingerprint_sha256: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProjectCandidate {
    pub name: String,
    pub path: String,
    pub markers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RemoteAccessesFile {
    #[serde(default)]
    accesses: Vec<RemoteAccess>,
}

fn default_port() -> u16 {
    22
}

fn ssh_error(ctx: &str, err: ssh2::Error) -> AppError {
    AppError::Other(format!("{ctx}: {err}"))
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
        .map(|a| a.host == normalized.host && a.port == normalized.port && a.user == normalized.user)
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

fn touch_access(id: &str, fingerprint: Option<String>) -> AppResult<()> {
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

pub fn normalize_remote_path(path: &str) -> AppResult<String> {
    let trimmed = path.trim().replace('\\', "/");
    if trimmed.is_empty() || !trimmed.starts_with('/') || trimmed.contains('\0') {
        return Err(AppError::PathNotAllowed(format!(
            "remote path must be absolute: {path:?}"
        )));
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in trimmed.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(AppError::PathNotAllowed(format!(
                "remote traversal is not allowed: {path:?}"
            )));
        }
        parts.push(part);
    }
    if parts.is_empty() {
        Ok("/".into())
    } else {
        Ok(format!("/{}", parts.join("/")))
    }
}

fn remote_join(parent: &str, name: &str) -> AppResult<String> {
    validate_relative_name(name)?;
    let mut path = normalize_remote_path(parent)?;
    for seg in name.replace('\\', "/").split('/') {
        if seg.is_empty() {
            continue;
        }
        if path != "/" {
            path.push('/');
        }
        path.push_str(seg);
    }
    normalize_remote_path(&path)
}

fn validate_relative_name(name: &str) -> AppResult<()> {
    if name.trim().is_empty()
        || name.contains('\0')
        || name.starts_with('/')
        || name.starts_with('\\')
    {
        return Err(AppError::Other(format!("invalid name: {name:?}")));
    }
    for seg in name.replace('\\', "/").split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return Err(AppError::Other(format!("invalid name: {name:?}")));
        }
    }
    Ok(())
}

fn path_within_root(root: &str, target: &str) -> bool {
    root == "/"
        || target == root
        || target
            .strip_prefix(root)
            .is_some_and(|s| s.starts_with('/'))
}

fn connect_transport(draft: &RemoteAccessDraft) -> AppResult<Session> {
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

enum HostTrust {
    Trusted,
    Untrusted,
}

fn check_or_trust_host(
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

fn host_fingerprint(session: &Session) -> AppResult<String> {
    let hash = session
        .host_key_hash(HashType::Sha256)
        .ok_or_else(|| AppError::Other("could not compute ssh host fingerprint".into()))?;
    Ok(format!("SHA256:{}", STANDARD_NO_PAD.encode(hash)))
}

fn authenticate(session: &Session, draft: &RemoteAccessDraft) -> AppResult<()> {
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

fn connect_access(access: &RemoteAccess) -> AppResult<Session> {
    let draft = RemoteAccessDraft {
        id: Some(access.id.clone()),
        label: access.label.clone(),
        host: access.host.clone(),
        port: access.port,
        user: access.user.clone(),
        identity_file: access.identity_file.clone(),
        root_paths: access.root_paths.clone(),
    };
    let normalized = normalize_draft(draft)?;
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

fn sftp_for_access(access_id: &str) -> AppResult<(RemoteAccess, Sftp)> {
    let access = get_access(access_id)?;
    let session = connect_access(&access)?;
    let sftp = session.sftp().map_err(|e| ssh_error("sftp", e))?;
    Ok((access, sftp))
}

fn ensure_allowed(
    sftp: &Sftp,
    project_root: &str,
    target: &str,
    leaf_may_be_missing: bool,
) -> AppResult<String> {
    let root = normalize_remote_path(project_root)?;
    let target = normalize_remote_path(target)?;
    if !path_within_root(&root, &target) {
        return Err(AppError::PathNotAllowed(format!(
            "remote path outside project: {target}"
        )));
    }
    let rel = target.strip_prefix(&root).unwrap_or("");
    let mut current = root.clone();
    for seg in rel
        .trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
    {
        if current != "/" {
            current.push('/');
        }
        current.push_str(seg);
        match sftp.lstat(Path::new(&current)) {
            Ok(stat) => {
                if stat.file_type().is_symlink() {
                    return Err(AppError::PathNotAllowed(format!(
                        "remote symlink is not allowed: {current}"
                    )));
                }
            }
            Err(_) if leaf_may_be_missing && current == target => break,
            Err(err) => return Err(ssh_error("remote stat", err)),
        }
    }
    Ok(target)
}

pub fn ensure_project_path(access_id: &str, project_root: &str, path: &str) -> AppResult<String> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    ensure_allowed(&sftp, project_root, path, false)
}

fn mtime_ms(stat: &FileStat) -> i64 {
    stat.mtime.map(|s| (s as i64) * 1000).unwrap_or(0)
}

fn file_size(stat: &FileStat) -> u64 {
    stat.size.unwrap_or(0)
}

fn file_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|s| s.to_str())
        .filter(|s| *s != "." && *s != "..")
        .map(|s| s.to_string())
}

pub fn read_dir(access_id: &str, project_root: &str, path: &str) -> AppResult<Vec<DirEntry>> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let target = ensure_allowed(&sftp, project_root, path, false)?;
    let entries = sftp
        .readdir(Path::new(&target))
        .map_err(|e| ssh_error("sftp readdir", e))?;
    let mut out = Vec::with_capacity(entries.len());
    for (entry_path, stat) in entries {
        let Some(name) = file_name(&entry_path) else {
            continue;
        };
        let path = normalize_remote_path(&entry_path.to_string_lossy())?;
        let file_type = stat.file_type();
        out.push(DirEntry {
            name,
            path,
            is_dir: file_type.is_dir(),
            is_symlink: file_type.is_symlink(),
            size: file_size(&stat),
            mtime_ms: mtime_ms(&stat),
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

pub fn stat(access_id: &str, project_root: &str, path: &str) -> AppResult<FileMeta> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let target = ensure_allowed(&sftp, project_root, path, false)?;
    let stat = sftp
        .lstat(Path::new(&target))
        .map_err(|e| ssh_error("sftp stat", e))?;
    let file_type = stat.file_type();
    Ok(FileMeta {
        size: file_size(&stat),
        mtime_ms: mtime_ms(&stat),
        is_dir: file_type.is_dir(),
        is_symlink: file_type.is_symlink(),
        mime: guess_mime(&target),
    })
}

fn read_capped(
    sftp: &Sftp,
    target: &str,
    max_bytes: Option<u64>,
    default_limit: u64,
) -> AppResult<(Vec<u8>, bool, u64)> {
    let stat = sftp
        .stat(Path::new(target))
        .map_err(|e| ssh_error("sftp stat", e))?;
    let size = file_size(&stat);
    let limit = max_bytes.unwrap_or(default_limit);
    let truncated = size > limit;
    let mut file = sftp
        .open(Path::new(target))
        .map_err(|e| ssh_error("sftp open", e))?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(limit)
        .read_to_end(&mut bytes)
        .map_err(|e| AppError::Other(format!("sftp read: {e}")))?;
    Ok((bytes, truncated, size))
}

pub fn read_file_text(
    access_id: &str,
    project_root: &str,
    path: &str,
    max_bytes: Option<u64>,
) -> AppResult<TextFile> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let target = ensure_allowed(&sftp, project_root, path, false)?;
    let (bytes, truncated, size) = read_capped(&sftp, &target, max_bytes, DEFAULT_TEXT_LIMIT)?;
    let (content, encoding) = match String::from_utf8(bytes) {
        Ok(s) => (s, "utf-8".to_string()),
        Err(e) => (
            String::from_utf8_lossy(e.as_bytes()).into_owned(),
            "lossy".to_string(),
        ),
    };
    Ok(TextFile {
        content,
        encoding,
        truncated,
        size,
    })
}

pub fn read_file_bytes(
    access_id: &str,
    project_root: &str,
    path: &str,
    max_bytes: Option<u64>,
) -> AppResult<BytesFile> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let target = ensure_allowed(&sftp, project_root, path, false)?;
    let (bytes, truncated, size) = read_capped(&sftp, &target, max_bytes, DEFAULT_BYTES_LIMIT)?;
    Ok(BytesFile {
        b64: STANDARD.encode(bytes),
        mime: guess_mime(&target),
        truncated,
        size,
    })
}

fn ensure_parent_dirs(sftp: &Sftp, project_root: &str, path: &str) -> AppResult<()> {
    let root = normalize_remote_path(project_root)?;
    let target = normalize_remote_path(path)?;
    let Some(parent) = target
        .rsplit_once('/')
        .map(|(p, _)| if p.is_empty() { "/" } else { p })
    else {
        return Ok(());
    };
    let parent = normalize_remote_path(parent)?;
    if !path_within_root(&root, &parent) {
        return Err(AppError::PathNotAllowed(format!(
            "remote parent outside project: {parent}"
        )));
    }
    if parent == "/" || parent == root {
        return Ok(());
    }
    let rel = parent
        .strip_prefix(&root)
        .unwrap_or("")
        .trim_start_matches('/');
    let mut current = root.clone();
    for seg in rel.split('/').filter(|s| !s.is_empty()) {
        if current != "/" {
            current.push('/');
        }
        current.push_str(seg);
        match sftp.mkdir(Path::new(&current), 0o755) {
            Ok(()) => {}
            Err(_) => {
                let stat = sftp
                    .lstat(Path::new(&current))
                    .map_err(|e| ssh_error("sftp mkdir stat", e))?;
                if !stat.file_type().is_dir() || stat.file_type().is_symlink() {
                    return Err(AppError::Other(format!(
                        "not a remote directory: {current}"
                    )));
                }
            }
        }
    }
    Ok(())
}

pub fn write_file_text(
    access_id: &str,
    project_root: &str,
    path: &str,
    content: &str,
) -> AppResult<()> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let target = ensure_allowed(&sftp, project_root, path, true)?;
    ensure_parent_dirs(&sftp, project_root, &target)?;
    let tmp = format!("{target}.metacodex.tmp.{}", std::process::id());
    {
        let mut file = sftp
            .open_mode(
                Path::new(&tmp),
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
                0o644,
                OpenType::File,
            )
            .map_err(|e| ssh_error("sftp write tmp", e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| AppError::Other(format!("sftp write: {e}")))?;
    }
    sftp.rename(Path::new(&tmp), Path::new(&target), None)
        .map_err(|e| ssh_error("sftp rename", e))
}

pub fn create_file(
    access_id: &str,
    project_root: &str,
    parent: &str,
    name: &str,
) -> AppResult<String> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let parent = ensure_allowed(&sftp, project_root, parent, false)?;
    let target = remote_join(&parent, name)?;
    ensure_allowed(&sftp, project_root, &target, true)?;
    ensure_parent_dirs(&sftp, project_root, &target)?;
    let _file = sftp
        .open_mode(
            Path::new(&target),
            OpenFlags::CREATE | OpenFlags::EXCLUSIVE | OpenFlags::WRITE,
            0o644,
            OpenType::File,
        )
        .map_err(|e| ssh_error("sftp create file", e))?;
    Ok(target)
}

pub fn create_dir(
    access_id: &str,
    project_root: &str,
    parent: &str,
    name: &str,
) -> AppResult<String> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let parent = ensure_allowed(&sftp, project_root, parent, false)?;
    let target = remote_join(&parent, name)?;
    ensure_allowed(&sftp, project_root, &target, true)?;
    ensure_parent_dirs(&sftp, project_root, &target)?;
    sftp.mkdir(Path::new(&target), 0o755)
        .map_err(|e| ssh_error("sftp create dir", e))?;
    Ok(target)
}

pub fn discover_projects(access_id: &str) -> AppResult<Vec<RemoteProjectCandidate>> {
    let (access, sftp) = sftp_for_access(access_id)?;
    let mut out = Vec::new();
    for root in &access.root_paths {
        let root = normalize_remote_path(root)?;
        if let Ok(stat) = sftp.lstat(Path::new(&root)) {
            if stat.file_type().is_dir() && !stat.file_type().is_symlink() {
                let root_markers = detect_markers(&sftp, &root);
                if !root_markers.is_empty() {
                    out.push(RemoteProjectCandidate {
                        name: remote_basename(&root),
                        path: root.clone(),
                        markers: root_markers,
                    });
                }
            }
        }
        let entries = match sftp.readdir(Path::new(&root)) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for (entry_path, stat) in entries {
            if out.len() >= 500 {
                break;
            }
            if !stat.file_type().is_dir() || stat.file_type().is_symlink() {
                continue;
            }
            let path = normalize_remote_path(&entry_path.to_string_lossy())?;
            if !path_within_root(&root, &path) {
                continue;
            }
            out.push(RemoteProjectCandidate {
                name: remote_basename(&path),
                path: path.clone(),
                markers: detect_markers(&sftp, &path),
            });
        }
    }
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    out.dedup_by(|a, b| a.path == b.path);
    Ok(out)
}

fn remote_basename(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn detect_markers(sftp: &Sftp, path: &str) -> Vec<String> {
    const MARKERS: &[&str] = &[
        ".git",
        "package.json",
        "pnpm-workspace.yaml",
        "turbo.json",
        "Cargo.toml",
        "pyproject.toml",
        "go.mod",
        "deno.json",
        "bun.lockb",
        "composer.json",
    ];
    MARKERS
        .iter()
        .filter(|marker| {
            let candidate = if path == "/" {
                format!("/{marker}")
            } else {
                format!("{path}/{marker}")
            };
            sftp.lstat(Path::new(&candidate)).is_ok()
        })
        .map(|s| (*s).to_string())
        .collect()
}

pub fn validate_project_candidate(access_id: &str, path: &str) -> AppResult<String> {
    let access = get_access(access_id)?;
    let target = normalize_remote_path(path)?;
    let Some(root) = access
        .root_paths
        .iter()
        .find(|root| path_within_root(root, &target))
        .cloned()
    else {
        return Err(AppError::PathNotAllowed(format!(
            "remote project is outside configured access roots: {target}"
        )));
    };
    let session = connect_access(&access)?;
    let sftp = session.sftp().map_err(|e| ssh_error("sftp", e))?;
    ensure_allowed(&sftp, &root, &target, false)?;
    let stat = sftp
        .lstat(Path::new(&target))
        .map_err(|e| ssh_error("sftp stat", e))?;
    if !stat.file_type().is_dir() || stat.file_type().is_symlink() {
        return Err(AppError::PathNotAllowed(format!(
            "remote project is not a safe directory: {target}"
        )));
    }
    Ok(target)
}

pub fn ssh_command_args(
    access_id: &str,
    cwd: &str,
    command: Option<&str>,
) -> AppResult<(String, Vec<String>)> {
    let access = get_access(access_id)?;
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

fn sh_quote(input: &str) -> String {
    if input.is_empty() {
        return "''".into();
    }
    format!("'{}'", input.replace('\'', "'\\''"))
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

fn guess_mime(path: &str) -> Option<String> {
    let ext = PathBuf::from(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())?;
    Some(
        match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "ico" => "image/x-icon",
            "bmp" => "image/bmp",
            "pdf" => "application/pdf",
            "md" | "markdown" => "text/markdown",
            "json" => "application/json",
            "html" => "text/html",
            "css" => "text/css",
            "js" | "mjs" => "text/javascript",
            "ts" | "tsx" => "application/typescript",
            "py" => "text/x-python",
            "rs" => "text/rust",
            "toml" => "text/x-toml",
            "yml" | "yaml" => "text/yaml",
            _ => return None,
        }
        .to_string(),
    )
}
