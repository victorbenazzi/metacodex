#[cfg(unix)]
use std::process::Command;

use serde::Serialize;
use std::collections::HashMap;
#[cfg(unix)]
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult};
#[cfg(unix)]
use crate::pty::shell;

#[derive(Debug, Clone, Serialize)]
pub struct CliDetectResult {
    pub installed: bool,
    pub path: Option<String>,
    pub environment: HashMap<String, String>,
}

#[tauri::command]
pub async fn cli_detect(command: String) -> AppResult<CliDetectResult> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Ok(CliDetectResult {
            installed: false,
            path: None,
            environment: HashMap::new(),
        });
    }

    tokio::task::spawn_blocking(move || detect_cli_blocking(&command))
        .await
        .map_err(|e| AppError::Other(format!("cli detect task failed: {e}")))?
}

fn result_for(path: Option<String>) -> CliDetectResult {
    let mut environment = HashMap::new();
    if let Some(path) = path.as_deref() {
        if let Some(parent) = std::path::Path::new(path).parent() {
            let inherited_path = std::env::var_os("PATH");
            let paths = std::iter::once(parent.to_path_buf()).chain(
                inherited_path
                    .as_deref()
                    .map(std::env::split_paths)
                    .into_iter()
                    .flatten(),
            );
            if let Ok(joined) = std::env::join_paths(paths) {
                environment.insert("PATH".into(), joined.to_string_lossy().into_owned());
            }
        }
    }
    CliDetectResult {
        installed: path.is_some(),
        path,
        environment,
    }
}

fn detect_cli_blocking(command: &str) -> AppResult<CliDetectResult> {
    if let Ok(p) = which::which(command) {
        return Ok(result_for(Some(p.display().to_string())));
    }

    Ok(result_for(detect_via_login_shell(command)?))
}

#[cfg(unix)]
fn detect_via_login_shell(command: &str) -> AppResult<Option<String>> {
    let (shell_path, _) = shell::detect_login_shell();
    let script = format!("command -v -- {}", shell_quote(command));
    let mut child = Command::new(shell_path)
        .args(["-l", "-i", "-c", script.as_str()])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| AppError::Other(format!("cli detect spawn: {error}")))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::Other("cli detection timed out".into()));
            }
            Err(error) => return Err(AppError::Other(format!("cli detect wait: {error}"))),
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|error| AppError::Other(format!("cli detect output: {error}")))?;

    if !output.status.success() {
        return Ok(None);
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned))
}

#[cfg(windows)]
fn detect_via_login_shell(command: &str) -> AppResult<Option<String>> {
    use crate::util::process::silent_command;

    // Primary: `where.exe` (resolves via PATH + PATHEXT). Silent_command keeps
    // the Tauri GUI from flashing a console window during boot detection.
    if let Ok(output) = silent_command("where.exe").arg(command).output() {
        if output.status.success() {
            if let Some(line) = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
            {
                return Ok(Some(line.to_owned()));
            }
        }
    }

    // Fallback: scan well-known install roots that the Tauri GUI's inherited
    // PATH often misses on Windows. Order: npm global, WinGet shims, Scoop
    // shims. We honor PATHEXT so a CLI installed as `.cmd`, `.exe`, `.bat`
    // or `.ps1` all resolve.
    let roots: Vec<std::path::PathBuf> = [
        std::env::var_os("APPDATA").map(|v| std::path::PathBuf::from(v).join("npm")),
        std::env::var_os("LOCALAPPDATA")
            .map(|v| std::path::PathBuf::from(v).join("Microsoft\\WinGet\\Links")),
        std::env::var_os("USERPROFILE").map(|v| std::path::PathBuf::from(v).join("scoop\\shims")),
    ]
    .into_iter()
    .flatten()
    .collect();

    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".CMD;.EXE;.BAT;.PS1".into());
    for root in &roots {
        for ext in pathext.split(';').filter(|e| !e.is_empty()) {
            let candidate = root.join(format!("{command}{ext}"));
            if candidate.is_file() {
                return Ok(Some(candidate.display().to_string()));
            }
        }
    }
    Ok(None)
}

#[cfg(unix)]
fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".into();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn shell_quote_handles_single_quotes() {
        assert_eq!(shell_quote("co'dex"), "'co'\\''dex'");
    }

    #[test]
    fn direct_detection_reports_installed_commands() {
        let result = detect_cli_blocking("sh").unwrap();
        assert!(result.installed);
        assert!(result.path.is_some());
    }
}
