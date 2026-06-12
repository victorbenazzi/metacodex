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
  readDir: "read_dir",
  readFileText: "read_file_text",
  writeFileText: "write_file_text",
  readFileBytes: "read_file_bytes",
  readIconImage: "read_icon_image",
  stat: "stat",
  deletePath: "delete_path",
  renamePath: "rename_path",
  createFile: "create_file",
  createDir: "create_dir",
  movePath: "move_path",

  // filesystem — preview mode (files outside any project root)
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

  // search
  searchInProject: "search_in_project",
  listFiles: "list_files",

  // git
  gitStatus: "git_status",
  gitFileHeadContent: "git_file_head_content",
  gitBranchList: "git_branch_list",
  gitCheckout: "git_checkout",
  gitCreateBranch: "git_create_branch",
  gitWorktreeList: "git_worktree_list",
  gitWorktreeAdd: "git_worktree_add",
  gitWorktreeRemove: "git_worktree_remove",
  gitMergeInto: "git_merge_into",
  gitClone: "git_clone",
  gitCloneCancel: "git_clone_cancel",

  // notifications
  notifyShow: "notify_show",

  // resume
  resumeList: "resume_list",
  resumeSave: "resume_save",
  resumeDiscard: "resume_discard",
  resumePrune: "resume_prune",

  // diagnostics
  diagWriteSessionLog: "write_session_log",
  diagWriteCrash: "write_crash",

  // agent runtime (opencode sidecar)
  agentRuntimeStart: "agent_runtime_start",
  agentRuntimeStatus: "agent_runtime_status",
  agentRuntimeStop: "agent_runtime_stop",
  agentListModels: "agent_list_models",
  agentSetCredentials: "agent_set_credentials",
  agentListSkills: "agent_list_skills",
  agentCronList: "agent_cron_list",
  agentCronCreate: "agent_cron_create",
  agentCronUpdate: "agent_cron_update",
  agentCronDelete: "agent_cron_delete",
  agentCronSetEnabled: "agent_cron_set_enabled",
  agentCronRunNow: "agent_cron_run_now",
  agentRuntimeRestart: "agent_runtime_restart",
  agentMcpList: "agent_mcp_list",
  agentMcpFeatured: "agent_mcp_featured",
  agentMcpUpsert: "agent_mcp_upsert",
  agentMcpDelete: "agent_mcp_delete",
  agentMcpSetEnabled: "agent_mcp_set_enabled",
  agentMcpStatus: "agent_mcp_status",
  agentUiStateRead: "agent_ui_state_read",
  agentUiStateWrite: "agent_ui_state_write",
  agentEntityList: "agent_entity_list",
  agentEntityCreate: "agent_entity_create",
  agentEntityUpdate: "agent_entity_update",
  agentEntityDelete: "agent_entity_delete",
  agentEntityMemoryContext: "agent_entity_memory_context",
  agentEntityMemoryTree: "agent_entity_memory_tree",
  agentEntityMemoryRead: "agent_entity_memory_read",
  agentEntityMemoryWrite: "agent_entity_memory_write",
  agentEntityMemoryDelete: "agent_entity_memory_delete",
  agentEntityActivity: "agent_entity_activity",
  agentEntityProposals: "agent_entity_proposals",
  agentEntityProposalResolve: "agent_entity_proposal_resolve",
  agentEntityHeartbeatRead: "agent_entity_heartbeat_read",
  agentEntityHeartbeatWrite: "agent_entity_heartbeat_write",
  agentEntityStatus: "agent_entity_status",
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
