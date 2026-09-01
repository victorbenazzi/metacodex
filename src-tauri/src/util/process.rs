use std::process::Command;

/// Build a `std::process::Command` that hides the console window on Windows
/// (`CREATE_NO_WINDOW`). Identical to `Command::new` on Unix. Use for every
/// non-PTY shell-out (git, lsof, where.exe, explorer, open, xdg-open, gio) so the
/// GUI app never flashes a black `conhost.exe` window when invoking a CLI.
pub fn silent_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW (0x08000000), no console allocation for the child.
        let mut cmd = cmd;
        cmd.creation_flags(0x08000000);
        cmd
    }
    #[cfg(not(windows))]
    {
        cmd
    }
}

/// Open a URL or local path with the Linux desktop default application.
///
/// `xdg-open` is the conventional frontend, while `gio open` is available on
/// GTK desktops and gives us a useful fallback on minimal installations. A
/// successful spawn is not enough: both commands can report dispatch failures
/// through their exit status.
#[cfg(all(unix, not(target_os = "macos")))]
pub fn open_with_linux_default(target: &std::ffi::OsStr) -> Result<(), String> {
    let xdg_error = match silent_command("xdg-open").arg(target).status() {
        Ok(status) if status.success() => return Ok(()),
        Ok(status) => format!("exited with status {status}"),
        Err(error) => error.to_string(),
    };

    let gio_error = match silent_command("gio").arg("open").arg(target).status() {
        Ok(status) if status.success() => return Ok(()),
        Ok(status) => format!("exited with status {status}"),
        Err(error) => error.to_string(),
    };

    Err(format!(
        "no Linux desktop opener succeeded: xdg-open {xdg_error}; gio open {gio_error}"
    ))
}
