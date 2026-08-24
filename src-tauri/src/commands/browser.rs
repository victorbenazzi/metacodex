//! In-app browser: a nested OS webview hosted in the right workbench.

use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use parking_lot::Mutex;
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, Webview, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl,
};
use uuid::Uuid;

use crate::config_paths::{browser_captures_dir, browser_profile_dir};
use crate::error::{AppError, AppResult};
use crate::events::{
    BrowserNavigatedPayload, EV_BROWSER_CAPTURE_SELECTED, EV_BROWSER_MODE, EV_BROWSER_NAVIGATED,
    EV_BROWSER_PICKED,
};
use crate::projects::ProjectsCache;
use crate::util::paths;

use super::{
    browser_bridge::{
        is_allowed_url, is_blank_href, is_bridge_url, is_local_file_url, new_bridge_token,
        validate_bridge, BridgeMessage, BrowserCrop, BrowserMode, LOCAL_FILE_SCHEME,
    },
    browser_capture,
};

pub const WEBVIEW_LABEL: &str = "preview-browser";
pub const LOCAL_FILE_PROTOCOL: &str = LOCAL_FILE_SCHEME;

const INIT_SCRIPT: &str = include_str!("browser_init.js");
const BRIDGE_TOKEN_MARKER: &str = "__MCX_BRIDGE_TOKEN__";
const MAX_LOCAL_FILE_GRANTS: usize = 32;

#[derive(Default)]
struct LocalFileGrants {
    grants: HashMap<String, LocalFileGrant>,
    order: VecDeque<String>,
}

struct LocalFileGrant {
    project_root: String,
    web_root: PathBuf,
}

impl LocalFileGrants {
    fn grant(&mut self, project_root: String, web_root: PathBuf) -> String {
        while self.grants.len() >= MAX_LOCAL_FILE_GRANTS {
            let Some(old) = self.order.pop_front() else {
                break;
            };
            self.grants.remove(&old);
        }
        let token = Uuid::new_v4().simple().to_string();
        self.order.push_back(token.clone());
        self.grants.insert(
            token.clone(),
            LocalFileGrant {
                project_root,
                web_root,
            },
        );
        token
    }

    fn get(&self, token: &str) -> Option<&LocalFileGrant> {
        self.grants.get(token)
    }
}

pub struct BrowserState {
    mode: Mutex<BrowserMode>,
    mode_transition: tokio::sync::Mutex<()>,
    pub last_bounds: Mutex<Option<BrowserBounds>>,
    bridge_token: Mutex<String>,
    local_file_grants: Mutex<LocalFileGrants>,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            mode: Mutex::new(BrowserMode::Browse),
            mode_transition: tokio::sync::Mutex::new(()),
            last_bounds: Mutex::new(None),
            bridge_token: Mutex::new(new_bridge_token()),
            local_file_grants: Mutex::new(LocalFileGrants::default()),
        }
    }
}

impl BrowserState {
    fn rotate_bridge_token(&self) -> String {
        let token = new_bridge_token();
        *self.bridge_token.lock() = token.clone();
        token
    }

    fn grant_local_file(&self, project_root: String, web_root: PathBuf) -> String {
        self.local_file_grants.lock().grant(project_root, web_root)
    }

    pub(super) fn resolve_local_url(&self, url: &Url) -> AppResult<PathBuf> {
        let (token, encoded_path) = local_url_parts(url)?;
        let (project_root, web_root) = self
            .local_file_grants
            .lock()
            .get(token)
            .map(|grant| (grant.project_root.clone(), grant.web_root.clone()))
            .ok_or_else(|| AppError::PathNotAllowed("unknown browser file grant".into()))?;
        let relative = relative_path_from_encoded_url_path(encoded_path)?;
        let path = web_root.join(relative);
        let display = path.to_string_lossy().into_owned();
        paths::require_within_project(&project_root, &display)?;
        Ok(path)
    }
}

fn local_url_parts(url: &Url) -> AppResult<(&str, &str)> {
    if !is_local_file_url(url) {
        return Err(AppError::InvalidArgument("not a local browser URL".into()));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::PathNotAllowed("malformed browser file URL".into()))?;
    let token = if url.scheme() == LOCAL_FILE_SCHEME {
        host.strip_suffix(".localhost")
    } else {
        host.strip_prefix(&format!("{LOCAL_FILE_SCHEME}."))
            .and_then(|host| host.strip_suffix(".localhost"))
    }
    .ok_or_else(|| AppError::PathNotAllowed("malformed browser file URL".into()))?;
    let encoded_path = url.path().strip_prefix('/').unwrap_or(url.path());
    if token.is_empty() || encoded_path.is_empty() {
        return Err(AppError::PathNotAllowed(
            "malformed browser file URL".into(),
        ));
    }
    Ok((token, encoded_path))
}

fn relative_path_from_encoded_url_path(encoded_path: &str) -> AppResult<PathBuf> {
    let decoded = percent_decode_str(encoded_path)
        .decode_utf8()
        .map_err(|_| AppError::InvalidArgument("local path is not valid UTF-8".into()))?;
    let path = PathBuf::from(decoded.as_ref());
    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::Prefix(_)
                | std::path::Component::RootDir
                | std::path::Component::ParentDir
        )
    }) {
        return Err(AppError::PathNotAllowed(
            "browser file path escaped its web root".into(),
        ));
    }
    Ok(path)
}

fn local_file_url(token: &str, web_root: &Path, path: &Path) -> AppResult<Url> {
    let relative = path
        .strip_prefix(web_root)
        .map_err(|_| AppError::PathNotAllowed(path.display().to_string()))?;
    let mut url = Url::parse(&format!("{LOCAL_FILE_SCHEME}://{token}.localhost/"))
        .map_err(|error| AppError::InvalidArgument(format!("invalid local path: {error}")))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| AppError::InvalidArgument("invalid local browser URL".into()))?;
        segments.clear();
        for component in relative.components() {
            if let std::path::Component::Normal(component) = component {
                segments.push(&component.to_string_lossy());
            }
        }
    }
    Ok(url)
}

fn is_browser_entry_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "html" | "htm" | "js" | "mjs" | "cjs" | "css" | "pdf"
            )
        })
        .unwrap_or(false)
}

fn parse_local_input(raw: &str) -> AppResult<Option<PathBuf>> {
    let path = Path::new(raw);
    if path.is_absolute() {
        return Ok(Some(path.to_path_buf()));
    }
    if raw.starts_with("file://") {
        let url = Url::parse(raw)
            .map_err(|error| AppError::InvalidArgument(format!("invalid file URL: {error}")))?;
        return url
            .to_file_path()
            .map(Some)
            .map_err(|_| AppError::InvalidArgument("invalid local file URL".into()));
    }
    Ok(None)
}

fn resolve_navigation(
    cache: &ProjectsCache,
    state: &BrowserState,
    raw: &str,
) -> AppResult<(Url, String)> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(AppError::InvalidArgument("empty browser address".into()));
    }
    if let Some(path) = parse_local_input(raw)? {
        let display = path.to_string_lossy().into_owned();
        let project = cache
            .find_owner_project(&display)
            .ok_or_else(|| AppError::PathNotAllowed(display.clone()))?;
        cache.require_within_project(&project.id, &display)?;
        let metadata = std::fs::metadata(&path)?;
        if !metadata.is_file() {
            return Err(AppError::InvalidArgument(format!(
                "browser target is not a file: {display}"
            )));
        }
        if !is_browser_entry_file(&path) {
            return Err(AppError::InvalidArgument(
                "browser supports HTML, JavaScript, CSS, and PDF entry files".into(),
            ));
        }
        let web_root = path
            .parent()
            .ok_or_else(|| AppError::InvalidArgument("browser target has no parent".into()))?
            .to_path_buf();
        let grant = state.grant_local_file(project.path, web_root.clone());
        return Ok((local_file_url(&grant, &web_root, &path)?, display));
    }

    let parsed = Url::parse(raw)
        .map_err(|error| AppError::InvalidArgument(format!("invalid URL: {error}")))?;
    if is_local_file_url(&parsed) || !is_allowed_url(&parsed) {
        return Err(AppError::PermissionDenied(format!(
            "blocked navigation to {raw}"
        )));
    }
    Ok((parsed, raw.to_string()))
}

fn is_allowed_navigation(app: &AppHandle, url: &Url) -> bool {
    if !is_local_file_url(url) {
        return is_allowed_url(url);
    }
    app.try_state::<Arc<BrowserState>>()
        .and_then(|state| state.resolve_local_url(url).ok())
        .is_some()
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserNavigation {
    pub url: String,
    pub address: String,
}

fn preview(app: &AppHandle) -> AppResult<Webview<tauri::Wry>> {
    app.get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| AppError::NotFound("browser webview is not open".into()))
}

fn emit_nav(app: &AppHandle, url: &str, title: &str, loading: bool) {
    let address = Url::parse(url).ok().and_then(|parsed| {
        if !is_local_file_url(&parsed) {
            return None;
        }
        app.try_state::<Arc<BrowserState>>()
            .and_then(|state| state.resolve_local_url(&parsed).ok())
            .map(|path| path.to_string_lossy().into_owned())
    });
    let _ = app.emit(
        EV_BROWSER_NAVIGATED,
        BrowserNavigatedPayload {
            url: url.to_string(),
            address,
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
    let app_load = app.clone();
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
            if is_allowed_navigation(&app_win, &url) {
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
            if !is_allowed_navigation(&app_nav, url) {
                return false;
            }
            let href = url.as_str();
            if !is_blank_href(href) {
                emit_nav(&app_nav, href, "", true);
            }
            true
        })
        .on_page_load(move |_webview, payload| {
            if !is_allowed_navigation(&app_load, payload.url()) {
                return;
            }
            let href = payload.url().as_str();
            if is_blank_href(href) {
                return;
            }
            emit_nav(
                &app_load,
                href,
                "",
                payload.event() == PageLoadEvent::Started,
            );
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
    projects: tauri::State<'_, Arc<ProjectsCache>>,
    url: String,
) -> AppResult<BrowserNavigation> {
    let (parsed, address) = resolve_navigation(&projects, &state, &url)?;
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
        .navigate(parsed.clone())
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(BrowserNavigation {
        url: parsed.to_string(),
        address,
    })
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
        assert!(is_allowed_url(
            &"metacodex-file://0123456789abcdef.localhost/project/index.html"
                .parse()
                .unwrap()
        ));
    }

    #[test]
    fn local_file_urls_round_trip_encoded_paths_through_a_grant() {
        let base =
            std::env::temp_dir().join(format!("metacodex-browser-url-{}", Uuid::new_v4().simple()));
        let web_root = base.join("folder with spaces");
        let path = web_root.join("index with spaces.html");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "<!doctype html>").unwrap();
        std::fs::create_dir_all(web_root.join("assets")).unwrap();
        std::fs::write(web_root.join("assets/app.js"), "export {};").unwrap();

        let state = BrowserState::default();
        let grant = state.grant_local_file(base.to_string_lossy().into_owned(), web_root.clone());
        let url = local_file_url(&grant, &web_root, &path).unwrap();
        let absolute_asset = url.join("/assets/app.js").unwrap();

        assert_eq!(state.resolve_local_url(&url).unwrap(), path);
        assert_eq!(
            state.resolve_local_url(&absolute_asset).unwrap(),
            web_root.join("assets/app.js")
        );
        assert!(url.as_str().contains("index%20with%20spaces.html"));

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn local_navigation_requires_a_supported_file_inside_a_project() {
        let base =
            std::env::temp_dir().join(format!("metacodex-browser-nav-{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&base).unwrap();
        let html = base.join("index.html");
        let markdown = base.join("README.md");
        std::fs::write(&html, "<!doctype html>").unwrap();
        std::fs::write(&markdown, "# no").unwrap();

        let cache = ProjectsCache::default();
        cache.replace(vec![crate::projects::Project {
            id: "project-1".into(),
            name: "Project".into(),
            path: base.to_string_lossy().into_owned(),
            color: "#000000".into(),
            created_at: "2026-08-24T00:00:00Z".into(),
            last_opened_at: "2026-08-24T00:00:00Z".into(),
        }]);
        let state = BrowserState::default();

        let (url, address) = resolve_navigation(&cache, &state, &html.to_string_lossy()).unwrap();
        assert!(is_local_file_url(&url));
        assert_eq!(address, html.to_string_lossy());
        assert!(resolve_navigation(&cache, &state, &markdown.to_string_lossy()).is_err());

        let _ = std::fs::remove_dir_all(base);
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
