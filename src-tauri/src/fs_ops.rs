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
