//! In-app browser: a nested OS webview hosted in the right workbench.

use std::{sync::Arc, time::Duration};

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
    BrowserNavigatedPayload, EV_BROWSER_CAPTURE_SELECTED, EV_BROWSER_MODE, EV_BROWSER_NAVIGATED,
    EV_BROWSER_PICKED,
};

use super::{
    browser_bridge::{
        is_allowed_url, is_blank_href, is_bridge_url, new_bridge_token, validate_bridge,
        BridgeMessage, BrowserCrop, BrowserMode,
    },
    browser_capture,
};

pub const WEBVIEW_LABEL: &str = "preview-browser";

const INIT_SCRIPT: &str = include_str!("browser_init.js");
const BRIDGE_TOKEN_MARKER: &str = "__MCX_BRIDGE_TOKEN__";

pub struct BrowserState {
    mode: Mutex<BrowserMode>,
    mode_transition: tokio::sync::Mutex<()>,
    pub last_bounds: Mutex<Option<BrowserBounds>>,
    bridge_token: Mutex<String>,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            mode: Mutex::new(BrowserMode::Browse),
            mode_transition: tokio::sync::Mutex::new(()),
            last_bounds: Mutex::new(None),
            bridge_token: Mutex::new(new_bridge_token()),
        }
    }
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCapture {
    pub path: String,
}

fn preview(app: &AppHandle) -> AppResult<Webview<tauri::Wry>> {
    app.get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| AppError::NotFound("browser webview is not open".into()))
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

fn handle_bridge(app: &AppHandle, url: &Url) {
    let Some(state) = app.try_state::<Arc<BrowserState>>() else {
        return;
    };
    let token = state.bridge_token.lock().clone();
    let mode = *state.mode.lock();
    let Ok(message) = validate_bridge(&token, mode, url) else {
        return;
    };
    match message {
        BridgeMessage::Selection(pick) => {
            let _ = app.emit(EV_BROWSER_PICKED, pick);
        }
        BridgeMessage::Capture(rect) => {
            let _ = app.emit(EV_BROWSER_CAPTURE_SELECTED, rect);
        }
        BridgeMessage::Escape => {
            let app = app.clone();
            let state = state.inner().clone();
            tauri::async_runtime::spawn(async move {
                let _ = set_mode_authoritative(&app, &state, BrowserMode::Browse).await;
            });
        }
        BridgeMessage::Location {
            url,
            title,
            loading,
        } => {
            if !loading {
                if let Some(wv) = app.get_webview(WEBVIEW_LABEL) {
                    let token = state.bridge_token.lock().clone();
                    let _ = wv.eval(apply_mode_js(&token, stored_mode(app)));
                }
            }
            emit_nav(app, &url, &title, loading);
        }
    }
}

fn stored_mode(app: &AppHandle) -> BrowserMode {
    app.try_state::<Arc<BrowserState>>()
        .map(|s| *s.mode.lock())
        .unwrap_or_default()
}

fn apply_mode_js(token: &str, mode: BrowserMode) -> String {
    let token = serde_json::to_string(token).expect("browser token serializes");
    let encoded = serde_json::to_string(&mode).expect("browser mode serializes");
    format!(
        "(function(){{ return window.__mcx ? window.__mcx.setMode({token}, {encoded}) : false; }})()"
    )
}

fn prepare_capture_js(token: &str, mode: BrowserMode, barrier_id: &str) -> String {
    let token = serde_json::to_string(token).expect("browser token serializes");
    let encoded_mode = serde_json::to_string(&mode).expect("browser mode serializes");
    let encoded_id = serde_json::to_string(barrier_id).expect("browser barrier id serializes");
    format!(
        "(function(){{ return window.__mcx ? window.__mcx.prepareCapture({token}, {encoded_mode}, {encoded_id}) : false; }})()"
    )
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
        .map_err(|error| AppError::Other(error.to_string()))?;
    rx.await
        .map_err(|error| AppError::Other(format!("browser eval callback closed: {error}")))
}

async fn wait_mode_ready(
    webview: &Webview<tauri::Wry>,
    token: &str,
    mode: BrowserMode,
) -> AppResult<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(1500);
    let script = apply_mode_js(token, mode);
    let mut last_result = "no callback".to_string();
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(AppError::Other(format!(
                "browser mode frame timed out, last result: {last_result}"
            )));
        }
        let result = tokio::time::timeout(
            remaining.min(Duration::from_millis(250)),
            eval_now(webview, &script),
        )
        .await;
        match result {
            Ok(Ok(raw)) => {
                if serde_json::from_str::<bool>(&raw).unwrap_or(false) {
                    return Ok(());
                }
                last_result = raw;
            }
            Ok(Err(error)) => last_result = error.to_string(),
            Err(_) => last_result = "eval callback timed out".into(),
        }
        tokio::time::sleep(Duration::from_millis(16)).await;
    }
}

async fn wait_capture_ready(
    webview: &Webview<tauri::Wry>,
    token: &str,
    mode: BrowserMode,
    barrier_id: &str,
) -> AppResult<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(1500);
    let script = prepare_capture_js(token, mode, barrier_id);
    let mut last_result = "no callback".to_string();
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(AppError::Other(format!(
                "browser capture frame timed out, last result: {last_result}"
            )));
        }
        let result = tokio::time::timeout(
            remaining.min(Duration::from_millis(250)),
            eval_now(webview, &script),
        )
        .await;
        match result {
            Ok(Ok(raw)) => {
                if serde_json::from_str::<bool>(&raw).unwrap_or(false) {
                    return Ok(());
                }
                last_result = raw;
            }
            Ok(Err(error)) => last_result = error.to_string(),
            Err(_) => last_result = "eval callback timed out".into(),
        }
        tokio::time::sleep(Duration::from_millis(16)).await;
    }
}

async fn set_mode_authoritative(
    app: &AppHandle,
    state: &BrowserState,
    mode: BrowserMode,
) -> AppResult<()> {
    let _transition = state.mode_transition.lock().await;
    let previous = {
        let mut stored = state.mode.lock();
        let previous = *stored;
        *stored = mode;
        previous
    };
    let _ = app.emit(EV_BROWSER_MODE, mode);
    if let Some(webview) = app.get_webview(WEBVIEW_LABEL) {
        let token = state.bridge_token.lock().clone();
        if let Err(error) = wait_mode_ready(&webview, &token, mode).await {
            let rolled_back = {
                let mut stored = state.mode.lock();
                if *stored == mode {
                    *stored = previous;
                    true
                } else {
                    false
                }
            };
            if rolled_back {
                let _ = webview.eval(apply_mode_js(&token, previous));
                let _ = app.emit(EV_BROWSER_MODE, previous);
            }
            return Err(error);
        }
    }
    Ok(())
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
    let mode = BrowserMode::parse(&mode)?;
    set_mode_authoritative(&app, &state, mode).await
}

#[tauri::command]
pub async fn browser_clear_draw(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserState>>,
) -> AppResult<()> {
    if app.get_webview(WEBVIEW_LABEL).is_none() {
        return Ok(());
    }
    let token =
        serde_json::to_string(&*state.bridge_token.lock()).expect("browser token serializes");
    let result = tokio::time::timeout(
        Duration::from_millis(1500),
        eval_now(
            &preview(&app)?,
            &format!("(window.__mcx && window.__mcx.clearDraw({token}))"),
        ),
    )
    .await
    .map_err(|_| AppError::Other("browser draw clear timed out".into()))??;
    if serde_json::from_str::<bool>(&result).unwrap_or(false) {
        Ok(())
    } else {
        Err(AppError::Other("browser draw clear was rejected".into()))
    }
}

#[tauri::command]
pub async fn browser_capture(
    app: AppHandle,
    state: tauri::State<'_, Arc<BrowserState>>,
    crop: Option<BrowserCrop>,
    expected_mode: String,
) -> AppResult<BrowserCapture> {
    let expected_mode = BrowserMode::parse(&expected_mode)?;
    let _transition = state.mode_transition.lock().await;
    if *state.mode.lock() != expected_mode {
        return Err(AppError::InvalidArgument(
            "browser mode changed before capture".into(),
        ));
    }
    let webview = preview(&app)?;
    if expected_mode == BrowserMode::Draw {
        let token = state.bridge_token.lock().clone();
        let barrier_id = Uuid::new_v4().simple().to_string();
        wait_capture_ready(&webview, &token, expected_mode, &barrier_id).await?;
    }
    let dir = browser_captures_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.png", Uuid::new_v4()));
    let webview = webview.clone();
    let dest = path.clone();
    let viewport = state
        .last_bounds
        .lock()
        .as_ref()
        .map(|bounds| (bounds.width, bounds.height));
    tokio::task::spawn_blocking(move || {
        browser_capture::capture_png(&webview, &dest, crop.as_ref(), viewport)
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

    #[test]
    fn only_http_https_and_explicit_blank_are_allowed() {
        assert!(is_allowed_url(&"http://localhost:5173/".parse().unwrap()));
        assert!(is_allowed_url(&"https://example.com/".parse().unwrap()));
        assert!(is_allowed_url(&"about:blank".parse().unwrap()));
        assert!(!is_allowed_url(&"about:srcdoc".parse().unwrap()));
    }

    #[tokio::test]
    async fn browser_mode_transitions_are_serialized() {
        let state = Arc::new(BrowserState::default());
        let first = state.mode_transition.lock().await;
        let waiting_state = state.clone();
        let second = tokio::spawn(async move {
            let _guard = waiting_state.mode_transition.lock().await;
        });

        tokio::task::yield_now().await;
        assert!(!second.is_finished());
        drop(first);
        tokio::time::timeout(Duration::from_millis(100), second)
            .await
            .expect("second transition should continue after the first releases")
            .expect("transition task should complete");
    }
}
