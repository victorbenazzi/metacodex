mod fs;
mod paths;
mod session;
mod ssh;
mod store;
mod types;

pub use fs::{
    create_dir, create_file, discover_projects, ensure_project_path, read_dir, read_file_bytes,
    read_file_text, stat, validate_project_candidates, write_file_text,
};
pub use paths::{normalize_remote_path, remote_basename};
pub use ssh::ssh_command_args;
pub use store::{get_access, list_accesses, remove_access, save_access, test_access};
pub use types::{RemoteAccess, RemoteAccessDraft, RemoteAccessTestResult, RemoteProjectCandidate};

pub(crate) const DEFAULT_TEXT_LIMIT: u64 = 25 * 1024 * 1024;
pub(crate) const DEFAULT_BYTES_LIMIT: u64 = 50 * 1024 * 1024;
pub(crate) const SSH_CONNECT_TIMEOUT_MS: u64 = 8_000;

pub(crate) fn ssh_error(ctx: &str, err: ssh2::Error) -> crate::error::AppError {
    crate::error::AppError::Other(format!("{ctx}: {err}"))
}
