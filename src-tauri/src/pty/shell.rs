use std::path::Path;

/// Detect the user's login shell and the args needed for an interactive login session.
/// On macOS/Linux: `/bin/zsh -l` (login), the PTY itself makes it interactive.
/// On Windows: prefer PowerShell, fall back to cmd.
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
        if which::which("pwsh").is_ok() {
            ("pwsh.exe".into(), vec!["-NoLogo".into()])
        } else if which::which("powershell").is_ok() {
            ("powershell.exe".into(), vec!["-NoLogo".into()])
        } else {
            ("cmd.exe".into(), vec![])
        }
    }
}

/// Build the shell args to launch a CLI through an interactive login shell.
/// This ensures PATH/.zshrc/.zprofile/mise/nvm are all loaded BEFORE the CLI is exec'd.
pub fn cli_launch_args(command: &str) -> (String, Vec<String>) {
    #[cfg(unix)]
    {
        let (shell, _) = detect_login_shell();
        (shell, vec!["-l".into(), "-i".into(), "-c".into(), command.into()])
    }
    #[cfg(windows)]
    {
        let (shell, _) = detect_login_shell();
        let args = if shell.contains("pwsh") || shell.contains("powershell") {
            vec!["-NoLogo".into(), "-Command".into(), command.into()]
        } else {
            vec!["/C".into(), command.into()]
        };
        (shell, args)
    }
}

/// Build a curated env for the spawned shell. We pass through PATH/HOME etc. so the
/// user's actual environment is preserved, the GUI process inherits a sparse PATH
/// on macOS, but `-l` will re-source the user's RC files and rebuild PATH from there.
pub fn build_env(project_path: &Path) -> Vec<(String, String)> {
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
