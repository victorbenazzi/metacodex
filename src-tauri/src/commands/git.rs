use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// In-flight `git clone` processes keyed by op_id, so the UI can abort a clone
/// that's hanging on a slow network. Managed in `lib.rs`.
#[derive(Default)]
pub struct CloneRegistry(Mutex<HashMap<String, Child>>);

use crate::error::{AppError, AppResult};
use crate::events::{GitCloneProgressPayload, EV_GIT_CLONE_PROGRESS};
use crate::git::{file_head_content, git_info, GitInfo};
use crate::projects::ProjectsCache;
use crate::util::paths;

#[tauri::command]
pub async fn git_status(app: AppHandle, root: String) -> AppResult<Option<GitInfo>> {
    {
        let cache = app.state::<Arc<ProjectsCache>>();
        let roots = cache.project_roots();
        if roots.is_empty() {
            return Err(AppError::PathNotAllowed(
                "no project roots registered yet".into(),
            ));
        }
        paths::ensure_within_roots(&root, &roots)?;
    }
    tokio::task::spawn_blocking(move || git_info(&root))
        .await
        .map_err(|e| AppError::Other(format!("join: {e}")))?
}

/// Committed (HEAD) text of a file, for the editor's change gutter. Read-only.
#[tauri::command]
pub async fn git_file_head_content(app: AppHandle, path: String) -> AppResult<Option<String>> {
    {
        let cache = app.state::<Arc<ProjectsCache>>();
        let roots = cache.project_roots();
        if roots.is_empty() {
            return Err(AppError::PathNotAllowed(
                "no project roots registered yet".into(),
            ));
        }
        paths::ensure_within_roots(&path, &roots)?;
    }
    tokio::task::spawn_blocking(move || file_head_content(&path))
        .await
        .map_err(|e| AppError::Other(format!("join: {e}")))?
}

// -- Branch management ---------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub current: bool,
}

/// Local branches of the repo at `root`, most-recently-committed first. The
/// current branch is flagged via `%(HEAD)` (`*`).
#[tauri::command]
pub async fn git_branch_list(app: AppHandle, root: String) -> AppResult<Vec<BranchInfo>> {
    ensure_root_allowed(&app, &root)?;
    tokio::task::spawn_blocking(move || {
        let out = run_git(
            &root,
            &[
                "for-each-ref",
                "--sort=-committerdate",
                "--format=%(HEAD)\t%(refname:short)",
                "refs/heads/",
            ],
        )?;
        if !out.status.success() {
            return Err(AppError::Other(format!(
                "git branch list failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let branches = text
            .lines()
            .filter_map(|line| {
                let mut parts = line.splitn(2, '\t');
                let head = parts.next().unwrap_or("");
                let name = parts.next().unwrap_or("").trim();
                if name.is_empty() {
                    return None;
                }
                Some(BranchInfo {
                    name: name.to_string(),
                    current: head == "*",
                })
            })
            .collect();
        Ok(branches)
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {e}")))?
}

/// Switch the working tree at `root` to an existing local branch.
#[tauri::command]
pub async fn git_checkout(app: AppHandle, root: String, branch: String) -> AppResult<()> {
    ensure_root_allowed(&app, &root)?;
    if !valid_branch_name(&branch) {
        return Err(AppError::Other(format!("invalid branch name: {branch}")));
    }
    tokio::task::spawn_blocking(move || {
        let out = run_git(&root, &["checkout", branch.as_str()])?;
        if !out.status.success() {
            return Err(AppError::Other(
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {e}")))?
}

/// Create a new branch off the current HEAD and switch to it.
#[tauri::command]
pub async fn git_create_branch(app: AppHandle, root: String, name: String) -> AppResult<()> {
    ensure_root_allowed(&app, &root)?;
    let name = name.trim().to_string();
    if !valid_branch_name(&name) {
        return Err(AppError::Other(format!("invalid branch name: {name}")));
    }
    tokio::task::spawn_blocking(move || {
        let out = run_git(&root, &["checkout", "-b", name.as_str()])?;
        if !out.status.success() {
            return Err(AppError::Other(
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {e}")))?
}

// -- Worktree primitives -------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub is_main: bool,
    pub locked: bool,
    pub prunable: bool,
}

fn ensure_root_allowed(app: &AppHandle, root: &str) -> AppResult<()> {
    let cache = app.state::<Arc<ProjectsCache>>();
    let roots = cache.project_roots();
    if roots.is_empty() {
        return Err(AppError::PathNotAllowed(
            "no project roots registered yet".into(),
        ));
    }
    paths::ensure_within_roots(root, &roots)
}

fn run_git(root: &str, args: &[&str]) -> Result<std::process::Output, AppError> {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| AppError::Other(format!("git {args:?}: {e}")))
}

fn parse_worktree_porcelain(out: &str, main_root: &Path) -> Vec<WorktreeInfo> {
    let mut records: Vec<WorktreeInfo> = Vec::new();
    let mut cur: Option<WorktreeInfo> = None;
    for line in out.lines() {
        if line.is_empty() {
            if let Some(w) = cur.take() {
                records.push(w);
            }
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            cur = Some(WorktreeInfo {
                path: path.to_string(),
                branch: None,
                head: None,
                is_main: Path::new(path) == main_root,
                locked: false,
                prunable: false,
            });
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            if let Some(w) = cur.as_mut() {
                w.head = Some(head.chars().take(10).collect());
            }
        } else if let Some(branch) = line.strip_prefix("branch ") {
            if let Some(w) = cur.as_mut() {
                w.branch = Some(branch.replace("refs/heads/", ""));
            }
        } else if line == "locked" || line.starts_with("locked ") {
            if let Some(w) = cur.as_mut() {
                w.locked = true;
            }
        } else if line == "prunable" || line.starts_with("prunable ") {
            if let Some(w) = cur.as_mut() {
                w.prunable = true;
            }
        }
    }
    if let Some(w) = cur.take() {
        records.push(w);
    }
    records
}

fn valid_branch_name(name: &str) -> bool {
    // Forbid characters git itself rejects; the regex is intentionally narrow.
    if name.is_empty() || name.starts_with('-') || name.ends_with(".lock") {
        return false;
    }
    name.chars().all(|c| {
        c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '/' | '.')
    }) && !name.contains("..")
}

fn default_worktree_path(root: &str, branch_name: &str) -> PathBuf {
    let slug: String = branch_name
        .chars()
        .map(|c| match c {
            '/' => '-',
            c if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' => c,
            _ => '-',
        })
        .collect();
    PathBuf::from(root)
        .join(".metacodex")
        .join("worktrees")
        .join(slug)
}

#[tauri::command]
pub async fn git_worktree_list(app: AppHandle, root: String) -> AppResult<Vec<WorktreeInfo>> {
    ensure_root_allowed(&app, &root)?;
    let root_clone = root.clone();
    tokio::task::spawn_blocking(move || {
        let out = run_git(&root_clone, &["worktree", "list", "--porcelain"])?;
        if !out.status.success() {
            return Err(AppError::Other(format!(
                "git worktree list failed: {}",
                String::from_utf8_lossy(&out.stderr)
            )));
        }
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        Ok(parse_worktree_porcelain(&text, Path::new(&root_clone)))
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {e}")))?
}

#[tauri::command]
pub async fn git_worktree_add(
    app: AppHandle,
    root: String,
    branch_name: String,
    target_path: Option<String>,
    base_ref: Option<String>,
) -> AppResult<WorktreeInfo> {
    ensure_root_allowed(&app, &root)?;
    if !valid_branch_name(&branch_name) {
        return Err(AppError::Other(format!(
            "invalid branch name: {branch_name}"
        )));
    }
    let target = match target_path {
        Some(p) => {
            // If explicit, validate it lives inside a registered root too.
            ensure_root_allowed(&app, &p)?;
            PathBuf::from(p)
        }
        None => default_worktree_path(&root, &branch_name),
    };
    let target_str = target.to_string_lossy().into_owned();
    let root_clone = root.clone();
    let branch_clone = branch_name.clone();
    let base = base_ref.unwrap_or_else(|| "HEAD".to_string());
    // base is passed positionally as the commit-ish; a leading `-` would be
    // parsed as a flag to `git worktree add`. Validate like any other ref.
    if !valid_branch_name(&base) && base != "HEAD" {
        return Err(AppError::Other(format!("invalid base ref: {base}")));
    }

    tokio::task::spawn_blocking(move || -> AppResult<WorktreeInfo> {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Other(format!("create_dir_all: {e}")))?;
        }
        // Detect whether the branch already exists — if so, don't pass `-b`.
        let branch_exists = run_git(
            &root_clone,
            &[
                "rev-parse",
                "--verify",
                &format!("refs/heads/{branch_clone}"),
            ],
        )
        .map(|o| o.status.success())
        .unwrap_or(false);

        let mut args: Vec<String> = vec!["worktree".into(), "add".into()];
        if !branch_exists {
            args.push("-b".into());
            args.push(branch_clone.clone());
        }
        args.push(target_str.clone());
        if !branch_exists {
            args.push(base);
        } else {
            args.push(branch_clone.clone());
        }
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = run_git(&root_clone, &args_ref)?;
        if !out.status.success() {
            return Err(AppError::Other(format!(
                "git worktree add failed: {}",
                String::from_utf8_lossy(&out.stderr)
            )));
        }
        Ok(WorktreeInfo {
            path: target_str,
            branch: Some(branch_clone),
            head: None,
            is_main: false,
            locked: false,
            prunable: false,
        })
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {e}")))?
}

#[tauri::command]
pub async fn git_worktree_remove(
    app: AppHandle,
    root: String,
    worktree_path: String,
    force: bool,
) -> AppResult<()> {
    ensure_root_allowed(&app, &root)?;
    ensure_root_allowed(&app, &worktree_path)?;
    let root_clone = root.clone();
    let wt = worktree_path.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let mut args = vec!["worktree".to_string(), "remove".to_string()];
        if force {
            args.push("--force".to_string());
        }
        args.push(wt.clone());
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = run_git(&root_clone, &args_ref)?;
        if !out.status.success() {
            return Err(AppError::Other(format!(
                "git worktree remove failed: {}",
                String::from_utf8_lossy(&out.stderr)
            )));
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {e}")))?
}

// -- Clone --------------------------------------------------------------------

fn invalid_folder_name(name: &str) -> bool {
    name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name == "."
        || name == ".."
        || name.contains('\0')
}

/// Allow only the network transports a user actually pastes. Git invoked
/// directly honors `ext::`/`file::` transports, which run arbitrary commands
/// during clone (e.g. `ext::sh -c "..."`), so the scheme MUST be allow-listed.
/// A leading `-` would also be parsed as a flag; reject it too.
fn valid_clone_url(url: &str) -> bool {
    if url.is_empty() || url.len() > 2048 || url.starts_with('-') || url.contains('\0') {
        return false;
    }
    let lower = url.to_ascii_lowercase();
    const ALLOWED: [&str; 4] = ["https://", "http://", "git://", "ssh://"];
    if ALLOWED.iter().any(|p| lower.starts_with(p)) {
        return true;
    }
    // scp-style: user@host:path or host:path (no scheme). Reject anything that
    // smells like an explicit transport (contains "::") to keep ext::/file:: out.
    if lower.contains("::") {
        return false;
    }
    if let Some(colon) = url.find(':') {
        // A "//" right after the colon means a scheme form (e.g. file://) that
        // wasn't in the allow-list above — reject. scp-style has no "//".
        if url[colon + 1..].starts_with("//") {
            return false;
        }
        let host = &url[..colon];
        // host part must look like a hostname / user@host, never a path/flag.
        !host.is_empty()
            && !host.contains('/')
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '@'))
    } else {
        false
    }
}

/// Parse a single stderr line from `git clone --progress`. Lines look like:
///   "Receiving objects:  47% (470/1000), 1.2 MiB | 600 KiB/s"
///   "Resolving deltas: 100% (300/300), done."
/// We only care about the "<phase>: <percent>%" prefix.
fn parse_clone_progress(line: &str) -> Option<(String, u32)> {
    let colon = line.find(':')?;
    let phase = line[..colon].trim().to_string();
    if phase.is_empty() {
        return None;
    }
    let rest = &line[colon + 1..];
    let pct_end = rest.find('%')?;
    let pct_str = rest[..pct_end].trim();
    let pct: u32 = pct_str.parse().ok()?;
    Some((phase, pct.min(100)))
}

#[tauri::command]
pub async fn git_clone(
    app: AppHandle,
    op_id: String,
    url: String,
    parent_dir: String,
    folder_name: String,
) -> AppResult<String> {
    // Validation — destination lives outside any registered root, so we can't
    // use ensure_within_roots. Tight argument checks instead.
    let url_trimmed = url.trim().to_string();
    if !valid_clone_url(&url_trimmed) {
        return Err(AppError::Other("invalid url".into()));
    }
    if invalid_folder_name(folder_name.trim()) {
        return Err(AppError::Other("invalid folder name".into()));
    }
    let folder = folder_name.trim().to_string();
    let parent = PathBuf::from(&parent_dir);
    if !parent.is_absolute() {
        return Err(AppError::Other("parent_dir must be absolute".into()));
    }
    if !parent.exists() || !parent.is_dir() {
        return Err(AppError::Other("parent_dir does not exist".into()));
    }
    let dest = parent.join(&folder);
    if dest.exists() {
        return Err(AppError::Other(format!(
            "destination already exists: {}",
            dest.display()
        )));
    }

    let dest_str = dest.to_string_lossy().into_owned();
    let dest_for_thread = dest.clone();
    let op_id_clone = op_id.clone();
    let registry = app.state::<Arc<CloneRegistry>>().inner().clone();

    tokio::task::spawn_blocking(move || -> AppResult<String> {
        let mut child = Command::new("git")
            .arg("clone")
            .arg("--progress")
            .arg("--")
            .arg(&url_trimmed)
            .arg(dest_for_thread.as_os_str())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Disable interactive credential prompts — they'd hang our pipe forever.
            // The user's credential helper / SSH agent still works; only the
            // tty-prompt fallback is suppressed.
            .env("GIT_TERMINAL_PROMPT", "0")
            // Belt-and-suspenders with valid_clone_url: even if a transport slips
            // through, git refuses anything outside this list.
            .env("GIT_ALLOW_PROTOCOL", "https:http:git:ssh")
            .spawn()
            .map_err(|e| AppError::Other(format!("git clone spawn: {e}")))?;

        // Read stderr line-by-line. `git clone --progress` separates progress
        // updates with carriage returns, NOT newlines — BufRead::read_until('\r')
        // gives us each progress tick. We aggregate the last raw line so we can
        // surface it in the error message on failure.
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Other("git clone: no stderr pipe".into()))?;
        let mut reader = BufReader::new(stderr);

        // Register the child (stderr already detached) so git_clone_cancel can
        // kill it. Killing closes stderr → the read loop hits EOF → we reap below.
        registry.0.lock().insert(op_id_clone.clone(), child);

        let mut last_emit = Instant::now() - Duration::from_secs(1);
        let mut last_phase = String::new();
        let mut last_percent: i32 = -1;
        let mut full_stderr = String::new();
        let mut chunk: Vec<u8> = Vec::with_capacity(256);

        loop {
            chunk.clear();
            let n = match reader.read_until(b'\n', &mut chunk) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            // Progress ticks arrive separated by \r; split on either.
            let raw = String::from_utf8_lossy(&chunk[..n]);
            for part in raw.split(['\r', '\n']) {
                let line = part.trim();
                if line.is_empty() {
                    continue;
                }
                full_stderr.push_str(line);
                full_stderr.push('\n');
                if let Some((phase, percent)) = parse_clone_progress(line) {
                    let same_phase = phase == last_phase;
                    let same_pct = (percent as i32) == last_percent;
                    let elapsed = last_emit.elapsed();
                    // Always emit phase changes and 100%; otherwise throttle ~100ms.
                    let should_emit = !same_phase
                        || percent == 100
                        || (!same_pct && elapsed >= Duration::from_millis(100));
                    if should_emit {
                        last_emit = Instant::now();
                        last_phase = phase.clone();
                        last_percent = percent as i32;
                        let _ = app.emit(
                            EV_GIT_CLONE_PROGRESS,
                            GitCloneProgressPayload {
                                op_id: op_id_clone.clone(),
                                phase,
                                percent,
                            },
                        );
                    }
                }
            }
        }

        // Reclaim the child from the registry to reap it. If it's already gone,
        // git_clone_cancel removed and killed it — report cancellation.
        let mut child = match registry.0.lock().remove(&op_id_clone) {
            Some(c) => c,
            None => {
                let _ = std::fs::remove_dir_all(&dest_for_thread);
                return Err(AppError::Other("clone cancelled".into()));
            }
        };
        let status = child
            .wait()
            .map_err(|e| AppError::Other(format!("git clone wait: {e}")))?;
        if !status.success() {
            // Best-effort cleanup of a partially-created destination so the
            // user can retry without hitting "destination already exists".
            let _ = std::fs::remove_dir_all(&dest_for_thread);
            let trimmed = full_stderr.trim();
            // Truncate the message so a giant stderr doesn't blow up the toast.
            // Keep the TAIL — that's where the actual fatal line lives.
            let msg = if trimmed.chars().count() > 2000 {
                let tail: String = trimmed.chars().rev().take(2000).collect();
                tail.chars().rev().collect()
            } else {
                trimmed.to_string()
            };
            return Err(AppError::Other(msg));
        }

        Ok(dest_str)
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {e}")))?
}

/// Abort an in-flight clone. Removing the child from the registry and killing it
/// closes its stderr, so the clone task's read loop ends and it cleans up the
/// partial destination. No-op if the op already finished.
#[tauri::command]
pub async fn git_clone_cancel(app: AppHandle, op_id: String) -> AppResult<()> {
    let registry = app.state::<Arc<CloneRegistry>>();
    let child = registry.0.lock().remove(&op_id);
    if let Some(mut c) = child {
        let _ = c.kill();
        let _ = c.wait();
    }
    Ok(())
}

#[tauri::command]
pub async fn git_merge_into(
    app: AppHandle,
    root: String,
    branch: String,
    strategy: String,
) -> AppResult<()> {
    ensure_root_allowed(&app, &root)?;
    if !valid_branch_name(&branch) {
        return Err(AppError::Other(format!("invalid branch name: {branch}")));
    }
    let root_clone = root.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let mut args = vec!["merge".to_string()];
        match strategy.as_str() {
            "ff-only" => args.push("--ff-only".into()),
            "squash" => {
                args.push("--squash".into());
            }
            "merge" => {
                args.push("--no-ff".into());
            }
            other => {
                return Err(AppError::Other(format!("unknown merge strategy: {other}")));
            }
        }
        args.push("--".into());
        args.push(branch.clone());
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = run_git(&root_clone, &args_ref)?;
        if !out.status.success() {
            return Err(AppError::Other(format!(
                "git merge failed: {}",
                String::from_utf8_lossy(&out.stderr)
            )));
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::{valid_branch_name, valid_clone_url};

    #[test]
    fn clone_url_allows_real_remotes() {
        assert!(valid_clone_url("https://github.com/owner/repo.git"));
        assert!(valid_clone_url("http://example.com/x.git"));
        assert!(valid_clone_url("git://example.com/x.git"));
        assert!(valid_clone_url("ssh://git@example.com/x.git"));
        assert!(valid_clone_url("git@github.com:owner/repo.git"));
    }

    #[test]
    fn clone_url_rejects_dangerous_transports() {
        assert!(!valid_clone_url("ext::sh -c \"id\""));
        assert!(!valid_clone_url("file:///etc/passwd"));
        assert!(!valid_clone_url("-oProxyCommand=evil"));
        assert!(!valid_clone_url("--upload-pack=evil"));
        assert!(!valid_clone_url(""));
        assert!(!valid_clone_url("not a url"));
    }

    #[test]
    fn branch_name_rejects_flags() {
        assert!(valid_branch_name("feature/foo"));
        assert!(!valid_branch_name("--force"));
        assert!(!valid_branch_name("-x"));
        assert!(!valid_branch_name("a..b"));
    }
}
