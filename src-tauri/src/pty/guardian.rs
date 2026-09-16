//! A separate process retains the PTY's cleanup responsibility if the GUI dies.
//! EOF on the private pipe is the ownership signal, including after SIGKILL.
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult};
use crate::util::process_tree::{pty_descendants, stop_pty_descendants};

pub const HELPER_FLAG: &str = "--metacodex-pty-guardian";

pub struct PtyGuardian {
    child: Option<Child>,
    pipe: Option<ChildStdin>,
}

impl PtyGuardian {
    pub fn spawn(root_pid: u32) -> AppResult<Self> {
        let mut child = Command::new(std::env::current_exe()?)
            .arg(HELPER_FLAG)
            .arg(root_pid.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let pipe = child.stdin.take();
        let mut output = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Pty("guardian pipe missing".into()))?;
        let (send, receive) = std::sync::mpsc::channel();
        if let Err(error) = std::thread::Builder::new()
            .name("pty-guardian-ready".into())
            .spawn(move || {
                let mut ready = [0];
                let result = output.read_exact(&mut ready).map(|()| ready[0] == b'R');
                let _ = send.send(result);
            })
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Io(error));
        }
        if !matches!(receive.recv_timeout(Duration::from_secs(3)), Ok(Ok(true))) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Pty("PTY guardian did not become ready".into()));
        }
        Ok(Self {
            child: Some(child),
            pipe,
        })
    }

    pub fn finish(mut self) -> AppResult<()> {
        self.reap()
    }

    fn reap(&mut self) -> AppResult<()> {
        self.pipe.take();
        let Some(mut child) = self.child.take() else {
            return Ok(());
        };
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => return Ok(()),
                Ok(Some(status)) => {
                    return Err(AppError::Pty(format!("PTY guardian exited: {status}")))
                }
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                result => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(AppError::Pty(format!(
                        "PTY guardian cleanup did not finish: {result:?}"
                    )));
                }
            }
        }
    }
}

impl Drop for PtyGuardian {
    fn drop(&mut self) {
        let _ = self.reap();
    }
}

pub fn run(root_pid: u32) -> AppResult<()> {
    if root_pid <= 1 || root_pid > i32::MAX as u32 || root_pid == std::process::id() {
        return Err(AppError::InvalidArgument(
            "invalid PTY guardian root".into(),
        ));
    }
    std::io::stdout().write_all(b"R")?;
    std::io::stdout().flush()?;
    let mut bytes = [0u8; 16];
    loop {
        match std::io::stdin().read(&mut bytes) {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(AppError::Io(error)),
        }
    }
    // Capture detached descendants before terminating a still-running leader.
    let descendants = pty_descendants(root_pid)?;
    if unsafe { libc::getsid(root_pid as i32) } == root_pid as i32 {
        unsafe {
            libc::kill(root_pid as i32, libc::SIGKILL);
        }
    }
    stop_pty_descendants(root_pid, descendants)
}
