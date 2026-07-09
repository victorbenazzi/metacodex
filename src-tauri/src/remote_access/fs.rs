use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use ssh2::{FileStat, OpenFlags, OpenType, Sftp};

use crate::error::{AppError, AppResult};
use crate::fs_ops::{BytesFile, DirEntry, FileMeta, TextFile};

use super::paths::{
    ensure_allowed, normalize_remote_path, path_within_root, remote_basename, remote_join,
};
use super::ssh::{connect_access, sftp_for_access};
use super::store::get_access;
use super::types::RemoteProjectCandidate;
use super::{ssh_error, DEFAULT_BYTES_LIMIT, DEFAULT_TEXT_LIMIT};

pub fn ensure_project_path(access_id: &str, project_root: &str, path: &str) -> AppResult<String> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    ensure_allowed(&sftp, project_root, path, false)
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
    let (_access, sftp) = sftp_for_access(access_id)?;
    let target = ensure_allowed(&sftp, project_root, path, false)?;
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
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

pub fn stat(access_id: &str, project_root: &str, path: &str) -> AppResult<FileMeta> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let target = ensure_allowed(&sftp, project_root, path, false)?;
    let stat = sftp
        .lstat(Path::new(&target))
        .map_err(|e| ssh_error("sftp stat", e))?;
    let file_type = stat.file_type();
    Ok(FileMeta {
        size: file_size(&stat),
        mtime_ms: mtime_ms(&stat),
        is_dir: file_type.is_dir(),
        is_symlink: file_type.is_symlink(),
        mime: guess_mime(&target),
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
    let (_access, sftp) = sftp_for_access(access_id)?;
    let target = ensure_allowed(&sftp, project_root, path, false)?;
    let (bytes, truncated, size) = read_capped(&sftp, &target, max_bytes, DEFAULT_TEXT_LIMIT)?;
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
}

pub fn read_file_bytes(
    access_id: &str,
    project_root: &str,
    path: &str,
    max_bytes: Option<u64>,
) -> AppResult<BytesFile> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let target = ensure_allowed(&sftp, project_root, path, false)?;
    let (bytes, truncated, size) = read_capped(&sftp, &target, max_bytes, DEFAULT_BYTES_LIMIT)?;
    Ok(BytesFile {
        b64: STANDARD.encode(bytes),
        mime: guess_mime(&target),
        truncated,
        size,
    })
}

fn ensure_parent_dirs(sftp: &Sftp, project_root: &str, path: &str) -> AppResult<()> {
    let root = normalize_remote_path(project_root)?;
    let target = normalize_remote_path(path)?;
    let Some(parent) = target
        .rsplit_once('/')
        .map(|(p, _)| if p.is_empty() { "/" } else { p })
    else {
        return Ok(());
    };
    let parent = normalize_remote_path(parent)?;
    if !path_within_root(&root, &parent) {
        return Err(AppError::PathNotAllowed(format!(
            "remote parent outside project: {parent}"
        )));
    }
    ensure_allowed(sftp, &root, &root, false)?;
    if parent == "/" || parent == root {
        return Ok(());
    }
    let rel = parent
        .strip_prefix(&root)
        .unwrap_or("")
        .trim_start_matches('/');
    let mut current = root.clone();
    for seg in rel.split('/').filter(|s| !s.is_empty()) {
        if current != "/" {
            current.push('/');
        }
        current.push_str(seg);
        match sftp.mkdir(Path::new(&current), 0o755) {
            Ok(()) => {}
            Err(_) => {
                let stat = sftp
                    .lstat(Path::new(&current))
                    .map_err(|e| ssh_error("sftp mkdir stat", e))?;
                if !stat.file_type().is_dir() || stat.file_type().is_symlink() {
                    return Err(AppError::Other(format!(
                        "not a remote directory: {current}"
                    )));
                }
            }
        }
    }
    Ok(())
}

pub fn write_file_text(
    access_id: &str,
    project_root: &str,
    path: &str,
    content: &str,
) -> AppResult<()> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let target = ensure_allowed(&sftp, project_root, path, true)?;
    ensure_parent_dirs(&sftp, project_root, &target)?;
    let tmp = format!("{target}.metacodex.tmp.{}", uuid::Uuid::new_v4().simple());
    {
        let mut file = sftp
            .open_mode(
                Path::new(&tmp),
                OpenFlags::CREATE | OpenFlags::EXCLUSIVE | OpenFlags::WRITE,
                0o644,
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
}

pub fn create_file(
    access_id: &str,
    project_root: &str,
    parent: &str,
    name: &str,
) -> AppResult<String> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let parent = ensure_allowed(&sftp, project_root, parent, false)?;
    let target = remote_join(&parent, name)?;
    ensure_allowed(&sftp, project_root, &target, true)?;
    ensure_parent_dirs(&sftp, project_root, &target)?;
    let _file = sftp
        .open_mode(
            Path::new(&target),
            OpenFlags::CREATE | OpenFlags::EXCLUSIVE | OpenFlags::WRITE,
            0o644,
            OpenType::File,
        )
        .map_err(|e| ssh_error("sftp create file", e))?;
    Ok(target)
}

pub fn create_dir(
    access_id: &str,
    project_root: &str,
    parent: &str,
    name: &str,
) -> AppResult<String> {
    let (_access, sftp) = sftp_for_access(access_id)?;
    let parent = ensure_allowed(&sftp, project_root, parent, false)?;
    let target = remote_join(&parent, name)?;
    ensure_allowed(&sftp, project_root, &target, true)?;
    ensure_parent_dirs(&sftp, project_root, &target)?;
    sftp.mkdir(Path::new(&target), 0o755)
        .map_err(|e| ssh_error("sftp create dir", e))?;
    Ok(target)
}

pub fn discover_projects(access_id: &str) -> AppResult<Vec<RemoteProjectCandidate>> {
    let (access, sftp) = sftp_for_access(access_id)?;
    let mut out = Vec::new();
    for root in &access.root_paths {
        let root = normalize_remote_path(root)?;
        let root = match ensure_allowed(&sftp, &root, &root, false) {
            Ok(root) => root,
            Err(_) => continue,
        };
        let root_markers = detect_markers(&sftp, &root);
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
            if ensure_allowed(&sftp, &root, &path, false).is_err() {
                continue;
            }
            out.push(RemoteProjectCandidate {
                name: remote_basename(&path),
                path: path.clone(),
                markers: detect_markers(&sftp, &path),
            });
        }
    }
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    out.dedup_by(|a, b| a.path == b.path);
    Ok(out)
}

fn detect_markers(sftp: &Sftp, path: &str) -> Vec<String> {
    const MARKERS: &[&str] = &[
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
    MARKERS
        .iter()
        .filter(|marker| {
            let candidate = if path == "/" {
                format!("/{marker}")
            } else {
                format!("{path}/{marker}")
            };
            sftp.lstat(Path::new(&candidate)).is_ok()
        })
        .map(|s| (*s).to_string())
        .collect()
}

pub fn validate_project_candidate(access_id: &str, path: &str) -> AppResult<String> {
    validate_project_candidates(access_id, &[path.to_string()])?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Other("remote project validation returned no path".into()))
}

pub fn validate_project_candidates(access_id: &str, paths: &[String]) -> AppResult<Vec<String>> {
    let access = get_access(access_id)?;
    let session = connect_access(&access)?;
    let sftp = session.sftp().map_err(|e| ssh_error("sftp", e))?;
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
        ensure_allowed(&sftp, &root, &target, false)?;
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
}

fn guess_mime(path: &str) -> Option<String> {
    let ext = PathBuf::from(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())?;
    Some(
        match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "ico" => "image/x-icon",
            "bmp" => "image/bmp",
            "pdf" => "application/pdf",
            "md" | "markdown" => "text/markdown",
            "json" => "application/json",
            "html" => "text/html",
            "css" => "text/css",
            "js" | "mjs" => "text/javascript",
            "ts" | "tsx" => "application/typescript",
            "py" => "text/x-python",
            "rs" => "text/rust",
            "toml" => "text/x-toml",
            "yml" | "yaml" => "text/yaml",
            _ => return None,
        }
        .to_string(),
    )
}
