use crate::error::AppResult;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Show a macOS native notification banner. Frontend gates this behind a user
/// setting + window/focus state, so the command itself is unconditional.
#[tauri::command]
pub async fn notify_show(
    app: AppHandle,
    title: String,
    body: Option<String>,
    sound: bool,
) -> AppResult<()> {
    let mut builder = app.notification().builder().title(title);
    if let Some(b) = body {
        builder = builder.body(b);
    }
    if sound {
        builder = builder.sound("default");
    }
    builder
        .show()
        .map_err(|e| crate::error::AppError::Other(format!("notify_show failed: {e}")))?;
    Ok(())
}
