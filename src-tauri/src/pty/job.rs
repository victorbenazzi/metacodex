#![cfg(windows)]

//! Windows Job Object wrapper for PTY children.
//!
//! `portable-pty`'s `ChildKiller::kill()` on Windows only terminates the
//! immediate shell process (e.g. `pwsh.exe`). When the shell hosts
//! `claude.cmd` → `node.exe`, killing the shell leaves `node.exe` running as
//! an orphan parented by `conhost.exe`. The agent keeps consuming CPU /
//! tokens until the user manually finds and kills it.
//!
//! Wrapping the spawned process in a Job Object with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` means that when this Rust `PtyJob`
//! handle drops (PtySession removed from the manager → last Arc drops), the
//! kernel terminates every descendant atomically. This is the canonical
//! pattern documented in the portable-pty notes for Windows.

use std::io;

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicProcessIdList,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    JOBOBJECT_BASIC_PROCESS_ID_LIST, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

pub struct PtyJob(HANDLE);

impl PtyJob {
    /// Create an unnamed Job Object with KILL_ON_JOB_CLOSE, then assign the
    /// process identified by `pid` to it. Returns `Err` if any Win32 call
    /// fails — callers treat that as "best effort, continue without job".
    pub fn assign_pid(pid: u32) -> io::Result<Self> {
        unsafe {
            let job = CreateJobObjectW(None, None)
                .map_err(|e| io::Error::other(format!("CreateJobObjectW: {e}")))?;

            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            )
            .map_err(|e| {
                let _ = CloseHandle(job);
                io::Error::other(format!("SetInformationJobObject: {e}"))
            })?;

            let proc =
                OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid).map_err(|e| {
                    let _ = CloseHandle(job);
                    io::Error::other(format!("OpenProcess({pid}): {e}"))
                })?;
            let assign_res = AssignProcessToJobObject(job, proc);
            let _ = CloseHandle(proc);
            if let Err(e) = assign_res {
                let _ = CloseHandle(job);
                return Err(io::Error::other(format!("AssignProcessToJobObject: {e}")));
            }

            Ok(Self(job))
        }
    }

    pub(crate) fn process_ids(&self) -> io::Result<Vec<u32>> {
        let mut capacity = 16usize;
        loop {
            let size = std::mem::size_of::<JOBOBJECT_BASIC_PROCESS_ID_LIST>()
                + (capacity - 1) * std::mem::size_of::<usize>();
            let mut buffer = vec![0u8; size];
            let result = unsafe {
                QueryInformationJobObject(
                    Some(self.0),
                    JobObjectBasicProcessIdList,
                    buffer.as_mut_ptr().cast(),
                    size as u32,
                    None,
                )
            };
            if result.is_ok() {
                let list = unsafe { &*(buffer.as_ptr() as *const JOBOBJECT_BASIC_PROCESS_ID_LIST) };
                let count = list.NumberOfProcessIdsInList as usize;
                let ids = unsafe { std::slice::from_raw_parts(list.ProcessIdList.as_ptr(), count) };
                return Ok(ids
                    .iter()
                    .filter_map(|pid| u32::try_from(*pid).ok())
                    .collect());
            }
            if capacity >= 4096 {
                return Err(io::Error::other(format!(
                    "QueryInformationJobObject: {}",
                    result.expect_err("failed query")
                )));
            }
            capacity *= 2;
        }
    }
}

impl Drop for PtyJob {
    fn drop(&mut self) {
        // Closing the last handle on a job with KILL_ON_JOB_CLOSE terminates
        // every process still assigned to it.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

// SAFETY: HANDLE is a Win32 kernel handle (opaque pointer-sized integer).
// We never mutate the inner state from Rust — all interactions are through
// CloseHandle in Drop, which is thread-safe per the Win32 contract. The job
// handle moves between threads inside the `Arc<PtySession>` Tauri stores.
unsafe impl Send for PtyJob {}
unsafe impl Sync for PtyJob {}
