use crate::error::{AppError, AppResult};
use crate::usage::{types::UsageSnapshot, UsageManager};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn usage_read(manager: State<'_, Arc<UsageManager>>) -> AppResult<UsageSnapshot> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || manager.snapshot())
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
pub async fn usage_refresh(
    force: bool,
    manager: State<'_, Arc<UsageManager>>,
) -> AppResult<UsageSnapshot> {
    manager.inner().refresh(force).await
}

#[tauri::command]
pub async fn usage_set_capture_enabled(
    provider_id: String,
    enabled: bool,
    manager: State<'_, Arc<UsageManager>>,
) -> AppResult<UsageSnapshot> {
    manager.inner().set_capture(provider_id, enabled).await
}

#[tauri::command]
pub async fn usage_connect_account(
    provider_id: String,
    title: String,
    app: tauri::AppHandle,
    manager: State<'_, Arc<UsageManager>>,
) -> AppResult<UsageSnapshot> {
    use crate::usage::account_auth::{default_directory, AccountGrant};
    use tauri_plugin_dialog::DialogExt;
    let extension = match provider_id.as_str() {
        "cursor-cli" => "vscdb",
        "grok" => "json",
        _ => return Err(AppError::InvalidArgument("unsupported provider".into())),
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    let filter_name = title.clone();
    let mut dialog = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter(filter_name, &[extension]);
    if let Some(directory) = default_directory(&provider_id) {
        dialog = dialog.set_directory(directory);
    }
    dialog.pick_file(move |file| {
        let _ = tx.send(file);
    });
    let picked = rx
        .await
        .map_err(|_| AppError::Other("dialog cancelled".into()))?;
    let Some(picked) = picked else {
        return usage_read(manager).await;
    };
    let path = picked
        .into_path()
        .map_err(|_| AppError::InvalidArgument("invalid account file".into()))?;
    let id = provider_id.clone();
    let grant = tokio::task::spawn_blocking(move || AccountGrant::from_picker(path, &id))
        .await
        .map_err(|_| AppError::Other("account file unavailable".into()))?
        .map_err(AppError::InvalidArgument)?;
    manager
        .inner()
        .set_account(provider_id, Some(grant), None)
        .await
}

#[tauri::command]
pub async fn usage_connect_cursor_cookie(
    cookie: String,
    manager: State<'_, Arc<UsageManager>>,
) -> AppResult<UsageSnapshot> {
    let credential =
        crate::usage::account_auth::cursor_cookie(&cookie).map_err(AppError::InvalidArgument)?;
    manager
        .inner()
        .set_account("cursor-cli".into(), None, Some(credential))
        .await
}

#[tauri::command]
pub async fn usage_disconnect_account(
    provider_id: String,
    manager: State<'_, Arc<UsageManager>>,
) -> AppResult<UsageSnapshot> {
    manager.inner().set_account(provider_id, None, None).await
}
