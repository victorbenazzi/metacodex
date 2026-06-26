use std::collections::HashMap;
use std::path::Path;

use git2::{DiffOptions, Patch, Repository, Status, StatusOptions};
use serde::Serialize;

use crate::error::AppResult;

const DIFF_STATS_MAX_BLOB_BYTES: i64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    /// Absolute path → single-char status code: "M"|"A"|"D"|"R"|"?"|"C"|"!"
    pub statuses: HashMap<String, String>,
    pub stats: Option<GitStats>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStats {
    pub additions: usize,
    pub deletions: usize,
    /// Absolute path → diff line counts against HEAD.
    pub files: HashMap<String, GitFileStats>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStats {
    pub additions: usize,
    pub deletions: usize,
}

pub fn git_info(root: &str, include_stats: bool) -> AppResult<Option<GitInfo>> {
    let repo = match Repository::discover(Path::new(root)) {
        Ok(r) => r,
        Err(_) => return Ok(None), // not a git repo , return None (frontend just hides)
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

    let stats = include_stats.then(|| diff_stats(&repo, &workdir));

    Ok(Some(GitInfo {
        branch,
        ahead,
        behind,
        statuses: statuses_map,
        stats,
    }))
}

fn diff_stats(repo: &Repository, workdir: &Path) -> GitStats {
    let tree = repo
        .head()
        .and_then(|h| h.peel_to_commit())
        .and_then(|c| c.tree())
        .ok();

    let mut opts = DiffOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(false)
        .max_size(DIFF_STATS_MAX_BLOB_BYTES);

    let diff = match repo.diff_tree_to_workdir_with_index(tree.as_ref(), Some(&mut opts)) {
        Ok(diff) => diff,
        Err(_) => return GitStats::default(),
    };

    let mut stats = GitStats::default();
    for (idx, delta) in diff.deltas().enumerate() {
        let rel = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path());
        let Some(rel) = rel else {
            continue;
        };
        let Ok(Some(patch)) = Patch::from_diff(&diff, idx) else {
            continue;
        };
        let Ok((_, additions, deletions)) = patch.line_stats() else {
            continue;
        };

        let abs = workdir.join(rel).to_string_lossy().into_owned();
        stats.additions += additions;
        stats.deletions += deletions;
        stats.files.insert(
            abs,
            GitFileStats {
                additions,
                deletions,
            },
        );
    }

    stats
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

/// Return the committed (HEAD) contents of `path` as text, or `None` when the
/// file is untracked, the path is outside a repo, there are no commits yet, or
/// the blob isn't valid text. Used to diff an open buffer against HEAD for the
/// editor's change gutter , read-only, never mutates anything.
pub fn file_head_content(path: &str) -> AppResult<Option<String>> {
    let p = Path::new(path);
    let repo = match Repository::discover(p) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };
    let workdir = match repo.workdir() {
        Some(w) => w.to_path_buf(),
        None => return Ok(None),
    };
    let rel = match p.strip_prefix(&workdir) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };
    let tree = match repo.head().and_then(|h| h.peel_to_commit()).and_then(|c| c.tree()) {
        Ok(t) => t,
        Err(_) => return Ok(None), // unborn branch / no commits
    };
    let entry = match tree.get_path(rel) {
        Ok(e) => e,
        Err(_) => return Ok(None), // not tracked at HEAD (new file)
    };
    let obj = match entry.to_object(&repo) {
        Ok(o) => o,
        Err(_) => return Ok(None),
    };
    match obj.as_blob() {
        Some(blob) => Ok(Some(String::from_utf8_lossy(blob.content()).into_owned())),
        None => Ok(None), // a tree, not a file
    }
}
