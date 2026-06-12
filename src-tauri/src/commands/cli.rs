#[cfg(unix)]
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};
#[cfg(unix)]
use crate::pty::shell;

#[derive(Debug, Clone, Serialize)]
pub struct CliDetectResult {
    pub installed: bool,
    pub path: Option<String>,
}

#[tauri::command]
pub async fn cli_detect(command: String) -> AppResult<CliDetectResult> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Ok(CliDetectResult {
            installed: false,
            path: None,
        });
    }

    tokio::task::spawn_blocking(move || detect_cli_blocking(&command))
        .await
        .map_err(|e| AppError::Other(format!("cli detect task failed: {e}")))
}

fn detect_cli_blocking(command: &str) -> CliDetectResult {
    if let Ok(p) = which::which(command) {
        return CliDetectResult {
            installed: true,
            path: Some(p.display().to_string()),
        };
    }

    match detect_via_login_shell(command) {
        Some(path) => CliDetectResult {
            installed: true,
            path: Some(path),
        },
        None => CliDetectResult {
            installed: false,
            path: None,
        },
    }
}

#[cfg(unix)]
fn detect_via_login_shell(command: &str) -> Option<String> {
    let (shell_path, _) = shell::detect_login_shell();
    let script = format!("command -v -- {}", shell_quote(command));
    let output = Command::new(shell_path)
        .args(["-l", "-i", "-c", script.as_str()])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(windows)]
fn detect_via_login_shell(command: &str) -> Option<String> {
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
                return Some(line.to_owned());
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
                return Some(candidate.display().to_string());
            }
        }
    }
    None
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
        let result = detect_cli_blocking("sh");
        assert!(result.installed);
        assert!(result.path.is_some());
    }
}
