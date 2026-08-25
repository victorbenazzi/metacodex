//! Authenticated local-file responses for the in-app browser webview.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
    sync::Arc,
};

use tauri::{
    http::{
        header::{
            ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
        },
        Method, Request, Response, StatusCode,
    },
    AppHandle, Manager, Url,
};

use crate::error::{AppError, AppResult};

use super::browser::{BrowserState, WEBVIEW_LABEL};

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs" | "cjs") => "text/javascript; charset=utf-8",
        Some("json" | "map") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        Some("pdf") => "application/pdf",
        Some("wasm") => "application/wasm",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("xml") => "application/xml; charset=utf-8",
        Some("txt") => "text/plain; charset=utf-8",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        _ => "application/octet-stream",
    }
}

fn parse_byte_range(value: &str, total: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(spec) = value.strip_prefix("bytes=") else {
        return Err(());
    };
    if total == 0 || spec.contains(',') {
        return Err(());
    }
    let (start, end) = spec.split_once('-').ok_or(())?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        let length = suffix.min(total);
        return Ok(Some((total - length, total - 1)));
    }
    let start = start.parse::<u64>().map_err(|_| ())?;
    if start >= total {
        return Err(());
    }
    let end = if end.is_empty() {
        total - 1
    } else {
        end.parse::<u64>().map_err(|_| ())?.min(total - 1)
    };
    if end < start {
        return Err(());
    }
    Ok(Some((start, end)))
}

fn protocol_error(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(CACHE_CONTROL, "no-store")
        .body(message.as_bytes().to_vec())
        .expect("static browser protocol response")
}

fn read_file_slice(path: &Path, start: u64, end: u64) -> AppResult<Vec<u8>> {
    let length = end
        .checked_sub(start)
        .and_then(|value| value.checked_add(1))
        .ok_or_else(|| AppError::FileTooLarge(path.display().to_string()))?;
    let length =
        usize::try_from(length).map_err(|_| AppError::FileTooLarge(path.display().to_string()))?;
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut data = vec![0; length];
    file.read_exact(&mut data)?;
    Ok(data)
}

pub(crate) fn response(
    app: &AppHandle,
    webview_label: &str,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if webview_label != WEBVIEW_LABEL {
        return protocol_error(StatusCode::FORBIDDEN, "browser file access denied");
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return protocol_error(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }
    let Ok(url) = Url::parse(&request.uri().to_string()) else {
        return protocol_error(StatusCode::BAD_REQUEST, "invalid browser file URL");
    };
    let Some(state) = app.try_state::<Arc<BrowserState>>() else {
        return protocol_error(StatusCode::SERVICE_UNAVAILABLE, "browser is not ready");
    };
    let Ok(path) = state.resolve_local_url(&url) else {
        return protocol_error(StatusCode::FORBIDDEN, "browser file access denied");
    };
    let Ok(metadata) = std::fs::metadata(&path) else {
        return protocol_error(StatusCode::NOT_FOUND, "browser file not found");
    };
    if !metadata.is_file() {
        return protocol_error(StatusCode::NOT_FOUND, "browser file not found");
    }

    let total = metadata.len();
    let requested_range = match request.headers().get(RANGE) {
        Some(value) => match value
            .to_str()
            .map_err(|_| ())
            .and_then(|value| parse_byte_range(value, total))
        {
            Ok(range) => range,
            Err(()) => {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(CONTENT_RANGE, format!("bytes */{total}"))
                    .header(CACHE_CONTROL, "no-store")
                    .body(Vec::new())
                    .expect("static browser range response");
            }
        },
        None => None,
    };
    let (status, start, end) = match requested_range {
        Some((start, end)) => (StatusCode::PARTIAL_CONTENT, start, end),
        None if total > 0 => (StatusCode::OK, 0, total - 1),
        None => (StatusCode::OK, 0, 0),
    };
    let content_length = if total == 0 { 0 } else { end - start + 1 };
    let data = if request.method() == Method::HEAD || total == 0 {
        Vec::new()
    } else {
        match read_file_slice(&path, start, end) {
            Ok(data) => data,
            Err(_) => return protocol_error(StatusCode::INTERNAL_SERVER_ERROR, "read failed"),
        }
    };
    let mut response = Response::builder()
        .status(status)
        .header(CONTENT_TYPE, mime_for_path(&path))
        .header(CONTENT_LENGTH, content_length.to_string())
        .header(ACCEPT_RANGES, "bytes")
        .header(CACHE_CONTROL, "no-store");
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(CONTENT_RANGE, format!("bytes {start}-{end}/{total}"));
    }
    response
        .body(data)
        .expect("static browser file response headers")
}

#[cfg(test)]
mod tests {
    use super::parse_byte_range;

    #[test]
    fn byte_ranges_cover_pdf_style_requests() {
        assert_eq!(parse_byte_range("bytes=0-99", 500), Ok(Some((0, 99))));
        assert_eq!(parse_byte_range("bytes=400-", 500), Ok(Some((400, 499))));
        assert_eq!(parse_byte_range("bytes=-25", 500), Ok(Some((475, 499))));
        assert!(parse_byte_range("bytes=500-600", 500).is_err());
        assert!(parse_byte_range("items=0-10", 500).is_err());
    }
}
