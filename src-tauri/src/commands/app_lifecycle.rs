use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::git::CloneRegistry;
use crate::error::{AppError, AppResult};
use crate::events::{EV_PREPARE_QUIT, EV_QUIT_BLOCKED};
use crate::pty::PtyManager;
use crate::runtime_supervisor::{
    PrepareQuitPayload, QuitBlockedPayload, QuitFailure, QuitTransition, RuntimeSupervisor,
    QUIT_DEADLINE,
};
use crate::watcher::WatcherManager;

pub fn emit_prepare_and_schedule(app: AppHandle, prepare: PrepareQuitPayload) {
    let _ = app.emit(EV_PREPARE_QUIT, prepare.clone());
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(QUIT_DEADLINE).await;
        let runtime = app.state::<Arc<RuntimeSupervisor>>();
        if let Some(failures) = runtime.timeout(&prepare.token) {
            let _ = app.emit(
                EV_QUIT_BLOCKED,
                QuitBlockedPayload {
                    token: prepare.token,
                    failures,
                },
            );
        }
    });
}

async fn cleanup_resources(app: &AppHandle) -> Vec<QuitFailure> {
    let clones = app.state::<Arc<CloneRegistry>>().inner().clone();
    let clone_report = match tokio::task::spawn_blocking(move || clones.abort_all()).await {
        Ok(report) => report,
        Err(error) => {
            return vec![QuitFailure::new("clones", "join_failed", error.to_string())];
        }
    };
    let pty_report = app.state::<PtyManager>().kill_all().await;
    let watchers = app.state::<Arc<WatcherManager>>().inner().clone();
    if let Err(error) = tokio::task::spawn_blocking(move || watchers.stop_all()).await {
        return vec![QuitFailure::new(
            "watchers",
            "join_failed",
            error.to_string(),
        )];
    }

    let mut failures = Vec::new();
    if clone_report.failed > 0 || !app.state::<Arc<CloneRegistry>>().is_empty() {
        failures.push(QuitFailure::new(
            "clones",
            "cleanup_failed",
            format!(
                "{} of {} clone resources failed to stop",
                clone_report.failed, clone_report.requested
            ),
        ));
    }
    if pty_report.failed > 0
        || pty_report.timed_out > 0
        || !app.state::<PtyManager>().list().is_empty()
    {
        failures.push(QuitFailure::new(
            "terminals",
            "cleanup_failed",
            format!(
                "{} failed and {} timed out while stopping {} terminal resources",
                pty_report.failed, pty_report.timed_out, pty_report.requested
            ),
        ));
    }
    if app.state::<Arc<WatcherManager>>().count() > 0 {
        failures.push(QuitFailure::new(
            "watchers",
            "cleanup_failed",
            "one or more file watchers remain active",
        ));
    }
    failures
}

fn emit_blocked(app: &AppHandle, token: String, failures: Vec<QuitFailure>) {
    let _ = app.emit(EV_QUIT_BLOCKED, QuitBlockedPayload { token, failures });
}

#[tauri::command]
pub async fn app_quit_ready(
    app: AppHandle,
    runtime: State<'_, Arc<RuntimeSupervisor>>,
    token: String,
    failures: Vec<QuitFailure>,
) -> AppResult<()> {
    match runtime.acknowledge(&token, failures) {
        QuitTransition::Ignored => Err(AppError::Other("stale quit token".into())),
        QuitTransition::Blocked(failures) => {
            emit_blocked(&app, token, failures);
            Ok(())
        }
        QuitTransition::StopResources => {
            let failures = cleanup_resources(&app).await;
            if failures.is_empty() {
                runtime.mark_stopped(&token);
                app.exit(0);
            } else {
                runtime.cleanup_failed(&token, failures.clone());
                emit_blocked(&app, token, failures);
            }
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn app_retry_quit(
    app: AppHandle,
    runtime: State<'_, Arc<RuntimeSupervisor>>,
    token: String,
) -> AppResult<()> {
    let prepare = runtime
        .retry(&token)
        .ok_or_else(|| AppError::Other("quit is not retryable".into()))?;
    emit_prepare_and_schedule(app, prepare);
    Ok(())
}

#[tauri::command]
pub async fn app_force_quit(
    app: AppHandle,
    runtime: State<'_, Arc<RuntimeSupervisor>>,
    token: String,
) -> AppResult<()> {
    if !runtime.force(&token) {
        return Err(AppError::Other("quit is not forceable".into()));
    }
    let _ = cleanup_resources(&app).await;
    runtime.mark_stopped(&token);
    app.exit(0);
    Ok(())
}
