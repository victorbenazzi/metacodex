use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::SystemTime;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::projects::ProjectsCache;

const DEFAULT_TEXT_LIMIT: u64 = 25 * 1024 * 1024; // 25 MiB
const DEFAULT_BYTES_LIMIT: u64 = 50 * 1024 * 1024; // 50 MiB
const ICON_IMAGE_LIMIT: u64 = 16 * 1024 * 1024; // 16 MiB, user-picked project icon

/// Extensions the preview mode may open from OUTSIDE any registered project root.
/// Read side: text/code/markdown. Kept broad because preview is a viewer, but every
/// entry is a format the editor actually renders.
pub(crate) const PREVIEW_TEXT_EXTS: &[&str] = &[
    "md", "markdown", "mdx", "txt", "text", "log", "rst", "adoc", "json", "jsonc", "toml", "yaml",
    "yml", "ini", "conf", "env", "csv", "tsv", "xml", "html", "htm", "css", "scss", "sass", "less",
    "js", "mjs", "cjs", "jsx", "ts", "tsx", "vue", "svelte", "py", "rs", "go", "rb", "php", "java",
    "kt", "swift", "c", "h", "cpp", "hpp", "cc", "cs", "sh", "bash", "zsh", "fish", "sql", "graphql",
    "gql", "lua", "r", "dart", "scala", "clj", "ex", "exs", "erl", "hs", "ml",
];

/// Read side for binary previews (image/pdf). These are never writable.
pub(crate) const PREVIEW_BINARY_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "pdf",
];

fn ext_lower(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
}

fn preview_ext_allowed(path: &str, set: &[&str]) -> bool {
    ext_lower(path)
        .map(|e| set.contains(&e.as_str()))
        .unwrap_or(false)
}

/// Union of the text + binary preview allowlists. Used to filter OS-opened files
/// (Finder "Open With" / drag-drop) before they ever reach the UI.
pub(crate) fn preview_ext_allowed_any(path: &str) -> bool {
    preview_ext_allowed(path, PREVIEW_TEXT_EXTS) || preview_ext_allowed(path, PREVIEW_BINARY_EXTS)
}

pub(crate) fn preview_extensions() -> Vec<&'static str> {
    let mut out = Vec::with_capacity(PREVIEW_TEXT_EXTS.len() + PREVIEW_BINARY_EXTS.len());
    out.extend_from_slice(PREVIEW_TEXT_EXTS);
    out.extend_from_slice(PREVIEW_BINARY_EXTS);
    out.sort_unstable();
    out.dedup();
    out
}

pub(crate) const ICON_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"];

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
    app.state::<Arc<ProjectsCache>>()
        .require_within_project_roots(path)
}

fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Read up to `limit` bytes of `path`, reporting whether it was truncated and the
/// full on-disk size. Shared by the roots-checked and preview read commands.
fn read_capped(path: &str, ctx: &'static str, limit: u64) -> AppResult<(Vec<u8>, bool, u64)> {
    let meta = Path::new(path).metadata().map_err(|e| io_error(ctx, e))?;
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
    Ok((bytes, truncated, meta.len()))
}

fn bytes_to_text(bytes: Vec<u8>, truncated: bool, size: u64) -> TextFile {
    let (content, encoding) = match String::from_utf8(bytes) {
        Ok(s) => (s, "utf-8".to_string()),
        Err(e) => (
            String::from_utf8_lossy(e.as_bytes()).into_owned(),
            "lossy".to_string(),
        ),
    };
    TextFile {
        content,
        encoding,
        truncated,
        size,
    }
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
    let (bytes, truncated, size) = read_capped(path, "read_file_text", limit)?;
    Ok(bytes_to_text(bytes, truncated, size))
}

pub fn read_file_bytes(
    app: &AppHandle,
    path: &str,
    max_bytes: Option<u64>,
) -> AppResult<BytesFile> {
    require_within_roots(app, path)?;
    let limit = max_bytes.unwrap_or(DEFAULT_BYTES_LIMIT);
    let (bytes, truncated, size) = read_capped(path, "read_file_bytes", limit)?;
    Ok(BytesFile {
        b64: STANDARD.encode(&bytes),
        mime: guess_mime(path),
        truncated,
        size,
    })
}

/// Read a user-opened preview file as text.
///
/// SECURITY: like `read_project_icon_image`, this deliberately does NOT call
/// `require_within_roots`. A previewed file is, by definition, opened from outside
/// any registered project root, and the backend-issued grant is the user's consent boundary.
/// The exception stays narrow: a text/code/markdown extension allowlist + the same
/// 25 MiB cap as `read_file_text`.
pub fn read_preview_text(path: &str, max_bytes: Option<u64>) -> AppResult<TextFile> {
    if !preview_ext_allowed(path, PREVIEW_TEXT_EXTS) {
        return Err(AppError::Other(format!(
            "unsupported preview text type: {path:?}"
        )));
    }
    let limit = max_bytes.unwrap_or(DEFAULT_TEXT_LIMIT);
    let (bytes, truncated, size) = read_capped(path, "read_preview_text", limit)?;
    Ok(bytes_to_text(bytes, truncated, size))
}

/// Read a user-opened preview file as base64 bytes (image/pdf preview).
///
/// SECURITY: same carve-out as `read_preview_text`; allowlist = image/pdf, cap = 50 MiB.
pub fn read_preview_bytes(path: &str, max_bytes: Option<u64>) -> AppResult<BytesFile> {
    if !preview_ext_allowed(path, PREVIEW_BINARY_EXTS) {
        return Err(AppError::Other(format!(
            "unsupported preview binary type: {path:?}"
        )));
    }
    let limit = max_bytes.unwrap_or(DEFAULT_BYTES_LIMIT);
    let (bytes, truncated, size) = read_capped(path, "read_preview_bytes", limit)?;
    Ok(BytesFile {
        b64: STANDARD.encode(&bytes),
        mime: guess_mime(path),
        truncated,
        size,
    })
}

/// Read an image the user explicitly picked through the native file dialog to use
/// as a project icon, returning it base64-encoded for the frontend to downscale.
///
/// SECURITY: unlike every other fs command here, this deliberately does NOT call
/// `require_within_roots`. A chosen icon almost always lives outside the
/// registered project roots, and the native OS file dialog is the user's consent
/// boundary. The exception is kept narrow: extension allowlist + size cap.
pub fn read_project_icon_image(path: &str) -> AppResult<BytesFile> {
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
        .map_err(|e| io_error("read_project_icon_image", e))?;
    if meta.len() > ICON_IMAGE_LIMIT {
        return Err(AppError::Other(format!(
            "icon image too large: {} bytes (max {ICON_IMAGE_LIMIT})",
            meta.len()
        )));
    }
    let bytes = fs::read(path).map_err(|e| io_error("read_project_icon_image", e))?;
    Ok(BytesFile {
        b64: STANDARD.encode(&bytes),
        mime: guess_mime(path),
        truncated: false,
        size: meta.len(),
    })
}

/// Validate a user-supplied name component used for create commands.
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
/// (`sub/dir/file.txt`) , intermediate directories are created. Refuses to
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

fn is_cross_device(e: &std::io::Error) -> bool {
    // We match raw OS codes rather than `ErrorKind::CrossesDevices`, which
    // isn't stable on all toolchains. EXDEV = 18 on macOS/Linux;
    // ERROR_NOT_SAME_DEVICE = 17 on Windows.
    #[cfg(unix)]
    {
        e.raw_os_error() == Some(18)
    }
    #[cfg(windows)]
    {
        e.raw_os_error() == Some(17)
    }
}

/// Move a file, falling back to copy + remove when `from` and `to` live on
/// different volumes (`rename` returns EXDEV across mounts , a previewed file may
/// sit on an external drive while the project is on the internal disk).
fn move_file_cross_device(from: &Path, to: &Path) -> AppResult<()> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if is_cross_device(&e) => {
            fs::copy(from, to).map_err(|e| io_error("move: copy (cross-device)", e))?;
            fs::remove_file(from).map_err(|e| {
                // Don't leave a half-move behind.
                let _ = fs::remove_file(to);
                io_error("move: remove src (cross-device)", e)
            })
        }
        Err(e) => Err(io_error("move", e)),
    }
}

fn ensure_is_dir(path: &Path, ctx: &str) -> AppResult<()> {
    match path.symlink_metadata() {
        Ok(m) if m.is_dir() => Ok(()),
        Ok(_) => Err(AppError::Other(format!(
            "{ctx}: not a folder: {}",
            path.display()
        ))),
        Err(e) => Err(io_error(ctx, e)),
    }
}

/// Move a user-opened preview file (`from`, outside any project root) INTO a
/// project directory (`to_dir`, which MUST be within a registered root).
/// Returns the new absolute path.
///
/// SECURITY: `from` is NOT roots-checked , it is a previewed file whose consent
/// boundary is the OS open action (same as `read_preview_*`). It is still validated
/// against the preview extension allowlist so this can't be repurposed to import
/// arbitrary files. `to_dir` IS fully roots-checked, so the file can only ever land
/// inside a registered project. Refuse-on-conflict; cross-volume safe.
pub fn move_into_project(app: &AppHandle, from: &str, to_dir: &str) -> AppResult<String> {
    if !preview_ext_allowed_any(from) {
        return Err(AppError::Other(format!("unsupported preview type: {from:?}")));
    }
    require_within_roots(app, to_dir)?;

    let from_path = Path::new(from);
    let to_dir_path = Path::new(to_dir);
    ensure_is_dir(to_dir_path, "move_into_project: dest dir")?;

    let base = from_path
        .file_name()
        .ok_or_else(|| AppError::Other(format!("cannot move path without a name: {from}")))?;
    let dest = to_dir_path.join(base);
    let dest_str = dest.to_string_lossy().to_string();
    require_within_roots(app, &dest_str)?;

    if dest.symlink_metadata().is_ok() {
        return Err(AppError::Other(format!(
            "destination already exists: {dest_str}"
        )));
    }

    move_file_cross_device(from_path, &dest)?;
    Ok(dest_str)
}

/// Atomic write primitive: write to `<path>.<ext>.metacodex.tmp`, then rename over
/// the target. The tmp lands next to the target (same volume) so the rename is atomic.
///
/// Windows: AV / OneDrive / Defender briefly hold handles on the destination during
/// scans; a single `rename` can hit `ERROR_SHARING_VIOLATION`. We retry twice with
/// short backoff before surfacing the error.
fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let tmp = path.with_extension(format!(
        "{}.metacodex.tmp",
        path.extension().and_then(|s| s.to_str()).unwrap_or("")
    ));
    fs::write(&tmp, bytes).map_err(|e| io_error("write tmp", e))?;
    let mut last_err: Option<std::io::Error> = None;
    for attempt in 0..3 {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                if attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_millis(50 * (attempt + 1)));
                }
            }
        }
    }
    let _ = fs::remove_file(&tmp);
    Err(io_error("rename", last_err.expect("retry loop ran")))
}

/// Atomic write: write to <path>.tmp, then rename over the target.
pub fn write_file_text(app: &AppHandle, path: &str, content: &str) -> AppResult<()> {
    require_within_roots(app, path)?;
    atomic_write(Path::new(path), content.as_bytes())
}

/// Atomically overwrite a user-opened preview file in place (edit + save).
///
/// SECURITY: same carve-out as `read_preview_text`, WRITE variant. Restricted to the
/// text/code allowlist only , we never write binary/image/pdf previews back, so the
/// writable surface is strictly the text set.
pub fn write_preview_text(path: &str, content: &str) -> AppResult<()> {
    if !preview_ext_allowed(path, PREVIEW_TEXT_EXTS) {
        return Err(AppError::Other(format!(
            "unsupported preview text type: {path:?}"
        )));
    }
    // SECURITY: a preview write only ever saves a file the user already opened
    // (and thus consented to). The path is a webview-supplied string, so we must
    // NOT let it create new files or follow symlinks: require an existing, regular
    // file in place. This closes the "write an arbitrary new hook.sh" escalation
    // and the in-tree-symlink-escapes-the-sandbox case in one check.
    let meta = Path::new(path)
        .symlink_metadata()
        .map_err(|e| io_error("write_preview_text", e))?;
    if !meta.file_type().is_file() {
        return Err(AppError::PathNotAllowed(format!(
            "preview write target is not a regular file: {path:?}"
        )));
    }
    atomic_write(Path::new(path), content.as_bytes())
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
