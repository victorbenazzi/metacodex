use std::path::Path;

/// Detect the user's login shell and the args needed for an interactive session.
///
/// - **macOS/Linux**: `$SHELL -l` (login). The PTY makes it interactive.
/// - **Windows**: prefer PowerShell 7 (`pwsh.exe`), fall back to Windows
///   PowerShell 5.1 (`powershell.exe`), then `cmd.exe`. We pass `-NoLogo` to
///   skip the banner. No `-NoExit` for the plain shell: ConPTY keeps the
///   PTY alive as long as the shell process runs; `-NoExit` would only matter
///   if we were spawning a one-shot script.
pub fn detect_login_shell() -> (String, Vec<String>) {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".into()
            } else {
                "/bin/bash".into()
            }
        });
        (shell, vec!["-l".into()])
    }
    #[cfg(windows)]
    {
        if let Ok(pwsh) = which::which("pwsh") {
            return (pwsh.to_string_lossy().into_owned(), vec!["-NoLogo".into()]);
        }
        if let Ok(ps5) = which::which("powershell") {
            return (ps5.to_string_lossy().into_owned(), vec!["-NoLogo".into()]);
        }
        ("cmd.exe".into(), vec![])
    }
}

/// Build the shell args to launch a CLI through an interactive login shell.
///
/// - **Unix**: `$SHELL -l -i -c "<cli args>"` re-sources `.zshrc`/`.zprofile`/
///   `mise`/`nvm` so PATH is rebuilt before the CLI execs. Critical on macOS
///   where the Tauri GUI process inherits a sparse PATH.
/// - **Windows (PowerShell)**: `-NoLogo -NoExit -Command "<preamble>; <cmd>"`.
///   The preamble forces UTF-8 encoding (`OutputEncoding` defaults to the
///   local codepage on PowerShell 5.1, which mojibakes emoji from Claude /
///   Codex). We deliberately do NOT wrap the command in a `& { ... }` script
///   block: that would disable the `--%` stop-parsing token, which the
///   frontend injects via `cliLaunchString` for args like
///   `--dangerously-skip-permissions`.
/// - **Windows (cmd fallback)**: `/K <cmd>` — keeps the prompt open after
///   the CLI exits; acceptable since cmd is a tertiary fallback.
pub fn cli_launch_args(command: &str) -> (String, Vec<String>) {
    #[cfg(unix)]
    {
        let (shell, _) = detect_login_shell();
        (
            shell,
            vec!["-l".into(), "-i".into(), "-c".into(), command.into()],
        )
    }
    #[cfg(windows)]
    {
        let (shell, _) = detect_login_shell();
        let shell_lc = shell.to_lowercase();
        if shell_lc.contains("pwsh") || shell_lc.contains("powershell") {
            // Pin UTF-8 so emoji / box-drawing chars from agents render
            // correctly on Windows PowerShell 5.1 (codepage default).
            // Native pwsh 7+ already defaults to UTF-8 — the preamble is a no-op there.
            const UTF8_PREAMBLE: &str =
                "[Console]::OutputEncoding=[Text.UTF8Encoding]::new();\
                 $OutputEncoding=[Text.UTF8Encoding]::new();";
            (
                shell,
                vec![
                    "-NoLogo".into(),
                    "-NoExit".into(),
                    "-Command".into(),
                    format!("{UTF8_PREAMBLE} {command}"),
                ],
            )
        } else {
            // cmd.exe — last resort. /K keeps the prompt open after the cmd
            // exits so the user can keep working.
            (shell, vec!["/K".into(), command.into()])
        }
    }
}

/// Build a curated env for the spawned shell.
///
/// We `env_clear()` before spawn (see `pty/mod.rs`) and pass only the keys
/// listed below. Two reasons:
///   1. `claude.cmd` / `codex.cmd` shims on Windows REQUIRE `PATHEXT` +
///      `SYSTEMROOT` + `COMSPEC` to resolve.
///   2. The user's RC files (Unix) rebuild PATH from scratch, so we hand them
///      the seed we inherited from the GUI process.
pub fn build_env(project_path: &Path) -> Vec<(String, String)> {
    #[cfg(unix)]
    {
        unix_env(project_path)
    }
    #[cfg(windows)]
    {
        windows_env(project_path)
    }
}

#[cfg(unix)]
fn unix_env(project_path: &Path) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = vec![
        ("TERM".into(), "xterm-256color".into()),
        ("COLORTERM".into(), "truecolor".into()),
        (
            "LANG".into(),
            std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into()),
        ),
        (
            "LC_ALL".into(),
            std::env::var("LC_ALL").unwrap_or_else(|_| "en_US.UTF-8".into()),
        ),
        ("PWD".into(), project_path.display().to_string()),
        ("METACODEX".into(), "1".into()),
    ];
    for k in [
        "HOME",
        "USER",
        "LOGNAME",
        "PATH",
        "SHELL",
        "TMPDIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
        "SSH_AUTH_SOCK",
        "DISPLAY",
        "WAYLAND_DISPLAY",
    ] {
        if let Ok(v) = std::env::var(k) {
            env.push((k.into(), v));
        }
    }
    env
}

#[cfg(windows)]
fn windows_env(project_path: &Path) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = vec![
        ("COLORTERM".into(), "truecolor".into()),
        ("METACODEX".into(), "1".into()),
        // Modern Windows terminals honor `TERM` for ANSI parsing on some tools
        // (e.g. `less`, `vim` ports). Harmless on ConPTY.
        ("TERM".into(), "xterm-256color".into()),
    ];
    // Inherit the keys Windows shells / shims absolutely need. Missing any of
    // PATHEXT / SYSTEMROOT / COMSPEC breaks `.cmd` and `.bat` resolution which
    // is how `claude.cmd`, `codex.cmd`, npm-installed CLIs all dispatch.
    for k in [
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "PROGRAMW6432",
        "PATH",
        "PATHEXT",
        "SYSTEMROOT",
        "SYSTEMDRIVE",
        "WINDIR",
        "COMSPEC",
        "TEMP",
        "TMP",
        "USERNAME",
        "USERDOMAIN",
        "COMPUTERNAME",
        "PROCESSOR_ARCHITECTURE",
        "PROCESSOR_IDENTIFIER",
        "NUMBER_OF_PROCESSORS",
        "PSMODULEPATH",
        "OS",
        // Allow user-set locale / terminal hints to flow through.
        "LANG",
        "LC_ALL",
    ] {
        if let Ok(v) = std::env::var(k) {
            env.push((k.into(), v));
        }
    }
    // PowerShell expects the working directory to be set via the spawn call,
    // not via PWD — but exposing it as METACODEX_CWD lets users key off it in
    // their `$PROFILE` without us claiming a real env var name.
    env.push(("METACODEX_CWD".into(), project_path.display().to_string()));
    // PowerShell would otherwise log a usage telemetry record per session start.
    env.push(("POWERSHELL_TELEMETRY_OPTOUT".into(), "1".into()));
    env
}
