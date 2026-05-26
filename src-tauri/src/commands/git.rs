use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
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

#[tauri::command]
pub async fn git_merge_into(
    app: AppHandle,
    root: String,
    branch: String,
    strategy: String,
) -> AppResult<()> {
    ensure_root_allowed(&app, &root)?;
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
