//! In-app browser: a nested OS webview hosted in the right workbench.

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{
    webview::{NewWindowResponse, Webview, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl,
};
use uuid::Uuid;

use crate::config_paths::{browser_captures_dir, browser_profile_dir};
use crate::error::{AppError, AppResult};
use crate::events::{
    BrowserNavigatedPayload, EV_BROWSER_CAPTURE_SELECTED, EV_BROWSER_ESCAPE, EV_BROWSER_NAVIGATED,
    EV_BROWSER_PICKED,
};

use super::browser_capture;

pub const WEBVIEW_LABEL: &str = "preview-browser";

const BRIDGE_HOST: &str = "mcx.invalid";
const INIT_SCRIPT: &str = include_str!("browser_init.js");
const BRIDGE_TOKEN_MARKER: &str = "__MCX_BRIDGE_TOKEN__";
const MAX_BRIDGE_URL_BYTES: usize = 8 * 1024;

pub struct BrowserState {
    pub mode: Mutex<String>,
    pub last_bounds: Mutex<Option<BrowserBounds>>,
    bridge_token: Mutex<String>,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            mode: Mutex::new("browse".into()),
            last_bounds: Mutex::new(None),
            bridge_token: Mutex::new(new_bridge_token()),
        }
    }
}

fn new_bridge_token() -> String {
    Uuid::new_v4().simple().to_string()
}

impl BrowserState {
    fn rotate_bridge_token(&self) -> String {
        let token = new_bridge_token();
        *self.bridge_token.lock() = token.clone();
        token
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCrop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCapture {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPick {
    pub kind: String,
    pub url: String,
    pub selector: String,
    pub tag: String,
    pub id: Option<String>,
    pub classes: Vec<String>,
    pub text: Option<String>,
    pub rect: BrowserCrop,
    pub component: Option<String>,
    pub file: Option<String>,
    pub line: Option<i64>,
    pub full_path: String,
    pub accessibility: Option<String>,
    pub styles: Option<String>,
    pub viewport: BrowserViewport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserViewport {
    pub width: f64,
    pub height: f64,
    pub dpr: f64,
}

fn preview(app: &AppHandle) -> AppResult<Webview<tauri::Wry>> {
    app.get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| AppError::NotFound("browser webview is not open".into()))
}

pub fn is_allowed_url(url: &Url) -> bool {
    if is_bridge_url(url) {
        return false;
    }
    matches!(url.scheme(), "http" | "https" | "about")
}

fn is_bridge_url(url: &Url) -> bool {
    url.host_str() == Some(BRIDGE_HOST)
}

fn is_blank_href(url: &str) -> bool {
    url.is_empty() || url == "about:blank" || url.starts_with("about:")
}

fn emit_nav(app: &AppHandle, url: &str, title: &str, loading: bool) {
    let _ = app.emit(
        EV_BROWSER_NAVIGATED,
        BrowserNavigatedPayload {
            url: url.to_string(),
            title: title.to_string(),
            loading,
        },
    );
}

#[derive(Debug, PartialEq, Eq)]
enum BridgeMessage {
    Selection,
    Capture,
    Escape,
    Location {
        url: String,
        title: String,
        loading: bool,
    },
}

fn validate_bridge(state: &BrowserState, url: &Url) -> AppResult<BridgeMessage> {
    if !is_bridge_url(url) || url.as_str().len() > MAX_BRIDGE_URL_BYTES {
        return Err(AppError::PermissionDenied(
            "invalid browser bridge url".into(),
        ));
    }
    let mut pairs = std::collections::HashMap::new();
    for (key, value) in url.query_pairs() {
        if pairs.insert(key.into_owned(), value.into_owned()).is_some() {
            return Err(AppError::PermissionDenied(
                "duplicate browser bridge field".into(),
            ));
        }
    }
    let token = pairs
        .remove("token")
        .ok_or_else(|| AppError::PermissionDenied("missing browser bridge token".into()))?;
    if token != *state.bridge_token.lock() {
        return Err(AppError::PermissionDenied(
            "invalid browser bridge token".into(),
        ));
    }
    match url.path().trim_matches('/') {
        "selection" if pairs.is_empty() && *state.mode.lock() == "pick" => {
            Ok(BridgeMessage::Selection)
        }
        "capture" if pairs.is_empty() && *state.mode.lock() == "capture" => {
            Ok(BridgeMessage::Capture)
        }
        "escape" if pairs.is_empty() && *state.mode.lock() != "browse" => Ok(BridgeMessage::Escape),
        "location" => {
            if pairs
                .keys()
                .any(|key| !matches!(key.as_str(), "url" | "title" | "loading"))
            {
                return Err(AppError::PermissionDenied(
                    "unknown browser bridge field".into(),
                ));
            }
            let href = pairs.remove("url").unwrap_or_default();
            let title = pairs.remove("title").unwrap_or_default();
            let loading = match pairs.remove("loading").as_deref() {
                Some("1") => true,
                Some("0") => false,
                _ => return Err(AppError::PermissionDenied("invalid loading state".into())),
            };
            if href.len() > 4096 || title.len() > 512 {
                return Err(AppError::PermissionDenied(
                    "browser bridge payload too large".into(),
                ));
            }
            let parsed = Url::parse(&href)
                .map_err(|_| AppError::PermissionDenied("invalid location url".into()))?;
            if !is_allowed_url(&parsed) || is_blank_href(&href) {
                return Err(AppError::PermissionDenied("blocked location url".into()));
            }
            Ok(BridgeMessage::Location {
                url: href,
                title,
                loading,
            })
        }
        _ => Err(AppError::PermissionDenied(
            "invalid browser bridge message".into(),
        )),
    }
}

fn handle_bridge(app: &AppHandle, url: &Url) {
    let Some(state) = app.try_state::<Arc<BrowserState>>() else {
        return;
    };
    let Ok(message) = validate_bridge(&state, url) else {
        return;
    };
    match message {
        BridgeMessage::Selection => {
            let _ = app.emit(EV_BROWSER_PICKED, ());
        }
        BridgeMessage::Capture => {
            let _ = app.emit(EV_BROWSER_CAPTURE_SELECTED, ());
        }
        BridgeMessage::Escape => {
            let _ = app.emit(EV_BROWSER_ESCAPE, ());
        }
        BridgeMessage::Location {
            url,
            title,
            loading,
        } => {
            if !loading {
                if let Some(wv) = app.get_webview(WEBVIEW_LABEL) {
                    let _ = wv.eval(apply_mode_js(&stored_mode(app)));
                }
            }
            emit_nav(app, &url, &title, loading);
        }
    }
}

fn stored_mode(app: &AppHandle) -> String {
    app.try_state::<Arc<BrowserState>>()
        .map(|s| s.mode.lock().clone())
        .unwrap_or_else(|| "browse".into())
}

fn apply_mode_js(mode: &str) -> String {
    let encoded = serde_json::to_string(mode).unwrap_or_else(|_| "\"browse\"".into());
    format!("(function(){{ if (window.__mcx) window.__mcx.setMode({encoded}); }})()")
}

async fn eval_now(webview: &Webview<tauri::Wry>, js: &str) -> AppResult<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Arc::new(Mutex::new(Some(tx)));
    webview
        .eval_with_callback(js, move |result| {
            if let Some(tx) = tx.lock().take() {
                let _ = tx.send(result);
            }
        })
        .map_err(|e| AppError::Other(e.to_string()))?;
    tokio::time::timeout(Duration::from_secs(3), rx)
        .await
        .map_err(|_| AppError::Other("eval timed out".into()))?
        .map_err(|e| AppError::Other(format!("eval callback closed: {e}")))
}

fn ensure_webview(
    app: &AppHandle,
    bounds: &BrowserBounds,
    start: &Url,
) -> AppResult<Webview<tauri::Wry>> {
    if let Some(existing) = app.get_webview(WEBVIEW_LABEL) {
        return Ok(existing);
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| AppError::Other("main window missing".into()))?;

    let profile = browser_profile_dir()?;
    std::fs::create_dir_all(&profile)?;

    let app_nav = app.clone();
    let app_win = app.clone();
    let state = app.state::<Arc<BrowserState>>();
    let token = state.rotate_bridge_token();
    let init_script = INIT_SCRIPT.replace(BRIDGE_TOKEN_MARKER, &token);

    let builder = WebviewBuilder::new(WEBVIEW_LABEL, WebviewUrl::External(start.clone()))
        .initialization_script(init_script)
        .data_directory(profile)
        .enable_clipboard_access()
        .devtools(cfg!(debug_assertions))
        .on_new_window(move |url, _features| {
            if is_bridge_url(&url) {
                handle_bridge(&app_win, &url);
                return NewWindowResponse::Deny;
            }
            if is_allowed_url(&url) {
                if let Some(wv) = app_win.get_webview(WEBVIEW_LABEL) {
                    let _ = wv.navigate(url.clone());
                }
            }
            NewWindowResponse::Deny
        })
        .on_navigation(move |url| {
            if is_bridge_url(url) {
                handle_bridge(&app_nav, url);
                return false;
            }
            if !is_allowed_url(url) {
                return false;
            }
            let href = url.as_str();
            if !is_blank_href(href) {
                emit_nav(&app_nav, href, "", true);
            }
            true
        });

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
        )
        .map_err(|e| AppError::Other(format!("create browser webview: {e}")))?;
    if !bounds.visible {
        let _ = webview.hide();
    }
    Ok(webview)
}

fn apply_bounds(webview: &Webview<tauri::Wry>, bounds: &BrowserBounds) -> AppResult<()> {
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| AppError::Other(e.to_string()))?;
    webview
        .set_size(LogicalSize::new(
            bounds.width.max(1.0),
            bounds.height.max(1.0),
        ))
        .map_err(|e| AppError::Other(e.to_string()))?;
    if bounds.visible && bounds.width >= 8.0 && bounds.height >= 8.0 {
        webview.show().map_err(|e| AppError::Other(e.to_string()))?;
    } else {
        webview.hide().map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_set_bounds(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserState>>,
    bounds: BrowserBounds,
) -> AppResult<()> {
    *state.last_bounds.lock() = Some(bounds.clone());
    if let Some(webview) = app.get_webview(WEBVIEW_LABEL) {
        apply_bounds(&webview, &bounds)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_hide(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserState>>,
) -> AppResult<()> {
    let mut last = state.last_bounds.lock();
    if let Some(bounds) = last.as_mut() {
        bounds.visible = false;
    }
    drop(last);
    if let Some(webview) = app.get_webview(WEBVIEW_LABEL) {
        webview.hide().map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserState>>,
    url: String,
) -> AppResult<()> {
    let parsed = Url::parse(&url).map_err(|e| AppError::Other(format!("invalid url: {e}")))?;
    if !is_allowed_url(&parsed) {
        return Err(AppError::PermissionDenied(format!(
            "blocked navigation to {url}"
        )));
    }
    let bounds = state.last_bounds.lock().clone().unwrap_or(BrowserBounds {
        x: 0.0,
        y: 0.0,
        width: 800.0,
        height: 600.0,
        visible: false,
    });
    let webview = ensure_webview(&app, &bounds, &parsed)?;
    if !bounds.visible {
        let _ = webview.hide();
    }
    webview
        .navigate(parsed)
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn browser_reload(app: AppHandle) -> AppResult<()> {
    preview(&app)?
        .reload()
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn browser_go_back(app: AppHandle) -> AppResult<()> {
    preview(&app)?
        .eval("history.back()")
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle) -> AppResult<()> {
    preview(&app)?
        .eval("history.forward()")
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn browser_set_mode(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserState>>,
    mode: String,
) -> AppResult<()> {
    let safe = match mode.as_str() {
        "pick" | "draw" | "capture" | "browse" => mode,
        _ => "browse".into(),
    };
    *state.mode.lock() = safe.clone();
    if app.get_webview(WEBVIEW_LABEL).is_none() {
        return Ok(());
    }
    preview(&app)?
        .eval(apply_mode_js(&safe))
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn browser_clear_draw(app: AppHandle) -> AppResult<()> {
    if app.get_webview(WEBVIEW_LABEL).is_none() {
        return Ok(());
    }
    preview(&app)?
        .eval("(window.__mcx && window.__mcx.clearDraw())")
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn browser_take_pick(app: AppHandle) -> AppResult<Option<BrowserPick>> {
    if app.get_webview(WEBVIEW_LABEL).is_none() {
        return Ok(None);
    }
    let webview = preview(&app)?;
    let raw = eval_now(
        &webview,
        "(window.__mcx && window.__mcx.takePick()) || null",
    )
    .await?;
    let value: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
    if value.is_null() {
        Ok(None)
    } else {
        Ok(serde_json::from_value(value).ok())
    }
}

#[tauri::command]
pub async fn browser_take_capture_region(app: AppHandle) -> AppResult<Option<BrowserCrop>> {
    if app.get_webview(WEBVIEW_LABEL).is_none() {
        return Ok(None);
    }
    let webview = preview(&app)?;
    let raw = eval_now(
        &webview,
        "(window.__mcx && window.__mcx.takeCaptureRegion()) || null",
    )
    .await?;
    let value: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
    if value.is_null() {
        Ok(None)
    } else {
        Ok(serde_json::from_value(value).ok())
    }
}

#[tauri::command]
pub async fn browser_url(app: AppHandle) -> AppResult<String> {
    let Some(wv) = app.get_webview(WEBVIEW_LABEL) else {
        return Ok("about:blank".into());
    };
    // wry 0.55 panics on macOS if WKWebView.URL() is nil. Read via JS instead.
    match eval_now(&wv, "location.href || ''").await {
        Ok(raw) => {
            let href: String = serde_json::from_str(&raw).unwrap_or_default();
            if href.is_empty() {
                Ok("about:blank".into())
            } else {
                Ok(href)
            }
        }
        Err(_) => Ok("about:blank".into()),
    }
}

#[tauri::command]
pub async fn browser_capture(
    app: AppHandle,
    crop: Option<BrowserCrop>,
) -> AppResult<BrowserCapture> {
    let webview = preview(&app)?;
    let dir = browser_captures_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.png", Uuid::new_v4()));
    let webview = webview.clone();
    let dest = path.clone();
    tokio::task::spawn_blocking(move || {
        browser_capture::capture_png(&webview, &dest, crop.as_ref())
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {e}")))??;
    browser_capture::prune_dir(&dir);
    Ok(BrowserCapture {
        path: path.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_https_about_allowed() {
        for href in [
            "http://localhost:5173/",
            "https://example.com/",
            "about:blank",
        ] {
            let url: Url = href.parse().unwrap();
            assert!(is_allowed_url(&url), "{href}");
        }
    }

    #[test]
    fn file_data_javascript_blocked() {
        for href in [
            "file:///etc/passwd",
            "data:text/html,hi",
            "javascript:alert(1)",
            "https://mcx.invalid/pick",
        ] {
            if let Ok(url) = href.parse::<Url>() {
                assert!(!is_allowed_url(&url), "{href}");
            }
        }
    }

    #[tokio::test]
    async fn slow_evaluation_does_not_prevent_independent_async_progress() {
        let (_tx, rx) = tokio::sync::oneshot::channel::<String>();
        let stalled =
            tokio::spawn(async move { tokio::time::timeout(Duration::from_millis(25), rx).await });
        let independent = tokio::spawn(async { 42 });
        assert_eq!(independent.await.unwrap(), 42);
        assert!(stalled.await.unwrap().is_err());
    }

    fn bridge_url(token: &str, suffix: &str) -> Url {
        format!("https://mcx.invalid/{suffix}?token={token}")
            .parse()
            .unwrap()
    }

    #[test]
    fn rejects_missing_incorrect_and_stale_bridge_tokens() {
        let state = BrowserState::default();
        *state.mode.lock() = "pick".into();
        let missing: Url = "https://mcx.invalid/selection".parse().unwrap();
        assert!(validate_bridge(&state, &missing).is_err());
        assert!(validate_bridge(&state, &bridge_url("wrong", "selection")).is_err());
        let stale = state.bridge_token.lock().clone();
        state.rotate_bridge_token();
        assert!(validate_bridge(&state, &bridge_url(&stale, "selection")).is_err());
    }

    #[test]
    fn bridge_token_has_128_bits_and_rotates() {
        let state = BrowserState::default();
        let first = state.bridge_token.lock().clone();
        let second = state.rotate_bridge_token();
        assert_eq!(first.len(), 32);
        assert!(first.chars().all(|ch| ch.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn capture_bridge_requires_capture_mode() {
        let state = BrowserState::default();
        let token = state.bridge_token.lock().clone();
        let capture = bridge_url(&token, "capture");
        assert!(validate_bridge(&state, &capture).is_err());
        *state.mode.lock() = "capture".into();
        assert!(matches!(
            validate_bridge(&state, &capture),
            Ok(BridgeMessage::Capture)
        ));
    }

    #[test]
    fn rejects_invalid_scheme_unknown_fields_and_oversized_payloads() {
        let state = BrowserState::default();
        let token = state.bridge_token.lock().clone();
        let invalid_url: Url = format!(
            "https://mcx.invalid/location?token={token}&url=file%3A%2F%2F%2Fetc%2Fpasswd&title=x&loading=0"
        )
        .parse()
        .unwrap();
        assert!(validate_bridge(&state, &invalid_url).is_err());
        let unknown: Url = format!(
            "https://mcx.invalid/location?token={token}&url=https%3A%2F%2Fexample.com&title=x&loading=0&command=quit"
        )
        .parse()
        .unwrap();
        assert!(validate_bridge(&state, &unknown).is_err());
        let oversized: Url = format!(
            "https://mcx.invalid/location?token={token}&url=https%3A%2F%2Fexample.com&title={}&loading=0",
            "x".repeat(MAX_BRIDGE_URL_BYTES)
        )
        .parse()
        .unwrap();
        assert!(validate_bridge(&state, &oversized).is_err());
    }
}
