use std::path::Path;

use crate::error::{AppError, AppResult};

use super::ssh_error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteNodeKind {
    File,
    Dir,
    Symlink,
    Other,
}

pub(crate) trait RemotePathStat {
    fn remote_lstat(&self, path: &str) -> AppResult<RemoteNodeKind>;
}

impl RemotePathStat for ssh2::Sftp {
    fn remote_lstat(&self, path: &str) -> AppResult<RemoteNodeKind> {
        let stat = self
            .lstat(Path::new(path))
            .map_err(|e| ssh_error("remote stat", e))?;
        let file_type = stat.file_type();
        if file_type.is_symlink() {
            Ok(RemoteNodeKind::Symlink)
        } else if file_type.is_dir() {
            Ok(RemoteNodeKind::Dir)
        } else if file_type.is_file() {
            Ok(RemoteNodeKind::File)
        } else {
            Ok(RemoteNodeKind::Other)
        }
    }
}

pub fn normalize_remote_path(path: &str) -> AppResult<String> {
    let trimmed = path.trim().replace('\\', "/");
    if trimmed.is_empty() || !trimmed.starts_with('/') || trimmed.contains('\0') {
        return Err(AppError::PathNotAllowed(format!(
            "remote path must be absolute: {path:?}"
        )));
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in trimmed.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(AppError::PathNotAllowed(format!(
                "remote traversal is not allowed: {path:?}"
            )));
        }
        parts.push(part);
    }
    if parts.is_empty() {
        Ok("/".into())
    } else {
        Ok(format!("/{}", parts.join("/")))
    }
}

pub(crate) fn remote_join(parent: &str, name: &str) -> AppResult<String> {
    validate_relative_name(name)?;
    let mut path = normalize_remote_path(parent)?;
    if path != "/" {
        path.push('/');
    }
    path.push_str(name.trim());
    normalize_remote_path(&path)
}

/// A leaf name for create-file / create-dir: exactly one path segment, no
/// separators. Multi-segment names were accepted before but could never be
/// created (the parent chain would not exist), so reject them at the door.
fn validate_relative_name(name: &str) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('\0')
        || name.contains('/')
        || name.contains('\\')
    {
        return Err(AppError::Other(format!("invalid name: {name:?}")));
    }
    Ok(())
}

pub(crate) fn path_within_root(root: &str, target: &str) -> bool {
    root == "/"
        || target == root
        || target
            .strip_prefix(root)
            .is_some_and(|s| s.starts_with('/'))
}

pub(crate) fn ensure_allowed<S: RemotePathStat>(
    stat: &S,
    project_root: &str,
    target: &str,
    leaf_may_be_missing: bool,
) -> AppResult<String> {
    let root = normalize_remote_path(project_root)?;
    let target = normalize_remote_path(target)?;
    if !path_within_root(&root, &target) {
        return Err(AppError::PathNotAllowed(format!(
            "remote path outside project: {target}"
        )));
    }

    require_safe_dir(stat, &root)?;
    if target == root {
        return Ok(target);
    }

    let rel = target.strip_prefix(&root).unwrap_or("");
    let mut current = root.clone();
    for seg in rel
        .trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
    {
        if current != "/" {
            current.push('/');
        }
        current.push_str(seg);
        let is_leaf = current == target;
        match stat.remote_lstat(&current) {
            Ok(RemoteNodeKind::Symlink) => {
                return Err(AppError::PathNotAllowed(format!(
                    "remote symlink is not allowed: {current}"
                )));
            }
            // An intermediate component must be a real directory. Rejecting a
            // file here (instead of letting a later mkdir/open fail with an
            // opaque SFTP error) keeps the boundary honest and the errors clear.
            Ok(kind) if !is_leaf && kind != RemoteNodeKind::Dir => {
                return Err(AppError::PathNotAllowed(format!(
                    "remote path component is not a directory: {current}"
                )));
            }
            Ok(_) => {}
            Err(_) if leaf_may_be_missing && is_leaf => break,
            Err(err) => return Err(err),
        }
    }
    Ok(target)
}

fn require_safe_dir<S: RemotePathStat>(stat: &S, root: &str) -> AppResult<()> {
    match stat.remote_lstat(root)? {
        RemoteNodeKind::Dir => Ok(()),
        RemoteNodeKind::Symlink => Err(AppError::PathNotAllowed(format!(
            "remote root cannot be a symlink: {root}"
        ))),
        _ => Err(AppError::PathNotAllowed(format!(
            "remote root is not a directory: {root}"
        ))),
    }
}

pub(crate) fn sh_quote(input: &str) -> String {
    if input.is_empty() {
        return "''".into();
    }
    format!("'{}'", input.replace('\'', "'\\''"))
}

pub fn remote_basename(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or(path)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct FakeStat {
        entries: HashMap<String, RemoteNodeKind>,
    }

    impl FakeStat {
        fn new(entries: &[(&str, RemoteNodeKind)]) -> Self {
            Self {
                entries: entries
                    .iter()
                    .map(|(path, kind)| ((*path).to_string(), *kind))
                    .collect(),
            }
        }
    }

    impl RemotePathStat for FakeStat {
        fn remote_lstat(&self, path: &str) -> AppResult<RemoteNodeKind> {
            self.entries
                .get(path)
                .copied()
                .ok_or_else(|| AppError::NotFound(format!("remote stat {path}")))
        }
    }

    #[test]
    fn normalize_rejects_parent_segments() {
        let err = normalize_remote_path("/srv/app/../secret").unwrap_err();
        assert!(matches!(err, AppError::PathNotAllowed(_)));
    }

    #[test]
    fn ensure_allowed_rejects_symlink_root() {
        let stat = FakeStat::new(&[("/srv/app", RemoteNodeKind::Symlink)]);
        let err = ensure_allowed(&stat, "/srv/app", "/srv/app/file.txt", false).unwrap_err();
        assert!(matches!(err, AppError::PathNotAllowed(_)));
    }

    #[test]
    fn ensure_allowed_rejects_symlink_below_root() {
        let stat = FakeStat::new(&[
            ("/srv/app", RemoteNodeKind::Dir),
            ("/srv/app/link", RemoteNodeKind::Symlink),
        ]);
        let err = ensure_allowed(&stat, "/srv/app", "/srv/app/link/file.txt", false).unwrap_err();
        assert!(matches!(err, AppError::PathNotAllowed(_)));
    }

    #[test]
    fn ensure_allowed_accepts_missing_leaf_when_requested() {
        let stat = FakeStat::new(&[
            ("/srv/app", RemoteNodeKind::Dir),
            ("/srv/app/src", RemoteNodeKind::Dir),
        ]);
        let path = ensure_allowed(&stat, "/srv/app", "/srv/app/src/new.txt", true).unwrap();
        assert_eq!(path, "/srv/app/src/new.txt");
    }

    #[test]
    fn ensure_allowed_rejects_outside_root() {
        let stat = FakeStat::new(&[("/srv/app", RemoteNodeKind::Dir)]);
        let err =
            ensure_allowed(&stat, "/srv/app", "/srv/application/file.txt", false).unwrap_err();
        assert!(matches!(err, AppError::PathNotAllowed(_)));
    }

    #[test]
    fn ensure_allowed_rejects_file_as_intermediate_component() {
        let stat = FakeStat::new(&[
            ("/srv/app", RemoteNodeKind::Dir),
            ("/srv/app/notes.txt", RemoteNodeKind::File),
        ]);
        let err =
            ensure_allowed(&stat, "/srv/app", "/srv/app/notes.txt/child", true).unwrap_err();
        assert!(matches!(err, AppError::PathNotAllowed(_)));
    }

    #[test]
    fn ensure_allowed_accepts_file_as_leaf() {
        let stat = FakeStat::new(&[
            ("/srv/app", RemoteNodeKind::Dir),
            ("/srv/app/notes.txt", RemoteNodeKind::File),
        ]);
        let path = ensure_allowed(&stat, "/srv/app", "/srv/app/notes.txt", false).unwrap();
        assert_eq!(path, "/srv/app/notes.txt");
    }

    #[test]
    fn remote_join_rejects_path_separators_in_name() {
        assert!(remote_join("/srv/app", "a/b").is_err());
        assert!(remote_join("/srv/app", "..").is_err());
        assert!(remote_join("/srv/app", "child").is_ok());
    }
}
