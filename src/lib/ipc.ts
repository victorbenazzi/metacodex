import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * Centralized Tauri command names.
 * Adding a new command? Add it here AND in `src-tauri/src/lib.rs::generate_handler!`.
 */
export const CMD = {
  // pty
  ptySpawn: "pty_spawn",
  ptyWrite: "pty_write",
  ptyResize: "pty_resize",
  ptyKill: "pty_kill",
  ptyList: "pty_list",

  // cli
  cliDetect: "cli_detect",

  // projects
  addProject: "add_project",
  removeProject: "remove_project",
  renameProject: "rename_project",
  updateProjectMeta: "update_project_meta",
  listProjects: "list_projects",
  setActiveProject: "set_active_project",
  getActiveProjectId: "get_active_project_id",
  revealInFinder: "reveal_in_finder",
  openFolderDialog: "open_folder_dialog",

  // filesystem
  readDir: "read_dir",
  readFileText: "read_file_text",
  writeFileText: "write_file_text",
  readFileBytes: "read_file_bytes",
  stat: "stat",

  // workspace
  saveWorkspaceState: "save_workspace_state",
  loadWorkspaceState: "load_workspace_state",

  // watcher
  watcherWatch: "watcher_watch",
  watcherUnwatch: "watcher_unwatch",

  // search
  searchInProject: "search_in_project",

  // git
  gitStatus: "git_status",
} as const;

export type CmdName = (typeof CMD)[keyof typeof CMD];

export async function invoke<T = unknown>(cmd: CmdName, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

/** Tauri command error shape returned by `AppError` (serialized as { code, message }). */
export interface AppError {
  code: string;
  message: string;
}

export function isAppError(err: unknown): err is AppError {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as AppError).code === "string" &&
    typeof (err as AppError).message === "string"
  );
}
