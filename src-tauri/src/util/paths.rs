use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Normalize a path by collapsing redundant `.` and `..` and removing trailing slashes.
/// Does NOT resolve symlinks. Scope checks stay lexical, then reject symlink
/// components below the registered root before filesystem access.
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
/// On Windows the comparison is case-insensitive and component-aware, so
/// `C:\Code\Foo` matches `c:\code\foo\bar.txt` but not `C:\Code\Foobar`.
pub fn is_within(root: &Path, child: &Path) -> bool {
    let root_n = normalize(root);
    let child_n = normalize(child);
    #[cfg(windows)]
    {
        let r: Vec<String> = root_n
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase())
            .collect();
        let c: Vec<String> = child_n
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase())
            .collect();
        c.len() >= r.len() && c.iter().zip(r.iter()).all(|(child, root)| child == root)
    }
    #[cfg(not(windows))]
    {
        child_n.starts_with(&root_n)
    }
}

fn matching_root(target: &Path, roots: &[String]) -> Option<PathBuf> {
    roots
        .iter()
        .map(|root| normalize(Path::new(root)))
        .filter(|root| is_within(root, target))
        .max_by_key(|root| root.components().count())
}

fn ensure_no_symlink_below_root(root: &Path, target: &Path) -> Result<(), AppError> {
    let root_n = normalize(root);
    let target_n = normalize(target);
    let root_depth = root_n.components().count();
    #[cfg(not(windows))]
    {
        target_n
            .strip_prefix(&root_n)
            .map_err(|_| AppError::PathNotAllowed(target.display().to_string()))?;
    }
    let mut cur = root_n;
    for component in target_n.components().skip(root_depth) {
        cur.push(component.as_os_str());
        match std::fs::symlink_metadata(&cur) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(AppError::PathNotAllowed(format!(
                    "symlink escapes project sandbox: {}",
                    cur.display()
                )));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(e) => return Err(AppError::Io(e)),
        }
    }
    Ok(())
}

/// Reject a path that doesn't sit inside any of the registered project roots.
pub fn ensure_within_roots(target: &str, roots: &[String]) -> Result<(), AppError> {
    let target = Path::new(target);
    // Fail closed on `..` segments: `normalize` collapses them lexically
    // BEFORE the kernel resolves symlinks, so `<root>/link/../x` would erase
    // the symlinked component from the walk below while the real fs op still
    // traverses it. No legitimate caller sends `..`.
    if target
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(AppError::PathNotAllowed(target.display().to_string()));
    }
    match matching_root(target, roots) {
        Some(root) => ensure_no_symlink_below_root(&root, target),
        None => Err(AppError::PathNotAllowed(target.display().to_string())),
    }
}

/// Path authorization for Project roots: empty registry denies, then
/// [`ensure_within_roots`]. Prefer this over calling `ensure_within_roots`
/// with a hand-rolled empty check at every command.
pub fn require_within_project_roots(roots: &[String], path: &str) -> Result<(), AppError> {
    if roots.is_empty() {
        return Err(AppError::PathNotAllowed(
            "no project roots registered yet".into(),
        ));
    }
    ensure_within_roots(path, roots)
}

/// Path authorization against a single Project root (e.g. PTY cwd for one Project).
pub fn require_within_project(project_root: &str, path: &str) -> Result<(), AppError> {
    ensure_within_roots(path, &[project_root.to_string()])
}

/// Whether Finder/Explorer reveal is allowed: inside Project roots, or an
/// active Preview grant path. Pure decision for tests.
pub fn may_reveal_path(roots_ok: bool, preview_grant_ok: bool) -> bool {
    roots_ok || preview_grant_ok
}

/// Path authorization for Finder reveal: Project roots, else Preview grant path.
/// Propagates non-PathNotAllowed errors from the roots check (e.g. IO on symlink walk).
pub fn authorize_reveal(
    roots: &[String],
    preview_grant_ok: bool,
    path: &str,
) -> Result<(), AppError> {
    match require_within_project_roots(roots, path) {
        Ok(()) => Ok(()),
        Err(AppError::PathNotAllowed(_)) if preview_grant_ok => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_dir_segments() {
        // Even when the path normalizes back inside the root, `..` must fail
        // closed: it can hide a symlinked component from the symlink walk
        // (e.g. `<root>/link/../inside.txt` never inspects `link`).
        let base = std::env::temp_dir().join(format!(
            "metacodex-paths-dotdot-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let root = base.join("root");
        std::fs::create_dir_all(root.join("sub")).unwrap();

        let roots = vec![root.to_string_lossy().to_string()];
        let target = root.join("sub").join("..").join("inside.txt");
        let err = ensure_within_roots(&target.to_string_lossy(), &roots).unwrap_err();
        assert!(matches!(err, AppError::PathNotAllowed(_)));

        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_below_root() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join(format!(
            "metacodex-paths-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let root = base.join("root");
        let outside = base.join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("link")).unwrap();

        let roots = vec![root.to_string_lossy().to_string()];
        let target = root.join("link").join("secret.txt");
        let err = ensure_within_roots(&target.to_string_lossy(), &roots).unwrap_err();
        assert!(matches!(err, AppError::PathNotAllowed(_)));

        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(windows)]
    #[test]
    fn windows_prefix_is_component_aware() {
        assert!(is_within(
            Path::new(r"C:\code\app"),
            Path::new(r"c:\code\app\src\main.rs")
        ));
        assert!(!is_within(
            Path::new(r"C:\code\app"),
            Path::new(r"C:\code\application\secret.txt")
        ));
    }

    #[test]
    fn require_within_project_roots_denies_empty_registry() {
        let err = require_within_project_roots(&[], "/any/path").unwrap_err();
        assert!(matches!(err, AppError::PathNotAllowed(_)));
        assert!(err.to_string().contains("no project roots"));
    }

    #[test]
    fn require_within_project_roots_allows_under_root() {
        let base = std::env::temp_dir().join(format!(
            "metacodex-paths-auth-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let root = base.join("root");
        std::fs::create_dir_all(root.join("src")).unwrap();
        let roots = vec![root.to_string_lossy().to_string()];
        let target = root.join("src").join("main.rs");
        // File need not exist for lexical + symlink walk (NotFound breaks walk early).
        require_within_project_roots(&roots, &target.to_string_lossy()).unwrap();
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn may_reveal_path_roots_or_preview() {
        assert!(!may_reveal_path(false, false));
        assert!(may_reveal_path(true, false));
        assert!(may_reveal_path(false, true));
        assert!(may_reveal_path(true, true));
    }

    #[test]
    fn authorize_reveal_allows_preview_when_outside_roots() {
        authorize_reveal(&[], true, "/tmp/outside.txt").unwrap();
        let err = authorize_reveal(&[], false, "/tmp/outside.txt").unwrap_err();
        assert!(matches!(err, AppError::PathNotAllowed(_)));
    }
}
