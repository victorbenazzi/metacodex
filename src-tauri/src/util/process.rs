use std::process::Command;

/// Build a `std::process::Command` that hides the console window on Windows
/// (`CREATE_NO_WINDOW`). Identical to `Command::new` on Unix. Use for every
/// non-PTY shell-out (git, lsof, where.exe, explorer, open, xdg-open) so the
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
