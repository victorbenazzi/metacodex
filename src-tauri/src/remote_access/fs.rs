use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use ssh2::{FileStat, OpenFlags, OpenType, Sftp};

use crate::error::{AppError, AppResult};
use crate::fs_ops::{self, BytesFile, DirEntry, FileMeta, TextFile};

use super::paths::{
    ensure_allowed, normalize_remote_path, path_within_root, remote_basename, remote_join,
};
use super::session::with_sftp;
use super::types::RemoteProjectCandidate;
use super::{ssh_error, DEFAULT_BYTES_LIMIT, DEFAULT_TEXT_LIMIT};

pub fn ensure_project_path(access_id: &str, project_root: &str, path: &str) -> AppResult<String> {
    with_sftp(access_id, |_access, sftp| {
        ensure_allowed(sftp, project_root, path, false)
    })
}

fn mtime_ms(stat: &FileStat) -> i64 {
    stat.mtime.map(|s| (s as i64) * 1000).unwrap_or(0)
}

fn file_size(stat: &FileStat) -> u64 {
    stat.size.unwrap_or(0)
}

fn file_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|s| s.to_str())
        .filter(|s| *s != "." && *s != "..")
        .map(|s| s.to_string())
}

pub fn read_dir(access_id: &str, project_root: &str, path: &str) -> AppResult<Vec<DirEntry>> {
    with_sftp(access_id, |_access, sftp| {
        let target = ensure_allowed(sftp, project_root, path, false)?;
        let entries = sftp
            .readdir(Path::new(&target))
            .map_err(|e| ssh_error("sftp readdir", e))?;
        let mut out = Vec::with_capacity(entries.len());
        for (entry_path, stat) in entries {
            let Some(name) = file_name(&entry_path) else {
                continue;
            };
            let path = normalize_remote_path(&entry_path.to_string_lossy())?;
            let file_type = stat.file_type();
            out.push(DirEntry {
                name,
                path,
                is_dir: file_type.is_dir(),
                is_symlink: file_type.is_symlink(),
                size: file_size(&stat),
                mtime_ms: mtime_ms(&stat),
            });
        }
        fs_ops::sort_dir_entries(&mut out);
        Ok(out)
    })
}

pub fn stat(access_id: &str, project_root: &str, path: &str) -> AppResult<FileMeta> {
    with_sftp(access_id, |_access, sftp| {
        let target = ensure_allowed(sftp, project_root, path, false)?;
        let stat = sftp
            .lstat(Path::new(&target))
            .map_err(|e| ssh_error("sftp stat", e))?;
        let file_type = stat.file_type();
        Ok(FileMeta {
            size: file_size(&stat),
            mtime_ms: mtime_ms(&stat),
            is_dir: file_type.is_dir(),
            is_symlink: file_type.is_symlink(),
            mime: fs_ops::guess_mime(&target),
        })
    })
}

fn read_capped(
    sftp: &Sftp,
    target: &str,
    max_bytes: Option<u64>,
    default_limit: u64,
) -> AppResult<(Vec<u8>, bool, u64)> {
    let stat = sftp
        .stat(Path::new(target))
        .map_err(|e| ssh_error("sftp stat", e))?;
    let size = file_size(&stat);
    let limit = max_bytes.unwrap_or(default_limit);
    let truncated = size > limit;
    let mut file = sftp
        .open(Path::new(target))
        .map_err(|e| ssh_error("sftp open", e))?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(limit)
        .read_to_end(&mut bytes)
        .map_err(|e| AppError::Other(format!("sftp read: {e}")))?;
    Ok((bytes, truncated, size))
}

pub fn read_file_text(
    access_id: &str,
    project_root: &str,
    path: &str,
    max_bytes: Option<u64>,
) -> AppResult<TextFile> {
    with_sftp(access_id, |_access, sftp| {
        let target = ensure_allowed(sftp, project_root, path, false)?;
        let (bytes, truncated, size) = read_capped(sftp, &target, max_bytes, DEFAULT_TEXT_LIMIT)?;
        let (content, encoding) = match String::from_utf8(bytes) {
            Ok(s) => (s, "utf-8".to_string()),
            Err(e) => (
                String::from_utf8_lossy(e.as_bytes()).into_owned(),
                "lossy".to_string(),
            ),
        };
        Ok(TextFile {
            content,
            encoding,
            truncated,
            size,
        })
    })
}

pub fn read_file_bytes(
    access_id: &str,
    project_root: &str,
    path: &str,
    max_bytes: Option<u64>,
) -> AppResult<BytesFile> {
    with_sftp(access_id, |_access, sftp| {
        let target = ensure_allowed(sftp, project_root, path, false)?;
        let (bytes, truncated, size) = read_capped(sftp, &target, max_bytes, DEFAULT_BYTES_LIMIT)?;
        Ok(BytesFile {
            b64: STANDARD.encode(bytes),
            mime: fs_ops::guess_mime(&target),
            truncated,
            size,
        })
    })
}

/// Mode (permission bits) to give a freshly written file: preserve the target's
/// existing bits so editing a `600` secret or a `755` script does not silently
/// widen or narrow its permissions; fall back to `644` for brand-new files.
fn write_mode(sftp: &Sftp, target: &str) -> i32 {
    sftp.stat(Path::new(target))
        .ok()
        .and_then(|s| s.perm)
        .map(|perm| (perm & 0o7777) as i32)
        .unwrap_or(0o644)
}

pub fn write_file_text(
    access_id: &str,
    project_root: &str,
    path: &str,
    content: &str,
) -> AppResult<()> {
    with_sftp(access_id, |_access, sftp| {
        let target = ensure_allowed(sftp, project_root, path, true)?;
        let mode = write_mode(sftp, &target);
        let tmp = format!("{target}.metacodex.tmp.{}", uuid::Uuid::new_v4().simple());
        {
            let mut file = sftp
                .open_mode(
                    Path::new(&tmp),
                    OpenFlags::CREATE | OpenFlags::EXCLUSIVE | OpenFlags::WRITE,
                    mode,
                    OpenType::File,
                )
                .map_err(|e| ssh_error("sftp write tmp", e))?;
            file.write_all(content.as_bytes())
                .map_err(|e| AppError::Other(format!("sftp write: {e}")))?;
        }
        if let Err(err) = sftp.rename(Path::new(&tmp), Path::new(&target), None) {
            let _ = sftp.unlink(Path::new(&tmp));
            return Err(ssh_error("sftp rename", err));
        }
        Ok(())
    })
}

pub fn create_file(
    access_id: &str,
    project_root: &str,
    parent: &str,
    name: &str,
) -> AppResult<String> {
    with_sftp(access_id, |_access, sftp| {
        let parent = ensure_allowed(sftp, project_root, parent, false)?;
        let target = remote_join(&parent, name)?;
        ensure_allowed(sftp, project_root, &target, true)?;
        sftp.open_mode(
            Path::new(&target),
            OpenFlags::CREATE | OpenFlags::EXCLUSIVE | OpenFlags::WRITE,
            0o644,
            OpenType::File,
        )
        .map_err(|e| ssh_error("sftp create file", e))?;
        Ok(target)
    })
}

pub fn create_dir(
    access_id: &str,
    project_root: &str,
    parent: &str,
    name: &str,
) -> AppResult<String> {
    with_sftp(access_id, |_access, sftp| {
        let parent = ensure_allowed(sftp, project_root, parent, false)?;
        let target = remote_join(&parent, name)?;
        ensure_allowed(sftp, project_root, &target, true)?;
        sftp.mkdir(Path::new(&target), 0o755)
            .map_err(|e| ssh_error("sftp create dir", e))?;
        Ok(target)
    })
}

pub fn discover_projects(access_id: &str) -> AppResult<Vec<RemoteProjectCandidate>> {
    with_sftp(access_id, |access, sftp| {
        let mut out = Vec::new();
        for root in &access.root_paths {
            let root = normalize_remote_path(root)?;
            let root = match ensure_allowed(sftp, &root, &root, false) {
                Ok(root) => root,
                Err(_) => continue,
            };
            let root_markers = detect_markers(sftp, &root);
            if !root_markers.is_empty() {
                out.push(RemoteProjectCandidate {
                    name: remote_basename(&root),
                    path: root.clone(),
                    markers: root_markers,
                });
            }
            let entries = match sftp.readdir(Path::new(&root)) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for (entry_path, stat) in entries {
                if out.len() >= 500 {
                    break;
                }
                if !stat.file_type().is_dir() || stat.file_type().is_symlink() {
                    continue;
                }
                let path = normalize_remote_path(&entry_path.to_string_lossy())?;
                if !path_within_root(&root, &path) {
                    continue;
                }
                if ensure_allowed(sftp, &root, &path, false).is_err() {
                    continue;
                }
                out.push(RemoteProjectCandidate {
                    name: remote_basename(&path),
                    path: path.clone(),
                    markers: detect_markers(sftp, &path),
                });
            }
        }
        out.sort_by_key(|candidate| candidate.path.to_lowercase());
        out.dedup_by(|a, b| a.path == b.path);
        Ok(out)
    })
}

const PROJECT_MARKERS: &[&str] = &[
    ".git",
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
    "deno.json",
    "bun.lockb",
    "composer.json",
];

/// One `readdir` and a set intersection instead of one `lstat` per marker: on a
/// high-latency link this turns each candidate from 10 round-trips into 1.
fn detect_markers(sftp: &Sftp, path: &str) -> Vec<String> {
    let names: HashSet<String> = match sftp.readdir(Path::new(path)) {
        Ok(entries) => entries
            .into_iter()
            .filter_map(|(entry_path, _)| file_name(&entry_path))
            .collect(),
        Err(_) => return Vec::new(),
    };
    PROJECT_MARKERS
        .iter()
        .filter(|marker| names.contains(**marker))
        .map(|s| (*s).to_string())
        .collect()
}

pub fn validate_project_candidates(access_id: &str, paths: &[String]) -> AppResult<Vec<String>> {
    with_sftp(access_id, |access, sftp| {
        let mut safe_paths = Vec::with_capacity(paths.len());
        for path in paths {
            let target = normalize_remote_path(path)?;
            let Some(root) = access
                .root_paths
                .iter()
                .find(|root| path_within_root(root, &target))
                .cloned()
            else {
                return Err(AppError::PathNotAllowed(format!(
                    "remote project is outside configured access roots: {target}"
                )));
            };
            ensure_allowed(sftp, &root, &target, false)?;
            let stat = sftp
                .lstat(Path::new(&target))
                .map_err(|e| ssh_error("sftp stat", e))?;
            if !stat.file_type().is_dir() || stat.file_type().is_symlink() {
                return Err(AppError::PathNotAllowed(format!(
                    "remote project is not a safe directory: {target}"
                )));
            }
            if !safe_paths.contains(&target) {
                safe_paths.push(target);
            }
        }
        Ok(safe_paths)
    })
}
