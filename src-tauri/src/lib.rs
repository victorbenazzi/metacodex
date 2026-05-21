pub mod commands;
pub mod error;
pub mod events;
pub mod fs_ops;
pub mod git;
pub mod projects;
pub mod pty;
pub mod search;
pub mod util;
pub mod watcher;

use std::sync::Arc;

use projects::ProjectsCache;
use pty::PtyManager;
use tauri::Manager;
use watcher::WatcherManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let pty_mgr = PtyManager::new(app.handle().clone());
            app.manage(pty_mgr);
            app.manage(Arc::new(ProjectsCache::default()));
            app.manage(Arc::new(WatcherManager::new(app.handle().clone())));
            // Hydrate the in-memory project cache from the persisted store.
            if let Err(e) = projects::hydrate(app.handle()) {
                eprintln!("[metacodex] projects::hydrate failed: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::terminal::pty_spawn,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_kill,
            commands::terminal::pty_list,
            commands::cli::cli_detect,
            commands::projects::add_project,
            commands::projects::remove_project,
            commands::projects::rename_project,
            commands::projects::update_project_meta,
            commands::projects::list_projects,
            commands::projects::set_active_project,
            commands::projects::get_active_project_id,
            commands::projects::reveal_in_finder,
            commands::filesystem::read_dir,
            commands::filesystem::stat,
            commands::filesystem::read_file_text,
            commands::filesystem::read_file_bytes,
            commands::filesystem::write_file_text,
            commands::workspace::save_workspace_state,
            commands::workspace::load_workspace_state,
            commands::watcher::watcher_watch,
            commands::watcher::watcher_unwatch,
            commands::search::search_in_project,
            commands::git::git_status,
        ])
        .run(tauri::generate_context!())
        .expect("metacodex failed to start");
}
