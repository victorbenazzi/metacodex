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
  ptyMetadataBatch: "pty_metadata_batch",
  ptyUpdateCwd: "pty_update_cwd",

  // cli
  cliDetect: "cli_detect",

  // projects
  addProject: "add_project",
  createProject: "create_project",
  removeProject: "remove_project",
  renameProject: "rename_project",
  updateProjectMeta: "update_project_meta",
  listProjects: "list_projects",
  reorderProjects: "reorder_projects",
  setActiveProject: "set_active_project",
  getActiveProjectId: "get_active_project_id",
  revealInFinder: "reveal_in_finder",

  // system
  openExternalUrl: "open_external_url",
  takePendingOpenFiles: "take_pending_open_files",

  // filesystem
  pickPreviewFile: "pick_preview_file",
  pickProjectIcon: "pick_project_icon",
  readDir: "read_dir",
  readFileText: "read_file_text",
  writeFileText: "write_file_text",
  readFileBytes: "read_file_bytes",
  stat: "stat",
  createFile: "create_file",
  createDir: "create_dir",

  // filesystem preview mode (files outside any project root)
  readPreviewText: "read_preview_text",
  readPreviewBytes: "read_preview_bytes",
  writePreviewText: "write_preview_text",
  moveIntoProject: "move_into_project",

  // workspace
  saveWorkspaceState: "save_workspace_state",
  loadWorkspaceState: "load_workspace_state",

  // settings / keybindings (persisted to ~/.metacodex)
  readSettings: "read_settings",
  writeSettings: "write_settings",
  readKeybindings: "read_keybindings",
  writeKeybindings: "write_keybindings",

  // watcher
  watcherWatch: "watcher_watch",
  watcherUnwatch: "watcher_unwatch",

  // whats-new (post-update changelog marker)
  readWhatsNew: "read_whats_new",
  writeWhatsNew: "write_whats_new",

  // search
  searchInProject: "search_in_project",
  listFiles: "list_files",

  // git
  gitStatus: "git_status",
  gitFileHeadContent: "git_file_head_content",
  gitWorktreeList: "git_worktree_list",
  gitWorktreeAdd: "git_worktree_add",
  gitWorktreeRemove: "git_worktree_remove",
  gitMergeInto: "git_merge_into",
  pickCloneParentDir: "pick_clone_parent_dir",
  gitClone: "git_clone",
  gitCloneCancel: "git_clone_cancel",

  // notifications
  notifyShow: "notify_show",

  // resume
  resumeList: "resume_list",
  resumeSave: "resume_save",
  resumeDiscard: "resume_discard",

  // diagnostics
  diagWriteSessionLog: "write_session_log",
  diagWriteCrash: "write_crash",

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
