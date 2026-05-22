use crate::error::{AppError, AppResult};

/// Open an http(s) URL in the user's default browser.
///
/// Like `reveal_in_finder`, this shells out to the platform opener
/// (`open` / `start` / `xdg-open`) rather than pulling in tauri-plugin-opener.
/// The command is exposed over IPC, so we only permit http/https — anything
/// else (`file://`, `javascript:`, …) is refused defensively.
#[tauri::command]
pub async fn open_external_url(url: String) -> AppResult<()> {
    let scheme_ok = {
        let lower = url.trim_start().to_ascii_lowercase();
        lower.starts_with("https://") || lower.starts_with("http://")
    };
    if !scheme_ok {
        return Err(AppError::Other(format!(
            "refusing to open non-http(s) URL: {url}"
        )));
    }

    use std::process::Command;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .status()
            .map_err(|e| AppError::Other(format!("open failed: {e}")))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // `start` is a cmd builtin; the empty "" is the window-title argument.
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .status()
            .map_err(|e| AppError::Other(format!("start failed: {e}")))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&url)
            .status()
            .map_err(|e| AppError::Other(format!("xdg-open failed: {e}")))?;
        Ok(())
    }
}
