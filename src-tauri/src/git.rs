use std::collections::HashMap;
use std::path::Path;

use git2::{Repository, Status, StatusOptions};
use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    /// Absolute path → single-char status code: "M"|"A"|"D"|"R"|"?"|"C"|"!"
    pub statuses: HashMap<String, String>,
}

pub fn git_info(root: &str) -> AppResult<Option<GitInfo>> {
    let repo = match Repository::discover(Path::new(root)) {
        Ok(r) => r,
        Err(_) => return Ok(None), // not a git repo — return None (frontend just hides)
    };

    let workdir = match repo.workdir() {
        Some(p) => p.to_path_buf(),
        None => return Ok(None),
    };

    let head = repo.head().ok();
    let branch = head
        .as_ref()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let (ahead, behind) = if let (Some(head), Some(branch_name)) = (head.as_ref(), branch.as_ref())
    {
        let local_oid = head.target();
        let upstream_branch_name = format!("refs/remotes/origin/{branch_name}");
        let upstream_oid = repo
            .refname_to_id(&upstream_branch_name)
            .ok();
        match (local_oid, upstream_oid) {
            (Some(local), Some(upstream)) => repo
                .graph_ahead_behind(local, upstream)
                .unwrap_or((0, 0)),
            _ => (0, 0),
        }
    } else {
        (0, 0)
    };

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let mut statuses_map: HashMap<String, String> = HashMap::new();
    if let Ok(statuses) = repo.statuses(Some(&mut opts)) {
        for entry in statuses.iter() {
            let s = entry.status();
            let code = status_code(s);
            if code.is_empty() {
                continue;
            }
            if let Some(rel) = entry.path() {
                let abs = workdir.join(rel);
                statuses_map.insert(abs.to_string_lossy().into_owned(), code.to_string());
            }
        }
    }

    Ok(Some(GitInfo {
        branch,
        ahead,
        behind,
        statuses: statuses_map,
    }))
}

fn status_code(s: Status) -> &'static str {
    if s.contains(Status::CONFLICTED) {
        return "!";
    }
    if s.contains(Status::WT_NEW) || s.contains(Status::INDEX_NEW) {
        // Distinguish staged-new (A) from untracked (?)
        if s.contains(Status::INDEX_NEW) {
            return "A";
        }
        return "?";
    }
    if s.contains(Status::WT_MODIFIED) || s.contains(Status::INDEX_MODIFIED) {
        return "M";
    }
    if s.contains(Status::WT_DELETED) || s.contains(Status::INDEX_DELETED) {
        return "D";
    }
    if s.contains(Status::WT_RENAMED) || s.contains(Status::INDEX_RENAMED) {
        return "R";
    }
    if s.contains(Status::WT_TYPECHANGE) || s.contains(Status::INDEX_TYPECHANGE) {
        return "T";
    }
    ""
}
