use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::open_files::PendingOpenFiles;
use crate::preview_grants::{PreviewGrant, PreviewGrants};
use crate::projects::ProjectsCache;
use crate::util::paths;

/// Open an http(s) URL in the user's default browser.
///
/// Like `reveal_in_finder`, this shells out to the platform opener
/// (`open` / `start` / `xdg-open`) rather than pulling in tauri-plugin-opener.
/// The command is exposed over IPC, so we only permit http/https , anything
/// else (`file://`, `javascript:`, …) is refused defensively.
#[tauri::command]
pub async fn open_external_url(url: String) -> AppResult<()> {
    let parsed =
        tauri::Url::parse(url.trim()).map_err(|e| AppError::Other(format!("invalid URL: {e}")))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err(AppError::Other(format!(
            "refusing to open non-http(s) URL: {url}"
        )));
    }
    let url = parsed.to_string();

    use crate::util::process::silent_command;

    #[cfg(target_os = "macos")]
    {
        let status = silent_command("open")
            .arg(&url)
            .status()
            .map_err(|e| AppError::Other(format!("open failed: {e}")))?;
        require_opener_success(status, "open")
    }

    #[cfg(target_os = "windows")]
    {
        silent_command("explorer")
            .arg(&url)
            .status()
            .map_err(|e| AppError::Other(format!("explorer failed: {e}")))?;
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let status = silent_command("xdg-open")
            .arg(&url)
            .status()
            .map_err(|e| AppError::Other(format!("xdg-open failed: {e}")))?;
        require_opener_success(status, "xdg-open")
    }
}

/// Open an authorized local path with its system default application.
#[tauri::command]
pub async fn open_external_path(path: String, app: AppHandle) -> AppResult<()> {
    use crate::util::process::silent_command;

    let roots = app.state::<Arc<ProjectsCache>>().project_roots();
    let preview_ok = app.state::<Arc<PreviewGrants>>().contains_path(&path);
    paths::authorize_reveal(&roots, preview_ok, &path)?;

    #[cfg(target_os = "macos")]
    {
        let status = silent_command("open")
            .arg(&path)
            .status()
            .map_err(|e| AppError::Other(format!("open failed: {e}")))?;
        require_opener_success(status, "open")
    }

    #[cfg(target_os = "windows")]
    {
        silent_command("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::Other(format!("explorer failed: {e}")))?;
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let status = silent_command("xdg-open")
            .arg(&path)
            .status()
            .map_err(|e| AppError::Other(format!("xdg-open failed: {e}")))?;
        require_opener_success(status, "xdg-open")
    }
}

#[cfg(unix)]
fn require_opener_success(status: std::process::ExitStatus, opener: &str) -> AppResult<()> {
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "{opener} exited with status {status}"
        )))
    }
}

/// Drain any files the OS queued for opening before the webview was ready (cold
/// start via Finder "Open With" / double-click). The frontend calls this once on
/// mount and opens each path in preview mode.
#[tauri::command]
pub async fn take_pending_open_files(app: AppHandle) -> Vec<PreviewGrant> {
    app.state::<Arc<PendingOpenFiles>>().drain()
}
