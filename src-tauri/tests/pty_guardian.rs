#![cfg(unix)]

use metacodex_lib::util::process_tree::{pty_descendants, stop_pty_descendants};
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

// Re-executed by the integration test as the GUI's private-pipe owner.
#[test]
#[ignore = "internal subprocess fixture"]
fn guardian_owner_fixture() {
    let pid = std::env::var("METACODEX_TEST_PTY_PID").unwrap();
    let marker = std::env::var_os("METACODEX_TEST_GUARDIAN_READY").unwrap();
    let mut guardian = Command::new(env!("CARGO_BIN_EXE_metacodex"))
        .args(["--metacodex-pty-guardian", &pid])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut ready = [0];
    guardian
        .stdout
        .take()
        .unwrap()
        .read_exact(&mut ready)
        .unwrap();
    assert_eq!(ready, [b'R']);
    std::fs::write(marker, guardian.id().to_string()).unwrap();
    // Keep Child and its stdin alive until this owner receives SIGKILL.
    loop {
        assert!(guardian.try_wait().unwrap().is_none());
        std::thread::sleep(Duration::from_millis(50));
    }
}

struct Cleanup {
    child: Box<dyn portable_pty::Child + Send + Sync>,
    owner: Option<std::process::Child>,
    root: u32,
    dir: std::path::PathBuf,
}
impl Drop for Cleanup {
    fn drop(&mut self) {
        if let Some(owner) = &mut self.owner {
            let _ = owner.kill();
            let _ = owner.wait();
        }
        let captured = pty_descendants(self.root).unwrap_or_default();
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = stop_pty_descendants(self.root, captured);
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn guardian_reaps_session_work_after_owner_sigkill() {
    let dir =
        std::env::temp_dir().join(format!("metacodex-guardian-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let pair = portable_pty::native_pty_system()
        .openpty(portable_pty::PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "trap '' HUP TERM; /bin/sleep 30 & wait"]);
    let child = pair.slave.spawn_command(command).unwrap();
    let root = child.process_id().unwrap();
    drop(pair.slave);
    let marker = dir.join("guardian.pid");
    let mut cleanup = Cleanup {
        child,
        owner: None,
        root,
        dir,
    };
    let owner = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "guardian_owner_fixture",
            "--ignored",
            "--nocapture",
        ])
        .env("METACODEX_TEST_PTY_PID", root.to_string())
        .env("METACODEX_TEST_GUARDIAN_READY", &marker)
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    cleanup.owner = Some(owner);
    let deadline = Instant::now() + Duration::from_secs(5);
    while !marker.exists() {
        assert!(Instant::now() < deadline, "guardian did not start");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(!pty_descendants(root).unwrap().is_empty());
    cleanup.owner.as_mut().unwrap().kill().unwrap();
    cleanup.owner.as_mut().unwrap().wait().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if cleanup.child.try_wait().unwrap().is_some() && pty_descendants(root).unwrap().is_empty()
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "PTY work survived its owner's SIGKILL"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    drop(pair.master);
}
