use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::SystemTime;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::projects::ProjectsCache;
use crate::util::paths;

const DEFAULT_TEXT_LIMIT: u64 = 25 * 1024 * 1024; // 25 MiB
const DEFAULT_BYTES_LIMIT: u64 = 50 * 1024 * 1024; // 50 MiB
const ICON_IMAGE_LIMIT: u64 = 16 * 1024 * 1024; // 16 MiB — user-picked project icon

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub mtime_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub size: u64,
    pub mtime_ms: i64,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub mime: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub content: String,
    pub encoding: String,
    pub truncated: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BytesFile {
    pub b64: String,
    pub mime: Option<String>,
    pub truncated: bool,
    pub size: u64,
}

fn require_within_roots(app: &AppHandle, path: &str) -> AppResult<()> {
    let cache = app.state::<Arc<ProjectsCache>>();
    let roots = cache.project_roots();
    if roots.is_empty() {
        return Err(AppError::PathNotAllowed(
            "no project roots registered yet".into(),
        ));
    }
    paths::ensure_within_roots(path, &roots)
}

fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn read_dir(app: &AppHandle, path: &str) -> AppResult<Vec<DirEntry>> {
    require_within_roots(app, path)?;
    let p = Path::new(path);
    let read = fs::read_dir(p).map_err(|e| io_error("read_dir", e))?;

    let mut out: Vec<DirEntry> = Vec::with_capacity(64);
    for entry in read {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // skip unreadable entries; don't fail the whole listing
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let path_s = entry.path().to_string_lossy().to_string();
        // Use symlink_metadata so symlinks report as symlinks (not as the target type)
        let meta = match entry.path().symlink_metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        out.push(DirEntry {
            name,
            path: path_s,
            is_dir: meta.is_dir(),
            is_symlink: meta.file_type().is_symlink(),
            size: meta.len(),
            mtime_ms: mtime_ms(&meta),
        });
    }

    // Folders first, then files; both case-insensitive alphabetical.
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

pub fn stat(app: &AppHandle, path: &str) -> AppResult<FileMeta> {
    require_within_roots(app, path)?;
    let meta = Path::new(path)
        .symlink_metadata()
        .map_err(|e| io_error("stat", e))?;
    Ok(FileMeta {
        size: meta.len(),
        mtime_ms: mtime_ms(&meta),
        is_dir: meta.is_dir(),
        is_symlink: meta.file_type().is_symlink(),
        mime: guess_mime(path),
    })
}

pub fn read_file_text(app: &AppHandle, path: &str, max_bytes: Option<u64>) -> AppResult<TextFile> {
    require_within_roots(app, path)?;
    let limit = max_bytes.unwrap_or(DEFAULT_TEXT_LIMIT);
    let meta = Path::new(path)
        .metadata()
        .map_err(|e| io_error("read_file_text", e))?;
    let truncated = meta.len() > limit;
    let bytes = if truncated {
        let mut f = fs::File::open(path).map_err(|e| io_error("open", e))?;
        let mut buf = vec![0u8; limit as usize];
        use std::io::Read;
        let n = f.read(&mut buf).map_err(|e| io_error("read", e))?;
        buf.truncate(n);
        buf
    } else {
        fs::read(path).map_err(|e| io_error("read", e))?
    };
    let (content, encoding) = match String::from_utf8(bytes.clone()) {
        Ok(s) => (s, "utf-8".to_string()),
        Err(_) => (String::from_utf8_lossy(&bytes).into_owned(), "lossy".to_string()),
    };
    Ok(TextFile {
        content,
        encoding,
        truncated,
        size: meta.len(),
    })
}

pub fn read_file_bytes(
    app: &AppHandle,
    path: &str,
    max_bytes: Option<u64>,
) -> AppResult<BytesFile> {
    require_within_roots(app, path)?;
    let limit = max_bytes.unwrap_or(DEFAULT_BYTES_LIMIT);
    let meta = Path::new(path)
        .metadata()
        .map_err(|e| io_error("read_file_bytes", e))?;
    let truncated = meta.len() > limit;
    let bytes = if truncated {
        let mut f = fs::File::open(path).map_err(|e| io_error("open", e))?;
        let mut buf = vec![0u8; limit as usize];
        use std::io::Read;
        let n = f.read(&mut buf).map_err(|e| io_error("read", e))?;
        buf.truncate(n);
        buf
    } else {
        fs::read(path).map_err(|e| io_error("read", e))?
    };
    Ok(BytesFile {
        b64: STANDARD.encode(&bytes),
        mime: guess_mime(path),
        truncated,
        size: meta.len(),
    })
}

/// Read an image the user explicitly picked (via the native file dialog) to use
/// as a project icon, returning it base64-encoded for the frontend to downscale.
///
/// SECURITY: unlike every other fs command here, this deliberately does NOT call
/// `require_within_roots`. A chosen icon almost always lives outside the
/// registered project roots, and the native OS file dialog is the user's consent
/// boundary. The exception is kept narrow: extension allowlist + size cap.
pub fn read_icon_image(path: &str) -> AppResult<BytesFile> {
    const ICON_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"];
    let ext_ok = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .map(|e| ICON_EXTS.contains(&e.as_str()))
        .unwrap_or(false);
    if !ext_ok {
        return Err(AppError::Other(format!(
            "unsupported icon image type: {path:?}"
        )));
    }
    let meta = Path::new(path)
        .metadata()
        .map_err(|e| io_error("read_icon_image", e))?;
    if meta.len() > ICON_IMAGE_LIMIT {
        return Err(AppError::Other(format!(
            "icon image too large: {} bytes (max {ICON_IMAGE_LIMIT})",
            meta.len()
        )));
    }
    let bytes = fs::read(path).map_err(|e| io_error("read_icon_image", e))?;
    Ok(BytesFile {
        b64: STANDARD.encode(&bytes),
        mime: guess_mime(path),
        truncated: false,
        size: meta.len(),
    })
}

/// Permanently delete a file or directory (recursive for directories).
///
/// Safety:
///  - target must sit within a registered project root
///  - refuses to delete a project root itself (a normalized exact match)
///  - refuses symlinks at the top level (so we never traverse outside the sandbox)
pub fn delete_path(app: &AppHandle, path: &str) -> AppResult<()> {
    require_within_roots(app, path)?;

    let target = Path::new(path);
    let normalized = paths::normalize(target);

    // Refuse to nuke a project root.
    let cache = app.state::<Arc<ProjectsCache>>();
    let roots = cache.project_roots();
    if roots
        .iter()
        .any(|r| paths::normalize(Path::new(r)) == normalized)
    {
        return Err(AppError::PathNotAllowed(format!(
            "refusing to delete project root: {path}"
        )));
    }

    let meta = target
        .symlink_metadata()
        .map_err(|e| io_error("delete: stat", e))?;

    if meta.file_type().is_symlink() {
        // Treat symlinks themselves as files — never follow.
        fs::remove_file(target).map_err(|e| io_error("delete: remove_file (symlink)", e))?;
    } else if meta.is_dir() {
        fs::remove_dir_all(target).map_err(|e| io_error("delete: remove_dir_all", e))?;
    } else {
        fs::remove_file(target).map_err(|e| io_error("delete: remove_file", e))?;
    }
    Ok(())
}

/// Rename within the same parent directory. `new_name` is a basename, not a path.
///
/// Safety:
///  - `from` must sit within a registered project root
///  - `new_name` cannot contain path separators, cannot be `.` / `..`, cannot be empty
///  - destination must not already exist (prevents accidental clobber)
///  - refuses to rename a project root itself
pub fn rename_path(app: &AppHandle, from: &str, new_name: &str) -> AppResult<String> {
    require_within_roots(app, from)?;

    if new_name.is_empty()
        || new_name == "."
        || new_name == ".."
        || new_name.contains('/')
        || new_name.contains('\\')
        || new_name.contains('\0')
    {
        return Err(AppError::Other(format!(
            "invalid name: {new_name:?} (must be a non-empty basename without separators)"
        )));
    }

    let from_path = Path::new(from);
    let normalized_from = paths::normalize(from_path);

    let cache = app.state::<Arc<ProjectsCache>>();
    let roots = cache.project_roots();
    if roots
        .iter()
        .any(|r| paths::normalize(Path::new(r)) == normalized_from)
    {
        return Err(AppError::PathNotAllowed(format!(
            "refusing to rename project root: {from}"
        )));
    }

    let parent = from_path.parent().ok_or_else(|| {
        AppError::Other(format!("cannot rename top-level path without parent: {from}"))
    })?;
    let to_path = parent.join(new_name);

    // The new path must still sit inside a project root (it will, by construction,
    // but the check guards against bugs / odd `new_name` inputs that slip the
    // earlier validation).
    let to_str = to_path.to_string_lossy().to_string();
    require_within_roots(app, &to_str)?;

    if to_path.symlink_metadata().is_ok() {
        return Err(AppError::Other(format!(
            "destination already exists: {to_str}"
        )));
    }

    fs::rename(from_path, &to_path).map_err(|e| io_error("rename", e))?;
    Ok(to_str)
}

/// Validate a user-supplied name component used for create/rename.
/// Allows nested segments (`a/b/c`) for create, but rejects traversal and
/// absolute/empty inputs.
fn validate_relative_name(name: &str, allow_nested: bool) -> AppResult<()> {
    if name.is_empty() || name == "." || name == ".." {
        return Err(AppError::Other(format!("invalid name: {name:?}")));
    }
    if name.contains('\0') || name.starts_with('/') || name.starts_with('\\') {
        return Err(AppError::Other(format!("invalid name: {name:?}")));
    }
    if !allow_nested && (name.contains('/') || name.contains('\\')) {
        return Err(AppError::Other(format!(
            "invalid name (no separators allowed): {name:?}"
        )));
    }
    // Reject any `..` traversal segment even in nested mode.
    for seg in name.split(['/', '\\']) {
        if seg == ".." || seg == "." {
            return Err(AppError::Other(format!(
                "invalid name (traversal not allowed): {name:?}"
            )));
        }
    }
    Ok(())
}

/// Create an empty file `name` inside `parent`. `name` may be nested
/// (`sub/dir/file.txt`) — intermediate directories are created. Refuses to
/// overwrite an existing path. Returns the new absolute path.
pub fn create_file(app: &AppHandle, parent: &str, name: &str) -> AppResult<String> {
    require_within_roots(app, parent)?;
    validate_relative_name(name, true)?;

    let target = Path::new(parent).join(name);
    let target_str = target.to_string_lossy().to_string();
    require_within_roots(app, &target_str)?;

    if target.symlink_metadata().is_ok() {
        return Err(AppError::Other(format!(
            "already exists: {target_str}"
        )));
    }
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir).map_err(|e| io_error("create_file: mkdir parents", e))?;
    }
    // Create exclusively so a race can't clobber an existing file.
    use std::fs::OpenOptions;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|e| io_error("create_file", e))?;
    Ok(target_str)
}

/// Create directory `name` inside `parent`. `name` may be nested.
/// Refuses if the leaf directory already exists. Returns the new absolute path.
pub fn create_dir(app: &AppHandle, parent: &str, name: &str) -> AppResult<String> {
    require_within_roots(app, parent)?;
    validate_relative_name(name, true)?;

    let target = Path::new(parent).join(name);
    let target_str = target.to_string_lossy().to_string();
    require_within_roots(app, &target_str)?;

    if target.symlink_metadata().is_ok() {
        return Err(AppError::Other(format!(
            "already exists: {target_str}"
        )));
    }
    fs::create_dir_all(&target).map_err(|e| io_error("create_dir", e))?;
    Ok(target_str)
}

/// Move `from` into directory `to_dir`, preserving the basename.
/// Returns the new absolute path.
///
/// Safety:
///  - both `from` and the destination must sit within registered roots
///  - refuses to move a project root
///  - refuses to move a directory into itself or one of its own descendants
///  - refuses a no-op (already inside `to_dir`)
///  - refuses if the destination path already exists
pub fn move_path(app: &AppHandle, from: &str, to_dir: &str) -> AppResult<String> {
    require_within_roots(app, from)?;
    require_within_roots(app, to_dir)?;

    let from_path = Path::new(from);
    let normalized_from = paths::normalize(from_path);

    let cache = app.state::<Arc<ProjectsCache>>();
    let roots = cache.project_roots();
    if roots
        .iter()
        .any(|r| paths::normalize(Path::new(r)) == normalized_from)
    {
        return Err(AppError::PathNotAllowed(format!(
            "refusing to move project root: {from}"
        )));
    }

    let base = from_path
        .file_name()
        .ok_or_else(|| AppError::Other(format!("cannot move path without a name: {from}")))?;
    let to_dir_path = Path::new(to_dir);
    let normalized_to_dir = paths::normalize(to_dir_path);

    // No-op: already directly inside the target dir.
    if normalized_from.parent() == Some(normalized_to_dir.as_path()) {
        return Err(AppError::Other(
            "item is already in the destination folder".into(),
        ));
    }
    // Circular: moving a directory into itself or a descendant.
    if normalized_to_dir == normalized_from
        || normalized_to_dir.starts_with(&normalized_from)
    {
        return Err(AppError::Other(
            "cannot move a folder into itself or its own subfolder".into(),
        ));
    }

    let dest = to_dir_path.join(base);
    let dest_str = dest.to_string_lossy().to_string();
    require_within_roots(app, &dest_str)?;

    if dest.symlink_metadata().is_ok() {
        return Err(AppError::Other(format!(
            "destination already exists: {dest_str}"
        )));
    }

    // The destination dir must actually be a directory.
    match to_dir_path.symlink_metadata() {
        Ok(m) if m.is_dir() => {}
        Ok(_) => {
            return Err(AppError::Other(format!(
                "destination is not a folder: {to_dir}"
            )))
        }
        Err(e) => return Err(io_error("move: stat dest dir", e)),
    }

    fs::rename(from_path, &dest).map_err(|e| io_error("move", e))?;
    Ok(dest_str)
}

/// Atomic write: write to <path>.tmp, then rename over the target.
pub fn write_file_text(app: &AppHandle, path: &str, content: &str) -> AppResult<()> {
    require_within_roots(app, path)?;
    let p = Path::new(path);
    let tmp = p.with_extension(format!(
        "{}.metacodex.tmp",
        p.extension().and_then(|s| s.to_str()).unwrap_or("")
    ));
    fs::write(&tmp, content.as_bytes()).map_err(|e| io_error("write tmp", e))?;
    fs::rename(&tmp, p).map_err(|e| {
        // best-effort cleanup
        let _ = fs::remove_file(&tmp);
        io_error("rename", e)
    })?;
    Ok(())
}

fn guess_mime(path: &str) -> Option<String> {
    let ext = Path::new(path)
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

fn io_error(ctx: &str, e: std::io::Error) -> AppError {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::NotFound => AppError::NotFound(format!("{ctx}: {e}")),
        ErrorKind::PermissionDenied => AppError::PermissionDenied(format!("{ctx}: {e}")),
        _ => AppError::Io(e),
    }
}
