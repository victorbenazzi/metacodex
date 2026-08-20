pub mod commands;
pub mod config_paths;
pub mod directory_grants;
pub mod error;
pub mod events;
pub mod fs_ops;
pub mod git;
pub mod open_files;
pub mod preview_grants;
pub mod projects;
pub mod pty;
pub mod runtime_supervisor;
pub mod search;
pub mod util;
pub mod watcher;

use std::sync::Arc;

use commands::search::SearchRegistry;
use directory_grants::DirectoryGrants;
use open_files::PendingOpenFiles;
use preview_grants::PreviewGrants;
use projects::ProjectsCache;
use pty::PtyManager;
use runtime_supervisor::RuntimeSupervisor;
use tauri::Manager;
use watcher::WatcherManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // reqwest 0.13 + rustls 0.23, pulled in via tauri-plugin-updater, requires a
    // process-wide crypto provider before any reqwest::Client is built.
    // Install ring's provider once before the Tauri builder spins anything up.
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                if let Some(runtime) = app.try_state::<Arc<RuntimeSupervisor>>() {
                    if let Some(prepare) = runtime.begin_quit() {
                        commands::app_lifecycle::emit_prepare_and_schedule(app, prepare);
                    }
                }
            }
        })
        .setup(|app| {
            // Ensure the ~/.metacodex tree exists before anything reads from or
            // writes to it.
            if let Err(e) = config_paths::ensure_dirs() {
                eprintln!("[metacodex] config_paths::ensure_dirs failed: {e}");
            }
            let pty_mgr = PtyManager::new(app.handle().clone());
            app.manage(pty_mgr);
            app.manage(Arc::new(ProjectsCache::default()));
            app.manage(Arc::new(WatcherManager::new(app.handle().clone())));
            app.manage(Arc::new(PreviewGrants::default()));
            app.manage(Arc::new(DirectoryGrants::default()));
            app.manage(Arc::new(PendingOpenFiles::default()));
            app.manage(Arc::new(SearchRegistry::default()));
            app.manage(Arc::new(commands::git::CloneRegistry::default()));
            app.manage(Arc::new(RuntimeSupervisor::default()));
            let resume_store = Arc::new(commands::resume::ResumeStore::hydrate()?);
            if let Err(error) = resume_store.prune(30) {
                eprintln!("[metacodex] resume prune failed: {error}");
            }
            app.manage(resume_store);
            app.manage(Arc::new(commands::workspace::WorkspaceStore::default()));
            app.manage(Arc::new(commands::browser::BrowserState::default()));
            // Hydrate the in-memory project cache from the persisted state.
            if let Err(e) = projects::hydrate(app.handle()) {
                eprintln!("[metacodex] projects::hydrate failed: {e}");
            }
            commands::browser_capture::prune_now();
            // Cold-start "Open With" on Windows/Linux: macOS delivers these as
            // RunEvent::Opened (Apple Events, handled below). Other platforms
            // pass file paths via argv on the FIRST launch; the single_instance
            // callback above only fires from the SECOND launch onward, so the
            // initial path would otherwise be dropped.
            #[cfg(not(target_os = "macos"))]
            {
                let paths: Vec<String> = std::env::args()
                    .skip(1)
                    .filter(|a| !a.starts_with('-'))
                    .collect();
                if !paths.is_empty() {
                    open_files::deliver(app.handle(), paths);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::terminal::pty_prepare,
            commands::terminal::pty_attach,
            commands::terminal::pty_start,
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
            commands::projects::list_projects,
            commands::projects::reorder_projects,
            commands::projects::set_active_project,
            commands::projects::get_active_project_id,
            commands::projects::reveal_in_finder,
            commands::system::open_external_url,
            commands::system::take_pending_open_files,
            commands::app_lifecycle::app_quit_ready,
            commands::app_lifecycle::app_retry_quit,
            commands::app_lifecycle::app_force_quit,
            commands::filesystem::read_dir,
            commands::filesystem::pick_preview_file,
            commands::filesystem::stat,
            commands::filesystem::read_file_text,
            commands::filesystem::read_file_bytes,
            commands::filesystem::read_preview_text,
            commands::filesystem::read_preview_bytes,
            commands::filesystem::write_preview_text,
            commands::filesystem::move_into_project,
            commands::filesystem::write_file_text,
            commands::filesystem::create_file,
            commands::filesystem::create_dir,
            commands::workspace::save_workspace_state,
            commands::workspace::load_workspace_state,
            commands::settings::read_settings,
            commands::settings::write_settings,
            commands::settings::read_keybindings,
            commands::settings::write_keybindings,
            commands::whats_new::read_whats_new,
            commands::whats_new::write_whats_new,
            commands::watcher::watcher_watch,
            commands::watcher::watcher_unwatch,
            commands::search::search_in_project,
            commands::search::list_files,
            commands::git::git_status,
            commands::git::git_file_head_content,
            commands::git::git_commit,
            commands::git::git_discard,
            commands::git::git_create_branch,
            commands::git::git_branches,
            commands::git::git_switch_branch,
            commands::git::git_push,
            commands::git::git_worktree_list,
            commands::git::git_worktree_add,
            commands::git::git_worktree_remove,
            commands::git::git_merge_into,
            commands::git::pick_clone_parent_dir,
            commands::git::git_clone,
            commands::git::git_clone_cancel,
            commands::notifications::notify_show,
            commands::resume::resume_list,
            commands::resume::resume_save,
            commands::resume::resume_discard,
            commands::diagnostics::write_session_log,
            commands::diagnostics::write_crash,
            commands::browser::browser_set_bounds,
            commands::browser::browser_hide,
            commands::browser::browser_navigate,
            commands::browser::browser_reload,
            commands::browser::browser_go_back,
            commands::browser::browser_go_forward,
            commands::browser::browser_set_mode,
            commands::browser::browser_clear_draw,
            commands::browser::browser_take_pick,
            commands::browser::browser_url,
            commands::browser::browser_history_list,
            commands::browser::browser_history_clear,
            commands::browser::browser_capture,
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
