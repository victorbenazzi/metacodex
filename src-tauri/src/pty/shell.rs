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
pub fn cli_launch_args(executable: &str, args: &[String]) -> (String, Vec<String>) {
    let command = std::iter::once(executable)
        .chain(args.iter().map(String::as_str))
        .map(shell_quote_token)
        .collect::<Vec<_>>()
        .join(" ");
    #[cfg(unix)]
    {
        let (shell, _) = detect_login_shell();
        (shell, vec!["-l".into(), "-i".into(), "-c".into(), command])
    }
    #[cfg(windows)]
    {
        let (shell, _) = detect_login_shell();
        let shell_lc = shell.to_lowercase();
        if shell_lc.contains("pwsh") || shell_lc.contains("powershell") {
            // Pin UTF-8 so emoji / box-drawing chars from agents render
            // correctly on Windows PowerShell 5.1 (codepage default).
            // Native pwsh 7+ already defaults to UTF-8 — the preamble is a no-op there.
            const UTF8_PREAMBLE: &str = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new();\
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
            (shell, vec!["/K".into(), command])
        }
    }
}

fn shell_quote_token(value: &str) -> String {
    #[cfg(unix)]
    {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
    #[cfg(windows)]
    {
        format!("'{}'", value.replace('\'', "''"))
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

fn env_non_empty(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|value| !value.is_empty())
}

/// Locale the PTY should use when the GUI process has none (or only C/POSIX).
///
/// Linux: `C.UTF-8` is always present on glibc (Debian/Ubuntu/Zorin) without
/// `locale-gen`. `en_US.UTF-8` is NOT: a pt-BR box often generates only
/// `pt_BR.UTF-8` + `C.UTF-8`, and setting `en_US.UTF-8` makes libc fall back
/// to POSIX/C. Agents then print `?` for `ção`.
/// macOS: `en_US.UTF-8` is always installed; `C.UTF-8` is not.
#[cfg(any(unix, test))]
pub(crate) fn default_unix_utf8_locale() -> &'static str {
    if cfg!(target_os = "linux") {
        "C.UTF-8"
    } else {
        "en_US.UTF-8"
    }
}

#[cfg(any(unix, test))]
fn locale_is_utf8(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("utf-8") || lower.contains("utf8")
}

#[cfg(any(unix, test))]
fn locale_is_ascii_c(value: &str) -> bool {
    matches!(value, "C" | "POSIX")
}

/// Pick LANG for a PTY after `env_clear()`.
///
/// Empty / C / POSIX are not UTF-8 capable on glibc. A charset-less name
/// like `pt_BR` is usually ISO-8859-1 on old Linux; append `.UTF-8`.
#[cfg(any(unix, test))]
pub(crate) fn resolve_unix_lang(inherited: Option<&str>) -> String {
    match inherited.map(str::trim).filter(|value| !value.is_empty()) {
        None => default_unix_utf8_locale().to_string(),
        Some(value) if locale_is_ascii_c(value) => default_unix_utf8_locale().to_string(),
        Some(value) if !locale_is_utf8(value) && !value.contains('.') => {
            format!("{value}.UTF-8")
        }
        Some(value) => value.to_string(),
    }
}

#[cfg(unix)]
const UNIX_INHERIT: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "SHELL",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_RUNTIME_DIR",
    "XDG_SESSION_TYPE",
    "XDG_CURRENT_DESKTOP",
    "XDG_SESSION_DESKTOP",
    "DESKTOP_SESSION",
    "DBUS_SESSION_BUS_ADDRESS",
    "XAUTHORITY",
    "SSH_AUTH_SOCK",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "LC_NUMERIC",
    "LC_TIME",
    "LC_COLLATE",
    "LC_MONETARY",
    "LC_MESSAGES",
    "LC_PAPER",
    "LC_NAME",
    "LC_ADDRESS",
    "LC_TELEPHONE",
    "LC_MEASUREMENT",
    "LC_IDENTIFICATION",
];

#[cfg(unix)]
fn unix_env(project_path: &Path) -> Vec<(String, String)> {
    unix_env_with(project_path, env_non_empty)
}

/// Do not invent `LC_ALL`. It overrides `LANG` and every `LC_*` category.
/// GUI launches on Linux typically have `LANG=pt_BR.UTF-8` and no `LC_ALL`;
/// forcing `LC_ALL=en_US.UTF-8` both hides the user's locale and breaks
/// UTF-8 when that locale was never generated.
#[cfg(unix)]
fn unix_env_with(
    project_path: &Path,
    get: impl Fn(&str) -> Option<String>,
) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = vec![
        ("TERM".into(), "xterm-256color".into()),
        ("COLORTERM".into(), "truecolor".into()),
        ("LANG".into(), resolve_unix_lang(get("LANG").as_deref())),
        ("PWD".into(), project_path.display().to_string()),
        ("METACODEX".into(), "1".into()),
    ];
    for key in UNIX_INHERIT {
        let Some(value) = get(key) else { continue };
        if (*key == "LC_ALL" || *key == "LC_CTYPE") && locale_is_ascii_c(&value) {
            continue;
        }
        env.push(((*key).to_string(), value));
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
        if let Some(v) = env_non_empty(k) {
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

#[cfg(test)]
mod tests {
    use super::{default_unix_utf8_locale, resolve_unix_lang};

    #[cfg(unix)]
    use super::{cli_launch_args, unix_env_with};
    #[cfg(unix)]
    use std::path::Path;

    #[test]
    fn resolve_unix_lang_keeps_user_utf8_locale() {
        assert_eq!(resolve_unix_lang(Some("pt_BR.UTF-8")), "pt_BR.UTF-8");
        assert_eq!(resolve_unix_lang(Some("en_US.utf8")), "en_US.utf8");
    }

    #[test]
    fn resolve_unix_lang_upgrades_c_posix_and_empty() {
        let fallback = default_unix_utf8_locale();
        assert_eq!(resolve_unix_lang(None), fallback);
        assert_eq!(resolve_unix_lang(Some("")), fallback);
        assert_eq!(resolve_unix_lang(Some("   ")), fallback);
        assert_eq!(resolve_unix_lang(Some("C")), fallback);
        assert_eq!(resolve_unix_lang(Some("POSIX")), fallback);
    }

    #[test]
    fn resolve_unix_lang_appends_utf8_when_charset_is_missing() {
        assert_eq!(resolve_unix_lang(Some("pt_BR")), "pt_BR.UTF-8");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_utf8_fallback_is_c_utf8_not_en_us() {
        assert_eq!(default_unix_utf8_locale(), "C.UTF-8");
    }

    #[cfg(unix)]
    #[test]
    fn unix_env_does_not_invent_lc_all() {
        let get = |key: &str| match key {
            "LANG" => Some("pt_BR.UTF-8".into()),
            "HOME" => Some("/home/user".into()),
            _ => None,
        };
        let env = unix_env_with(Path::new("/proj"), get);
        assert!(env
            .iter()
            .any(|(key, value)| key == "LANG" && value == "pt_BR.UTF-8"));
        assert!(env.iter().all(|(key, _)| key != "LC_ALL"));
        assert!(env
            .iter()
            .any(|(key, value)| key == "HOME" && value == "/home/user"));
    }

    #[cfg(unix)]
    #[test]
    fn unix_env_keeps_desktop_session_access() {
        let get = |key: &str| match key {
            "XDG_RUNTIME_DIR" => Some("/run/user/1000".into()),
            "DBUS_SESSION_BUS_ADDRESS" => Some("unix:path=/run/user/1000/bus".into()),
            "XAUTHORITY" => Some("/run/user/1000/xauth".into()),
            "WAYLAND_DISPLAY" => Some("wayland-0".into()),
            _ => None,
        };
        let env = unix_env_with(Path::new("/proj"), get);

        for (key, value) in [
            ("XDG_RUNTIME_DIR", "/run/user/1000"),
            ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus"),
            ("XAUTHORITY", "/run/user/1000/xauth"),
            ("WAYLAND_DISPLAY", "wayland-0"),
        ] {
            assert!(env
                .iter()
                .any(|(actual_key, actual_value)| { actual_key == key && actual_value == value }));
        }
    }

    #[cfg(unix)]
    #[test]
    fn unix_env_keeps_real_lc_all_but_drops_ascii_c() {
        let keep = |key: &str| match key {
            "LC_ALL" => Some("pt_BR.UTF-8".into()),
            _ => None,
        };
        let env = unix_env_with(Path::new("/proj"), keep);
        assert!(env
            .iter()
            .any(|(key, value)| key == "LC_ALL" && value == "pt_BR.UTF-8"));

        let drop_c = |key: &str| match key {
            "LC_ALL" => Some("C".into()),
            "LANG" => Some("pt_BR.UTF-8".into()),
            _ => None,
        };
        let env = unix_env_with(Path::new("/proj"), drop_c);
        assert!(env.iter().all(|(key, _)| key != "LC_ALL"));
        assert!(env
            .iter()
            .any(|(key, value)| key == "LANG" && value == "pt_BR.UTF-8"));
    }

    #[cfg(unix)]
    #[test]
    fn cli_launch_escapes_executable_and_each_argument() {
        let (shell, args) = cli_launch_args(
            "/tmp/my agent",
            &["--session".into(), "value'with quote".into()],
        );
        assert!(!shell.is_empty());
        let command = args.last().unwrap();
        assert!(command.contains("'/tmp/my agent'"));
        assert!(command.contains("'value'\\''with quote'"));
    }
}
