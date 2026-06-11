use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Normalize a path by collapsing redundant `.` and `..` and removing trailing slashes.
/// Does NOT resolve symlinks (intentional — we want lexical normalization for scope checks).
pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in p.components() {
        match component {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            c => out.push(c.as_os_str()),
        }
    }
    out
}

/// Returns true if `child` is `root` or a descendant of `root`. Both are normalized first.
/// On Windows the comparison is case-insensitive (NTFS / ReFS default), so a project
/// registered as `C:\Code\Foo` still matches a path emitted as `c:\code\foo\bar.txt`
/// (e.g. from OSC 7, shell-normalized prompts, or symlinked drive letters).
pub fn is_within(root: &Path, child: &Path) -> bool {
    let root_n = normalize(root);
    let child_n = normalize(child);
    #[cfg(windows)]
    {
        let r = root_n.to_string_lossy().to_lowercase();
        let c = child_n.to_string_lossy().to_lowercase();
        c.starts_with(&r)
    }
    #[cfg(not(windows))]
    {
        child_n.starts_with(&root_n)
    }
}

/// Reject a path that doesn't sit inside any of the registered project roots.
pub fn ensure_within_roots(target: &str, roots: &[String]) -> Result<(), AppError> {
    let target = Path::new(target);
    if roots
        .iter()
        .any(|r| is_within(Path::new(r), target))
    {
        Ok(())
    } else {
        Err(AppError::PathNotAllowed(target.display().to_string()))
    }
}
