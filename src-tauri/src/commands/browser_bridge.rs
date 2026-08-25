use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::Url;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub(crate) const BRIDGE_HOST: &str = "mcx.invalid";
pub(crate) const LOCAL_FILE_SCHEME: &str = "metacodex-file";
pub(crate) const MAX_BRIDGE_URL_BYTES: usize = 32 * 1024;
const MAX_PAGE_URL_BYTES: usize = 8 * 1024;
const MAX_TITLE_BYTES: usize = 1024;
pub(crate) const MAX_SELECTOR_BYTES: usize = 240;
const MAX_TAG_BYTES: usize = 48;
const MAX_ID_BYTES: usize = 64;
const MAX_CLASS_BYTES: usize = 48;
const MAX_TEXT_BYTES: usize = 240;
const MAX_COMPONENT_BYTES: usize = 96;
const MAX_FILE_BYTES: usize = 320;
const MAX_FULL_PATH_BYTES: usize = 640;
const MAX_ACCESSIBILITY_BYTES: usize = 480;
const MAX_STYLES_BYTES: usize = 640;
const MAX_CROP_COORDINATE: f64 = 32_768.0;
const MAX_CROP_DIMENSION: f64 = 8_192.0;
const MAX_CROP_AREA: f64 = 32.0 * 1024.0 * 1024.0;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum BrowserMode {
    #[default]
    Browse,
    Pick,
    Draw,
    Capture,
}

impl BrowserMode {
    pub(crate) fn parse(value: &str) -> AppResult<Self> {
        match value {
            "browse" => Ok(Self::Browse),
            "pick" => Ok(Self::Pick),
            "draw" => Ok(Self::Draw),
            "capture" => Ok(Self::Capture),
            _ => Err(AppError::InvalidArgument(format!(
                "unknown browser mode: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum BrowserPickKind {
    Element,
    Text,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCrop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserViewport {
    pub width: f64,
    pub height: f64,
    pub dpr: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserPick {
    pub kind: BrowserPickKind,
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

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum BridgeMessage {
    Selection(Box<BrowserPick>),
    Capture(BrowserCrop),
    Escape,
    Location {
        url: String,
        title: String,
        loading: bool,
    },
}

pub(crate) fn new_bridge_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

pub(crate) fn is_bridge_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some(BRIDGE_HOST)
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

pub(crate) fn is_allowed_url(url: &Url) -> bool {
    if url.host_str() == Some(BRIDGE_HOST) {
        return false;
    }
    is_local_file_url(url)
        || matches!(url.scheme(), "http" | "https")
        || url.as_str() == "about:blank"
}

pub(crate) fn is_local_file_url(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    if url.scheme() == LOCAL_FILE_SCHEME {
        return host.ends_with(".localhost");
    }
    matches!(url.scheme(), "http" | "https")
        && host.starts_with(&format!("{LOCAL_FILE_SCHEME}."))
        && host.ends_with(".localhost")
}

pub(crate) fn is_blank_href(url: &str) -> bool {
    url.is_empty() || url == "about:blank"
}

pub(crate) fn validate_bridge(
    active_token: &str,
    active_mode: BrowserMode,
    url: &Url,
) -> AppResult<BridgeMessage> {
    if !is_bridge_url(url) || url.as_str().len() > MAX_BRIDGE_URL_BYTES {
        return denied("invalid browser bridge url");
    }
    let mut fields = HashMap::new();
    for (key, value) in url.query_pairs() {
        if fields
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return denied("duplicate browser bridge field");
        }
    }
    let token = take_required(&mut fields, "token", 64)?;
    if token != active_token {
        return denied("invalid browser bridge token");
    }

    match url.path() {
        "/selection" if active_mode == BrowserMode::Pick => parse_selection(&mut fields)
            .map(Box::new)
            .map(BridgeMessage::Selection),
        "/capture" if active_mode == BrowserMode::Capture => {
            let rect = parse_rect(&mut fields)?;
            ensure_no_fields(&fields)?;
            Ok(BridgeMessage::Capture(rect))
        }
        "/escape" if active_mode != BrowserMode::Browse => {
            ensure_no_fields(&fields)?;
            Ok(BridgeMessage::Escape)
        }
        "/location" => parse_location(&mut fields),
        _ => denied("invalid browser bridge message"),
    }
}

fn parse_selection(fields: &mut HashMap<String, String>) -> AppResult<BrowserPick> {
    let kind = match take_required(fields, "kind", 7)?.as_str() {
        "element" => BrowserPickKind::Element,
        "text" => BrowserPickKind::Text,
        _ => return denied("invalid browser selection kind"),
    };
    let url = take_required(fields, "url", MAX_PAGE_URL_BYTES)?;
    let parsed =
        Url::parse(&url).map_err(|_| AppError::PermissionDenied("invalid selection url".into()))?;
    if !is_allowed_url(&parsed) || is_blank_href(&url) {
        return denied("blocked selection url");
    }
    let selector = take_required(fields, "selector", MAX_SELECTOR_BYTES)?;
    let tag = take_required(fields, "tag", MAX_TAG_BYTES)?;
    let id = take_optional(fields, "id", MAX_ID_BYTES)?;
    let classes_raw = take_required(fields, "classes", 3 * (MAX_CLASS_BYTES + 4))?;
    let classes: Vec<String> = serde_json::from_str(&classes_raw)
        .map_err(|_| AppError::PermissionDenied("invalid selection classes".into()))?;
    if classes.len() > 3 || classes.iter().any(|item| item.len() > MAX_CLASS_BYTES) {
        return denied("selection classes too large");
    }
    let text = take_optional(fields, "text", MAX_TEXT_BYTES)?;
    let rect = parse_rect(fields)?;
    let component = take_optional(fields, "component", MAX_COMPONENT_BYTES)?;
    let file = take_optional(fields, "file", MAX_FILE_BYTES)?;
    let line = take_optional(fields, "line", 20)?
        .map(|value| value.parse::<i64>())
        .transpose()
        .map_err(|_| AppError::PermissionDenied("invalid selection line".into()))?;
    if line.is_some_and(|value| value <= 0) {
        return denied("invalid selection line");
    }
    let full_path = take_required(fields, "fullPath", MAX_FULL_PATH_BYTES)?;
    let accessibility = take_optional(fields, "accessibility", MAX_ACCESSIBILITY_BYTES)?;
    let styles = take_optional(fields, "styles", MAX_STYLES_BYTES)?;
    let viewport = BrowserViewport {
        width: take_number(fields, "viewportWidth")?,
        height: take_number(fields, "viewportHeight")?,
        dpr: take_number(fields, "dpr")?,
    };
    if viewport.width < 1.0 || viewport.height < 1.0 || viewport.dpr <= 0.0 {
        return denied("invalid browser viewport");
    }
    ensure_no_fields(fields)?;
    Ok(BrowserPick {
        kind,
        url,
        selector,
        tag,
        id,
        classes,
        text,
        rect,
        component,
        file,
        line,
        full_path,
        accessibility,
        styles,
        viewport,
    })
}

fn parse_location(fields: &mut HashMap<String, String>) -> AppResult<BridgeMessage> {
    let href = take_required(fields, "url", MAX_PAGE_URL_BYTES)?;
    let title = take_required(fields, "title", MAX_TITLE_BYTES)?;
    let loading = match take_required(fields, "loading", 1)?.as_str() {
        "1" => true,
        "0" => false,
        _ => return denied("invalid loading state"),
    };
    ensure_no_fields(fields)?;
    let parsed =
        Url::parse(&href).map_err(|_| AppError::PermissionDenied("invalid location url".into()))?;
    if !is_allowed_url(&parsed) || is_blank_href(&href) {
        return denied("blocked location url");
    }
    Ok(BridgeMessage::Location {
        url: href,
        title,
        loading,
    })
}

fn parse_rect(fields: &mut HashMap<String, String>) -> AppResult<BrowserCrop> {
    let rect = BrowserCrop {
        x: take_number(fields, "x")?,
        y: take_number(fields, "y")?,
        width: take_number(fields, "width")?,
        height: take_number(fields, "height")?,
    };
    if rect.width < 8.0
        || rect.height < 8.0
        || rect.width > MAX_CROP_DIMENSION
        || rect.height > MAX_CROP_DIMENSION
        || rect.width * rect.height > MAX_CROP_AREA
        || rect.x.abs() > MAX_CROP_COORDINATE
        || rect.y.abs() > MAX_CROP_COORDINATE
    {
        return denied("invalid browser selection bounds");
    }
    Ok(rect)
}

fn take_number(fields: &mut HashMap<String, String>, key: &str) -> AppResult<f64> {
    let raw = take_required(fields, key, 32)?;
    let value = raw
        .parse::<f64>()
        .map_err(|_| AppError::PermissionDenied(format!("invalid browser field: {key}")))?;
    if !value.is_finite() {
        return denied("browser coordinates must be finite");
    }
    Ok(value)
}

fn take_required(
    fields: &mut HashMap<String, String>,
    key: &str,
    max_bytes: usize,
) -> AppResult<String> {
    let value = fields
        .remove(key)
        .ok_or_else(|| AppError::PermissionDenied(format!("missing browser field: {key}")))?;
    if value.len() > max_bytes {
        return denied("browser bridge payload too large");
    }
    Ok(value)
}

fn take_optional(
    fields: &mut HashMap<String, String>,
    key: &str,
    max_bytes: usize,
) -> AppResult<Option<String>> {
    let Some(value) = fields.remove(key) else {
        return Ok(None);
    };
    if value.len() > max_bytes {
        return denied("browser bridge payload too large");
    }
    Ok(Some(value))
}

fn ensure_no_fields(fields: &HashMap<String, String>) -> AppResult<()> {
    if fields.is_empty() {
        Ok(())
    } else {
        denied("unknown browser bridge field")
    }
}

fn denied<T>(message: &str) -> AppResult<T> {
    Err(AppError::PermissionDenied(message.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Url;

    fn bridge_url(path: &str, token: &str, fields: &[(&str, &str)]) -> Url {
        let mut url = Url::parse(&format!("https://mcx.invalid/{path}")).unwrap();
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("token", token);
            for (key, value) in fields {
                query.append_pair(key, value);
            }
        }
        url
    }

    fn selection_fields() -> Vec<(&'static str, &'static str)> {
        vec![
            ("kind", "text"),
            ("url", "https://example.com/pricing"),
            ("selector", "main > h1"),
            ("tag", "h1"),
            ("id", "hero-title"),
            ("classes", "[\"display\",\"hero\"]"),
            ("text", "Build faster"),
            ("x", "12.5"),
            ("y", "24"),
            ("width", "320"),
            ("height", "48"),
            ("component", "HeroTitle"),
            ("file", "src/Hero.tsx"),
            ("line", "42"),
            ("fullPath", "html > body > main > h1"),
            ("accessibility", "role=heading"),
            ("styles", "font-size:48px"),
            ("viewportWidth", "1440"),
            ("viewportHeight", "900"),
            ("dpr", "2"),
        ]
    }

    #[test]
    fn parses_authenticated_selection_payload() {
        let token = new_bridge_token();
        let url = bridge_url("selection", &token, &selection_fields());

        let message = validate_bridge(&token, BrowserMode::Pick, &url).unwrap();

        let BridgeMessage::Selection(pick) = message else {
            panic!("expected selection");
        };
        assert_eq!(pick.kind, BrowserPickKind::Text);
        assert_eq!(pick.selector, "main > h1");
        assert_eq!(pick.classes, vec!["display", "hero"]);
        assert_eq!(pick.rect.width, 320.0);
        assert_eq!(pick.viewport.dpr, 2.0);
    }

    #[test]
    fn rejects_selection_with_wrong_mode_unknown_field_or_duplicate_field() {
        let token = new_bridge_token();
        let fields = selection_fields();
        let wrong_mode = bridge_url("selection", &token, &fields);
        assert!(validate_bridge(&token, BrowserMode::Browse, &wrong_mode).is_err());

        let mut unknown = fields.clone();
        unknown.push(("command", "quit"));
        assert!(validate_bridge(
            &token,
            BrowserMode::Pick,
            &bridge_url("selection", &token, &unknown),
        )
        .is_err());

        let mut duplicate = fields;
        duplicate.push(("selector", "body"));
        assert!(validate_bridge(
            &token,
            BrowserMode::Pick,
            &bridge_url("selection", &token, &duplicate),
        )
        .is_err());
    }

    #[test]
    fn rejects_a_wrong_bridge_token() {
        let url = bridge_url("selection", "wrong-token", &selection_fields());

        assert!(validate_bridge("active-token", BrowserMode::Pick, &url).is_err());
    }

    #[test]
    fn rejects_oversized_or_non_finite_selection_fields() {
        let token = new_bridge_token();
        let mut oversized = selection_fields();
        let selector = "x".repeat(MAX_SELECTOR_BYTES + 1);
        oversized.retain(|(key, _)| *key != "selector");
        oversized.push(("selector", Box::leak(selector.into_boxed_str())));
        assert!(validate_bridge(
            &token,
            BrowserMode::Pick,
            &bridge_url("selection", &token, &oversized),
        )
        .is_err());

        let mut non_finite = selection_fields();
        non_finite.retain(|(key, _)| *key != "width");
        non_finite.push(("width", "NaN"));
        assert!(validate_bridge(
            &token,
            BrowserMode::Pick,
            &bridge_url("selection", &token, &non_finite),
        )
        .is_err());
    }

    #[test]
    fn parses_capture_rect_and_rejects_tiny_regions() {
        let token = new_bridge_token();
        let valid = bridge_url(
            "capture",
            &token,
            &[("x", "10"), ("y", "20"), ("width", "80"), ("height", "60")],
        );
        assert_eq!(
            validate_bridge(&token, BrowserMode::Capture, &valid).unwrap(),
            BridgeMessage::Capture(BrowserCrop {
                x: 10.0,
                y: 20.0,
                width: 80.0,
                height: 60.0,
            }),
        );

        let tiny = bridge_url(
            "capture",
            &token,
            &[("x", "10"), ("y", "20"), ("width", "7"), ("height", "60")],
        );
        assert!(validate_bridge(&token, BrowserMode::Capture, &tiny).is_err());

        let huge = bridge_url(
            "capture",
            &token,
            &[
                ("x", "10"),
                ("y", "20"),
                ("width", "1000000"),
                ("height", "1000000"),
            ],
        );
        assert!(validate_bridge(&token, BrowserMode::Capture, &huge).is_err());
    }

    #[test]
    fn accepts_percent_encoded_location_within_the_total_budget() {
        let token = new_bridge_token();
        let prefix = "https://example.com/";
        let href = format!(
            "{prefix}{}",
            "é".repeat((MAX_PAGE_URL_BYTES - prefix.len()) / 2)
        );
        let location = bridge_url(
            "location",
            &token,
            &[
                ("url", href.as_str()),
                ("title", "Pricing"),
                ("loading", "0"),
            ],
        );

        assert_eq!(href.len(), MAX_PAGE_URL_BYTES);
        assert!(location.as_str().len() > href.len());
        assert!(location.as_str().len() < MAX_BRIDGE_URL_BYTES);
        assert!(validate_bridge(&token, BrowserMode::Browse, &location).is_ok());

        let oversized_href = format!("{href}é");
        let oversized = bridge_url(
            "location",
            &token,
            &[
                ("url", oversized_href.as_str()),
                ("title", "Pricing"),
                ("loading", "0"),
            ],
        );
        assert!(validate_bridge(&token, BrowserMode::Browse, &oversized).is_err());
    }

    #[test]
    fn mode_parser_rejects_unknown_values() {
        assert_eq!(BrowserMode::parse("capture").unwrap(), BrowserMode::Capture);
        assert!(BrowserMode::parse("surprise").is_err());
    }

    #[test]
    fn token_rotates_and_contains_more_than_128_random_bits() {
        let first = new_bridge_token();
        let second = new_bridge_token();
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|ch| ch.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn bridge_requires_the_exact_https_origin() {
        let token = new_bridge_token();
        for href in [
            format!("http://mcx.invalid/escape?token={token}"),
            format!("https://user@mcx.invalid/escape?token={token}"),
            format!("https://mcx.invalid:444/escape?token={token}"),
        ] {
            let url = Url::parse(&href).unwrap();
            assert!(!is_bridge_url(&url), "{href}");
            assert!(!is_allowed_url(&url), "{href}");
            assert!(validate_bridge(&token, BrowserMode::Pick, &url).is_err());
        }
    }
}
