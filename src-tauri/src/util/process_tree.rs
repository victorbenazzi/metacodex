use std::collections::{HashMap, HashSet};

pub fn parse_process_table(text: &str, root_pid: u32) -> Vec<u32> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        let Some(pid) = fields.next().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };
        let Some(ppid) = fields.next().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };
        children.entry(ppid).or_default().push(pid);
    }
    let mut owned = Vec::new();
    let mut seen = HashSet::new();
    let mut pending = vec![root_pid];
    while let Some(pid) = pending.pop() {
        if !seen.insert(pid) {
            continue;
        }
        owned.push(pid);
        if let Some(direct) = children.get(&pid) {
            pending.extend(direct.iter().copied());
        }
    }
    owned.sort_unstable();
    owned
}

pub fn terminate_owned_process(root_pid: u32, target_pid: u32) -> crate::error::AppResult<()> {
    let owned = owned_process_ids(root_pid).ok_or_else(|| {
        crate::error::AppError::Other("could not verify terminal process ownership".into())
    })?;
    if !owned.contains(&target_pid) {
        return Err(crate::error::AppError::PermissionDenied(format!(
            "process {target_pid} is not owned by terminal {root_pid}"
        )));
    }
    terminate_process(target_pid)
}

#[cfg(unix)]
fn terminate_process(pid: u32) -> crate::error::AppResult<()> {
    signal_process(pid, libc::SIGTERM)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
    loop {
        let rows = unix_process_table()?;
        if !rows.iter().any(|row| row.pid == pid && row.running) {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            return Err(crate::error::AppError::Other(format!(
                "process {pid} did not stop after SIGTERM"
            )));
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
}

#[cfg(unix)]
fn signal_process(pid: u32, signal: i32) -> crate::error::AppResult<()> {
    if pid <= 1 || pid > i32::MAX as u32 || pid == std::process::id() {
        return Err(crate::error::AppError::InvalidArgument(
            "invalid child pid".into(),
        ));
    }
    if unsafe { libc::kill(pid as libc::pid_t, signal) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }
    Err(crate::error::AppError::Io(error))
}

#[cfg(unix)]
struct ProcessRow {
    pid: u32,
    ppid: u32,
    running: bool,
}

#[cfg(unix)]
fn unix_process_table() -> crate::error::AppResult<Vec<ProcessRow>> {
    let output = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,stat="])
        .output()?;
    if !output.status.success() {
        return Err(crate::error::AppError::Other(
            "could not enumerate processes".into(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse().ok()?;
            let ppid = fields.next()?.parse().ok()?;
            let running = !fields.next()?.starts_with('Z');
            Some(ProcessRow { pid, ppid, running })
        })
        .collect())
}

/// Session identity survives the leader exiting and includes shell job groups.
/// Also include descendants that are still attached through their parent tree.
#[cfg(unix)]
pub fn pty_descendants(root_pid: u32) -> crate::error::AppResult<Vec<u32>> {
    let rows = unix_process_table()?;
    let table = rows
        .iter()
        .map(|row| format!("{} {}\n", row.pid, row.ppid))
        .collect::<String>();
    let tree = parse_process_table(&table, root_pid);
    Ok(rows
        .into_iter()
        .filter(|row| {
            row.running
                && row.pid != root_pid
                && row.pid != std::process::id()
                && (tree.contains(&row.pid)
                    || unsafe { libc::getsid(row.pid as i32) } == root_pid as i32)
        })
        .map(|row| row.pid)
        .collect())
}

#[cfg(unix)]
pub fn stop_pty_descendants(root_pid: u32, captured: Vec<u32>) -> crate::error::AppResult<()> {
    let mut owned: HashSet<u32> = captured.into_iter().collect();
    owned.extend(pty_descendants(root_pid)?);
    for pid in &owned {
        signal_process(*pid, libc::SIGTERM)?;
    }
    let grace = std::time::Instant::now() + std::time::Duration::from_millis(200);
    let deadline = grace + std::time::Duration::from_secs(1);
    loop {
        owned.extend(pty_descendants(root_pid)?);
        let rows = unix_process_table()?;
        owned.retain(|pid| rows.iter().any(|row| row.pid == *pid && row.running));
        if owned.is_empty() {
            return Ok(());
        }
        if std::time::Instant::now() >= grace {
            for pid in &owned {
                signal_process(*pid, libc::SIGKILL)?;
            }
        }
        if std::time::Instant::now() >= deadline {
            return Err(crate::error::AppError::Other(
                "PTY descendants did not stop".into(),
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
}

#[cfg(windows)]
fn terminate_process(pid: u32) -> crate::error::AppResult<()> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    let handle = unsafe { OpenProcess(PROCESS_TERMINATE, false, pid) }
        .map_err(|error| crate::error::AppError::Other(error.to_string()))?;
    let result = unsafe { TerminateProcess(handle, 0) };
    let _ = unsafe { CloseHandle(handle) };
    result.map_err(|error| crate::error::AppError::Other(error.to_string()))
}

#[cfg(unix)]
pub fn owned_process_ids(root_pid: u32) -> Option<Vec<u32>> {
    let rows = unix_process_table().ok()?;
    let table = rows
        .iter()
        .map(|row| format!("{} {}\n", row.pid, row.ppid))
        .collect::<String>();
    Some(parse_process_table(&table, root_pid))
}

#[cfg(target_os = "windows")]
pub fn owned_process_ids(root_pid: u32) -> Option<Vec<u32>> {
    use windows::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut rows = String::new();
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                rows.push_str(&format!(
                    "{} {}\n",
                    entry.th32ProcessID, entry.th32ParentProcessID
                ));
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        Some(parse_process_table(&rows, root_pid))
    }
}

#[cfg(test)]
mod tests {
    use super::parse_process_table;

    #[test]
    fn attributes_only_root_and_descendants() {
        let table = "10 1\n11 10\n12 11\n20 1\n21 20\n";
        assert_eq!(parse_process_table(table, 10), vec![10, 11, 12]);
    }

    #[test]
    fn handles_cycles_without_duplicate_processes() {
        let table = "10 11\n11 10\n";
        assert_eq!(parse_process_table(table, 10), vec![10, 11]);
    }

    #[test]
    fn unrelated_process_is_not_attributed_to_terminal() {
        let table = "10 1\n11 10\n12 11\n20 1\n21 20\n";
        let owned = parse_process_table(table, 10);
        assert!(!owned.contains(&20));
        assert!(!owned.contains(&21));
    }
}

#[cfg(all(test, unix))]
mod native_tests {
    use super::*;
    use std::io::BufRead;
    use std::process::{Command, Stdio};

    struct ChildGuard(std::process::Child);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn real_owned_process_rejects_false_success_when_sigterm_is_ignored() {
        let mut child = ChildGuard(
            Command::new("/bin/sh")
                .args(["-c", "trap '' TERM; printf 'ready\\n'; read ignored"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        let mut ready = String::new();
        std::io::BufReader::new(child.0.stdout.take().unwrap())
            .read_line(&mut ready)
            .unwrap();
        assert_eq!(ready.trim(), "ready");
        let owned = owned_process_ids(std::process::id()).unwrap();
        assert!(owned.contains(&child.0.id()));
        assert!(terminate_owned_process(std::process::id(), child.0.id()).is_err());
        assert!(child.0.try_wait().unwrap().is_none());
    }

    struct PtyGuard {
        child: Box<dyn portable_pty::Child + Send + Sync>,
        _master: Box<dyn portable_pty::MasterPty + Send>,
        root_pid: u32,
        dir: std::path::PathBuf,
    }
    impl Drop for PtyGuard {
        fn drop(&mut self) {
            let captured = pty_descendants(self.root_pid).unwrap_or_default();
            let _ = self.child.kill();
            let _ = self.child.wait();
            let _ = stop_pty_descendants(self.root_pid, captured);
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn pty_worker(natural: bool) -> (PtyGuard, u32) {
        let dir = std::env::temp_dir().join(format!("metacodex-pty-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("worker.pid");
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = portable_pty::CommandBuilder::new("/bin/sh");
        command.args([
            "-c",
            r#"
            /bin/sh -c 'trap "" HUP TERM; echo $$ > "$1"; while :; do sleep 1; done' worker "$1" &
            if test "$2" = natural; then
                while ! test -s "$1"; do sleep 0.01; done
                exit 0
            fi
            wait
        "#,
            "leader",
        ]);
        command.arg(marker.as_os_str());
        command.arg(if natural { "natural" } else { "stop" });
        let child = pair.slave.spawn_command(command).unwrap();
        let root_pid = child.process_id().unwrap();
        drop(pair.slave);
        let guard = PtyGuard {
            child,
            _master: pair.master,
            root_pid,
            dir,
        };
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let worker = loop {
            if let Ok(text) = std::fs::read_to_string(&marker) {
                if let Ok(pid) = text.trim().parse::<u32>() {
                    break pid;
                }
            }
            assert!(std::time::Instant::now() < deadline, "worker did not start");
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        (guard, worker)
    }

    #[test]
    fn pty_cleanup_stops_reparented_descendants_and_preserves_unrelated_processes() {
        let mut unrelated = ChildGuard(Command::new("/bin/sleep").arg("30").spawn().unwrap());
        for natural in [false, true] {
            let (mut guard, worker) = pty_worker(natural);
            let captured = pty_descendants(guard.root_pid).unwrap();
            if !natural {
                guard.child.kill().unwrap();
            }
            guard.child.wait().unwrap();
            assert!(pty_descendants(guard.root_pid).unwrap().contains(&worker));
            stop_pty_descendants(guard.root_pid, captured).unwrap();
            assert!(pty_descendants(guard.root_pid).unwrap().is_empty());
            assert!(unrelated.0.try_wait().unwrap().is_none());
        }
    }
}
