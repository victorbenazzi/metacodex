pub mod commands;
pub mod config_paths;
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let pty_mgr = PtyManager::new(app.handle().clone());
            app.manage(pty_mgr);
            app.manage(Arc::new(ProjectsCache::default()));
            app.manage(Arc::new(WatcherManager::new(app.handle().clone())));
            // Ensure the ~/.metacodex tree exists before anything reads from it.
            if let Err(e) = config_paths::ensure_dirs() {
                eprintln!("[metacodex] config_paths::ensure_dirs failed: {e}");
            }
            // Hydrate the in-memory project cache from the persisted state.
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
            commands::projects::reorder_projects,
            commands::projects::set_active_project,
            commands::projects::get_active_project_id,
            commands::projects::reveal_in_finder,
            commands::system::open_external_url,
            commands::filesystem::read_dir,
            commands::filesystem::stat,
            commands::filesystem::read_file_text,
            commands::filesystem::read_file_bytes,
            commands::filesystem::read_icon_image,
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
        ])
        .run(tauri::generate_context!())
        .expect("metacodex failed to start");
}
