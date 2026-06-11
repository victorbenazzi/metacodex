pub mod agent;
pub mod commands;
pub mod config_paths;
pub mod error;
pub mod events;
pub mod fs_ops;
pub mod git;
pub mod open_files;
pub mod projects;
pub mod pty;
pub mod search;
pub mod util;
pub mod watcher;

use std::sync::Arc;

use open_files::PendingOpenFiles;
use projects::ProjectsCache;
use pty::PtyManager;
use tauri::{Emitter, Manager};
use watcher::WatcherManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // reqwest 0.13 + rustls 0.23 (pulled in via tauri-plugin-updater and the
    // AgentRuntime HTTP client) require a process-wide crypto provider to be
    // installed before any reqwest::Client is built, otherwise the client
    // constructor panics "No provider set" at launch. Install ring's provider
    // once, here, before the Tauri builder spins anything up. Idempotent: a
    // second call returns Err with the already-installed provider; we ignore it.
    let _ = rustls::crypto::ring::default_provider().install_default();

    // `mut` is used only in release (the single-instance block below); debug skips it.
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // single-instance MUST be the first plugin registered. A second launch of the
    // binary (e.g. `open -n`, or file args on a fresh exec) routes here instead of
    // spawning a duplicate process with its own PTYs / shared state.
    //
    // Skipped in DEBUG builds so a `pnpm tauri dev` window can run ALONGSIDE an
    // installed metacodex, otherwise the dev launch is routed into the installed
    // app (which focuses it) and no dev window ever appears. Pair this with
    // `METACODEX_HOME` for an isolated dev state dir.
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
            // argv[0] is the binary path; the rest may be file paths to open.
            let paths: Vec<String> = argv.into_iter().skip(1).collect();
            open_files::deliver(app, paths);
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Cmd+Q / window-close handshake. We intercept the close, fire the
        // before-quit event for the frontend to flush pending workspace saves,
        // wait a short window, then reap all PTY children before exit. Without
        // this, debounced saves are dropped AND `claude` / `codex` subprocesses
        // outlive the app as orphans.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let win = window.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = win.emit(events::EV_BEFORE_QUIT, ());
                    // Frontend flush budget. If the listener takes longer the
                    // app still exits, we don't risk hanging the user on quit.
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                    if let Some(mgr) = app.try_state::<pty::PtyManager>() {
                        mgr.kill_all().await;
                    }
                    // Reap the opencode runtime sidecar so it doesn't outlive the app.
                    if let Some(rt) = app.try_state::<agent::AgentRuntime>() {
                        rt.stop();
                    }
                    app.exit(0);
                });
            }
        })
        .setup(|app| {
            // Ensure the ~/.metacodex tree exists before anything reads from or
            // writes to it (CronStore::load persists a refreshed snapshot).
            if let Err(e) = config_paths::ensure_dirs() {
                eprintln!("[metacodex] config_paths::ensure_dirs failed: {e}");
            }
            let pty_mgr = PtyManager::new(app.handle().clone());
            app.manage(pty_mgr);
            app.manage(Arc::new(ProjectsCache::default()));
            app.manage(Arc::new(WatcherManager::new(app.handle().clone())));
            app.manage(Arc::new(PendingOpenFiles::default()));
            // opencode runtime sidecar (Agent View). Spawned lazily on first use.
            app.manage(agent::AgentRuntime::new());
            // Scheduled-task (cron) registry, hydrated from disk.
            app.manage(agent::scheduler::CronStore::load());
            // MCP server registry; regenerates the opencode config layer on boot.
            app.manage(agent::McpStore::load());
            // Agent entities (~/.metacodex/agents); reads are stateless scans.
            app.manage(agent::AgentEntityStore::new());
            // Hydrate the in-memory project cache from the persisted state.
            if let Err(e) = projects::hydrate(app.handle()) {
                eprintln!("[metacodex] projects::hydrate failed: {e}");
            }
            // Trim resume entries older than 30 days. Best-effort: corrupt
            // files are ignored so this never blocks startup.
            commands::resume::prune_blocking(30);
            // Start the Agent View cron scheduler (fires due tasks once a minute
            // while the app is open).
            agent::scheduler::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::terminal::pty_spawn,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_kill,
            commands::terminal::pty_list,
            commands::terminal::pty_metadata_batch,
            commands::terminal::pty_update_cwd,
            commands::cli::cli_detect,
            commands::projects::add_project,
            commands::projects::create_project,
            commands::projects::remove_project,
            commands::projects::rename_project,
            commands::projects::update_project_meta,
            commands::projects::list_projects,
            commands::projects::reorder_projects,
            commands::projects::set_active_project,
            commands::projects::get_active_project_id,
            commands::projects::reveal_in_finder,
            commands::system::open_external_url,
            commands::system::take_pending_open_files,
            commands::filesystem::read_dir,
            commands::filesystem::stat,
            commands::filesystem::read_file_text,
            commands::filesystem::read_file_bytes,
            commands::filesystem::read_icon_image,
            commands::filesystem::read_preview_text,
            commands::filesystem::read_preview_bytes,
            commands::filesystem::write_preview_text,
            commands::filesystem::move_into_project,
            commands::filesystem::write_file_text,
            commands::filesystem::delete_path,
            commands::filesystem::rename_path,
            commands::filesystem::create_file,
            commands::filesystem::create_dir,
            commands::filesystem::move_path,
            commands::workspace::save_workspace_state,
            commands::workspace::load_workspace_state,
            commands::settings::read_settings,
            commands::settings::write_settings,
            commands::settings::read_keybindings,
            commands::settings::write_keybindings,
            commands::watcher::watcher_watch,
            commands::watcher::watcher_unwatch,
            commands::search::search_in_project,
            commands::search::list_files,
            commands::git::git_status,
            commands::git::git_file_head_content,
            commands::git::git_branch_list,
            commands::git::git_checkout,
            commands::git::git_create_branch,
            commands::git::git_worktree_list,
            commands::git::git_worktree_add,
            commands::git::git_worktree_remove,
            commands::git::git_merge_into,
            commands::git::git_clone,
            commands::notifications::notify_show,
            commands::resume::resume_list,
            commands::resume::resume_save,
            commands::resume::resume_discard,
            commands::resume::resume_prune,
            commands::diagnostics::write_session_log,
            commands::diagnostics::write_crash,
            commands::agent::agent_runtime_start,
            commands::agent::agent_runtime_status,
            commands::agent::agent_runtime_stop,
            commands::agent::agent_list_models,
            commands::agent::agent_set_credentials,
            commands::agent::agent_list_skills,
            commands::agent::agent_cron_list,
            commands::agent::agent_cron_create,
            commands::agent::agent_cron_update,
            commands::agent::agent_cron_delete,
            commands::agent::agent_cron_set_enabled,
            commands::agent::agent_cron_run_now,
            commands::agent::agent_runtime_restart,
            commands::agent::agent_mcp_list,
            commands::agent::agent_mcp_featured,
            commands::agent::agent_mcp_upsert,
            commands::agent::agent_mcp_delete,
            commands::agent::agent_mcp_set_enabled,
            commands::agent::agent_mcp_status,
            commands::agent::agent_entity_list,
            commands::agent::agent_entity_create,
            commands::agent::agent_entity_update,
            commands::agent::agent_entity_delete,
            commands::agent::agent_entity_memory_context,
            commands::agent::agent_entity_memory_tree,
            commands::agent::agent_entity_memory_read,
            commands::agent::agent_entity_memory_write,
            commands::agent::agent_entity_memory_delete,
            commands::agent::agent_entity_activity,
            commands::agent::agent_entity_proposals,
            commands::agent::agent_entity_proposal_resolve,
            commands::agent::agent_ui_state_read,
            commands::agent::agent_ui_state_write,
        ])
        .build(tauri::generate_context!())
        .expect("metacodex failed to start")
        .run(|app_handle, event| {
            // macOS delivers Finder "Open With" / double-click opens as an Apple
            // Event surfaced here as RunEvent::Opened, for both cold start and
            // warm (already-running) opens.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                open_files::handle_opened(app_handle, urls);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app_handle, event);
            }
        });
}
