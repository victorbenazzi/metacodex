#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::Arc;
#[cfg(target_os = "macos")]
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::projects::ProjectsCache;
use crate::pty::protocol::{PtyAttachResponse, PtyPrepareResponse};
use crate::pty::{PtyManager, PtySessionInfo, PtySpawnSpec};
use crate::runtime_supervisor::RuntimeSupervisor;
use crate::util::process_tree;

#[tauri::command]
pub async fn pty_prepare(
    spec: PtySpawnSpec,
    app: AppHandle,
    mgr: State<'_, PtyManager>,
    runtime: State<'_, Arc<RuntimeSupervisor>>,
) -> AppResult<PtyPrepareResponse> {
    runtime.ensure_running()?;
    if let Some(project_id) = spec.project_id.as_deref() {
        app.state::<Arc<ProjectsCache>>()
            .require_within_project(project_id, &spec.cwd)?;
    }
    mgr.prepare(spec)
}

#[tauri::command]
pub async fn pty_attach(
    session_id: String,
    after_seq: u64,
    mgr: State<'_, PtyManager>,
) -> AppResult<PtyAttachResponse> {
    mgr.attach(&session_id, after_seq)
}

#[tauri::command]
pub async fn pty_start(session_id: String, mgr: State<'_, PtyManager>) -> AppResult<()> {
    mgr.start(&session_id)
}

#[tauri::command]
pub async fn pty_write(
    session_id: String,
    data_b64: String,
    mgr: State<'_, PtyManager>,
) -> AppResult<()> {
    let bytes = STANDARD
        .decode(&data_b64)
        .map_err(|e| AppError::Pty(format!("invalid base64: {e}")))?;
    mgr.write(&session_id, &bytes)
}

#[tauri::command]
pub async fn pty_resize(
    session_id: String,
    rows: u16,
    cols: u16,
    mgr: State<'_, PtyManager>,
) -> AppResult<()> {
    mgr.resize(&session_id, rows, cols)
}

#[tauri::command]
pub async fn pty_kill(session_id: String, mgr: State<'_, PtyManager>) -> AppResult<()> {
    mgr.kill(&session_id).await
}

#[tauri::command]
pub async fn pty_list(mgr: State<'_, PtyManager>) -> AppResult<Vec<PtySessionInfo>> {
    Ok(mgr.list())
}

// -- Tab inspector metadata ----------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPort {
    pub port: u16,
    pub protocol: String, // "tcp" | "udp"
    pub address: String,  // "127.0.0.1", "0.0.0.0", "*"
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyMetadata {
    pub session_id: String,
    pub pid: u32,
    pub cwd: String,
    pub branch: Option<String>,
    pub listening_ports: Option<Vec<ListeningPort>>,
}

/// Synchronous worker. Runs on a blocking thread because lsof is shell-out and
/// git2 does syscalls. Returns a vector matching the input order.
fn metadata_for_session(
    pid: u32,
    cwd: String,
    session_id: String,
    branch: Option<String>,
    owned_pids: Option<Vec<u32>>,
) -> PtyMetadata {
    let listening_ports = if pid > 0 {
        owned_pids
            .or_else(|| process_tree::owned_process_ids(pid))
            .and_then(|pids| list_listening_ports(&pids))
    } else {
        None
    };
    PtyMetadata {
        session_id,
        pid,
        cwd,
        branch,
        listening_ports,
    }
}

fn detect_branch(cwd: &str) -> Option<String> {
    // `Repository::discover` walks up to find the nearest .git , works fine
    // for worktrees and nested repos. We swallow errors (no repo, perms, etc).
    let repo = git2::Repository::discover(cwd).ok()?;
    let head = repo.head().ok()?;
    head.shorthand().map(|s| s.to_string())
}

#[cfg(target_os = "macos")]
fn macos_lsof_args(pids: &[u32]) -> Vec<String> {
    vec![
        "-nP".into(),
        "-a".into(),
        format!(
            "-p{}",
            pids.iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(",")
        ),
        "-iTCP".into(),
        "-sTCP:LISTEN".into(),
        "-F".into(),
        "nP".into(),
    ]
}

#[cfg(target_os = "macos")]
fn list_listening_ports(pids: &[u32]) -> Option<Vec<ListeningPort>> {
    // `lsof -nP -p<pid> -iTCP -sTCP:LISTEN -F nP` , `-F nP` switches to the
    // field output mode where each record has lines tagged `p<pid>`, `n<addr>`,
    // `P<protocol>`. We only care about the `n` lines following a `p` we've
    // already filtered with `-p<pid>`. lsof times out implicitly on a quiet
    // system, so we cap our own wait at 250ms.
    let mut child = Command::new("lsof")
        .args(macos_lsof_args(pids))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    // Poll with a deadline.
    let deadline = std::time::Instant::now() + Duration::from_millis(250);
    let output = loop {
        match child.try_wait() {
            Ok(Some(_)) => break child.wait_with_output().ok()?,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    // kill() doesn't reap; wait() to avoid a <defunct> zombie
                    // accumulating on every slow poll cycle.
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(15));
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut current_proto: Option<String> = None;
    let mut out: Vec<ListeningPort> = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let (tag, rest) = line.split_at(1);
        match tag {
            "P" => current_proto = Some(rest.to_lowercase()),
            "n" => {
                // Formats: "*:5173", "127.0.0.1:5173", "[::1]:5173".
                if let Some((addr, port_str)) = rest.rsplit_once(':') {
                    if let Ok(port) = port_str.parse::<u16>() {
                        out.push(ListeningPort {
                            port,
                            protocol: current_proto.clone().unwrap_or_else(|| "tcp".into()),
                            address: addr.to_string(),
                        });
                    }
                }
            }
            _ => {}
        }
    }
    // Dedupe identical entries , lsof prints both IPv4 and IPv6 bound on the
    // same port and the user only cares once.
    out.sort_by_key(|p| (p.port, p.protocol.clone()));
    out.dedup_by(|a, b| a.port == b.port && a.protocol == b.protocol);
    Some(out)
}

#[cfg(target_os = "windows")]
fn list_listening_ports(pids: &[u32]) -> Option<Vec<ListeningPort>> {
    // Use the IP Helper API (`GetExtendedTcpTable`) via `netstat2` , sub-ms,
    // pure Rust, no PowerShell round-trip. We iterate every TCP socket, keep
    // only LISTEN sockets owned by `pid`, and dedupe identical IPv4/IPv6
    // entries on the same port for display.
    use netstat2::{
        get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState,
    };
    let sockets = get_sockets_info(
        AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6,
        ProtocolFlags::TCP,
    )
    .ok()?;
    let mut out: Vec<ListeningPort> = Vec::new();
    for si in sockets {
        if !si.associated_pids.iter().any(|pid| pids.contains(pid)) {
            continue;
        }
        if let ProtocolSocketInfo::Tcp(tcp) = si.protocol_socket_info {
            if tcp.state != TcpState::Listen {
                continue;
            }
            out.push(ListeningPort {
                port: tcp.local_port,
                protocol: "tcp".into(),
                address: tcp.local_addr.to_string(),
            });
        }
    }
    out.sort_by_key(|p| (p.port, p.protocol.clone()));
    out.dedup_by(|a, b| a.port == b.port && a.protocol == b.protocol);
    Some(out)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn list_listening_ports(_pids: &[u32]) -> Option<Vec<ListeningPort>> {
    // Linux port discovery is out of scope for the MVP , the UI degrades
    // gracefully (chips list stays empty).
    None
}

#[tauri::command]
pub async fn pty_metadata_batch(
    session_ids: Vec<String>,
    mgr: State<'_, PtyManager>,
) -> AppResult<Vec<PtyMetadata>> {
    // Snapshot pid + cwd under the manager's lock, release it, THEN do the
    // slow per-session work on a blocking thread.
    let snapshots: Vec<(String, u32, String, Option<Vec<u32>>)> = mgr
        .sessions_for_metadata(&session_ids)
        .into_iter()
        .collect();

    tokio::task::spawn_blocking(move || {
        let mut branch_by_cwd = std::collections::HashMap::new();
        snapshots
            .into_iter()
            .map(|(id, pid, cwd, owned_pids)| {
                let branch = branch_by_cwd
                    .entry(cwd.clone())
                    .or_insert_with(|| detect_branch(&cwd))
                    .clone();
                metadata_for_session(pid, cwd, id, branch, owned_pids)
            })
            .collect()
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {e}")))
}

#[cfg(test)]
mod metadata_tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_lsof_intersects_pid_and_listener_filters() {
        let args = super::macos_lsof_args(&[12, 14]);
        assert_eq!(
            args,
            ["-nP", "-a", "-p12,14", "-iTCP", "-sTCP:LISTEN", "-F", "nP"]
        );
    }
}

#[tauri::command]
pub async fn pty_update_cwd(
    app: AppHandle,
    session_id: String,
    cwd: String,
    mgr: State<'_, PtyManager>,
) -> AppResult<()> {
    // If the session belongs to a Project, validate the cwd is inside a
    // registered Project root so OSC 7 cannot leak an outside path into
    // stored state. Plain shells (no project_id) are unrestricted: `cd /tmp`
    // is a normal operation.
    if mgr.project_id_of(&session_id).is_some() {
        app.state::<Arc<ProjectsCache>>()
            .require_within_project_roots(&cwd)?;
    }
    mgr.set_cwd_override(&session_id, cwd)
}
