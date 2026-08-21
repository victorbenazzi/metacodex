//! Native viewport snapshot of the in-app browser webview.

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use tauri::webview::Webview;
use tauri::Runtime;

use crate::error::{AppError, AppResult};

use super::browser_bridge::BrowserCrop;

pub fn capture_png<R: Runtime>(
    webview: &Webview<R>,
    dest: &Path,
    crop: Option<&BrowserCrop>,
    viewport: Option<(f64, f64)>,
) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        capture_macos(webview, dest, crop, viewport)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
        let _ = dest;
        let _ = crop;
        let _ = viewport;
        Err(AppError::Other(
            "browser screenshot is not available on this platform yet".into(),
        ))
    }
}

#[cfg(target_os = "macos")]
fn capture_macos<R: Runtime>(
    webview: &Webview<R>,
    dest: &Path,
    crop: Option<&BrowserCrop>,
    viewport: Option<(f64, f64)>,
) -> AppResult<()> {
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSImage;
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::NSError;
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    let crop = crop.map(|rect| snapshot_rect(rect, viewport)).transpose()?;

    webview
        .with_webview(move |platform| {
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = tx.send(Err("snapshot must run on the main thread".into()));
                return;
            };
            let view: &WKWebView = unsafe { &*platform.inner().cast() };
            let config = unsafe { WKSnapshotConfiguration::new(mtm) };
            // Capture the current composited frame. Forcing a screen update here
            // makes WKWebView briefly clear its surface on some macOS versions.
            unsafe { config.setAfterScreenUpdates(false) };
            if let Some(rect) = crop {
                let cg = CGRect {
                    origin: CGPoint {
                        x: rect.x,
                        y: rect.y,
                    },
                    size: CGSize {
                        width: rect.width,
                        height: rect.height,
                    },
                };
                unsafe { config.setRect(cg) };
            }

            let tx_done = tx.clone();
            let block = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                if !error.is_null() {
                    let msg = unsafe { &*error }.localizedDescription().to_string();
                    let _ = tx_done.send(Err(msg));
                    return;
                }
                if image.is_null() {
                    let _ = tx_done.send(Err("empty snapshot".into()));
                    return;
                }
                match image_to_png(unsafe { &*image }) {
                    Ok(bytes) => {
                        let _ = tx_done.send(Ok(bytes));
                    }
                    Err(e) => {
                        let _ = tx_done.send(Err(e));
                    }
                }
            });
            unsafe {
                view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &block);
            }
        })
        .map_err(|e| AppError::Other(format!("webview snapshot: {e}")))?;

    let bytes = rx
        .recv_timeout(Duration::from_secs(4))
        .map_err(|_| AppError::Other("snapshot timed out".into()))?
        .map_err(AppError::Other)?;
    write_bytes_atomic(dest, &bytes)
}

fn snapshot_rect(crop: &BrowserCrop, viewport: Option<(f64, f64)>) -> AppResult<BrowserCrop> {
    let (viewport_width, viewport_height) = viewport
        .filter(|(width, height)| {
            width.is_finite() && height.is_finite() && *width >= 1.0 && *height >= 1.0
        })
        .ok_or_else(|| AppError::InvalidArgument("browser viewport is unavailable".into()))?;
    let pad = 8.0_f64;
    let left = (crop.x - pad).clamp(0.0, viewport_width);
    let top = (crop.y - pad).clamp(0.0, viewport_height);
    let right = (crop.x + crop.width + pad).clamp(0.0, viewport_width);
    let bottom = (crop.y + crop.height + pad).clamp(0.0, viewport_height);
    let width = right - left;
    let height = bottom - top;
    if width < 1.0 || height < 1.0 {
        return Err(AppError::InvalidArgument(
            "browser crop is outside the viewport".into(),
        ));
    }
    Ok(BrowserCrop {
        x: left,
        y: top,
        width,
        height,
    })
}

#[cfg(target_os = "macos")]
fn image_to_png(image: &objc2_app_kit::NSImage) -> Result<Vec<u8>, String> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::NSDictionary;

    let tiff = image
        .TIFFRepresentation()
        .ok_or_else(|| "snapshot TIFF failed".to_string())?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff)
        .ok_or_else(|| "snapshot bitmap failed".to_string())?;
    let props = NSDictionary::new();
    let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props) }
        .ok_or_else(|| "snapshot PNG failed".to_string())?;
    Ok(png.to_vec())
}

pub fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("png.metacodex.tmp");
    if let Err(e) = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()
    })() {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::Io(e));
    }
    std::fs::rename(&tmp, path).map_err(AppError::Io)?;
    Ok(())
}

/// Keep captures as a short-lived scratch pad for the coding agent, not a gallery.
const MAX_CAPTURES: usize = 8;
const MAX_AGE_SECS: u64 = 24 * 60 * 60;

pub fn prune_now() {
    let Ok(dir) = crate::config_paths::browser_captures_dir() else {
        return;
    };
    prune_dir(&dir);
}

pub fn prune_dir(dir: &Path) {
    prune_dir_at(
        dir,
        std::time::SystemTime::now(),
        MAX_AGE_SECS,
        MAX_CAPTURES,
    );
}

fn prune_dir_at(dir: &Path, now: std::time::SystemTime, max_age_secs: u64, cap: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut keep: Vec<(std::time::SystemTime, std::path::PathBuf)> = Vec::new();
    for entry in rd.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.ends_with(".metacodex.tmp") {
            let _ = std::fs::remove_file(&path);
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("png") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        let age = now.duration_since(modified).unwrap_or_default().as_secs();
        if age > max_age_secs {
            let _ = std::fs::remove_file(&path);
            continue;
        }
        keep.push((modified, path));
    }
    keep.sort_by_key(|(mtime, _)| *mtime);
    let extra = keep.len().saturating_sub(cap);
    for (_, path) in keep.into_iter().take(extra) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    #[test]
    fn prune_caps_newest() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mcx-cap-{}-{stamp}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..12 {
            std::fs::write(dir.join(format!("{i}.png")), [i as u8]).unwrap();
        }
        prune_dir_at(
            &dir,
            SystemTime::now() + Duration::from_secs(1),
            MAX_AGE_SECS,
            8,
        );
        let left: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(left.len(), 8);
    }

    #[test]
    fn snapshot_crop_is_padded_and_clamped_to_the_native_viewport() {
        let crop = snapshot_rect(
            &BrowserCrop {
                x: -20.0,
                y: 90.0,
                width: 2000.0,
                height: 2000.0,
            },
            Some((320.0, 180.0)),
        )
        .unwrap();

        assert_eq!(crop.x, 0.0);
        assert_eq!(crop.y, 82.0);
        assert_eq!(crop.width, 320.0);
        assert_eq!(crop.height, 98.0);
    }

    #[test]
    fn snapshot_crop_rejects_an_offscreen_rect() {
        let result = snapshot_rect(
            &BrowserCrop {
                x: 500.0,
                y: 500.0,
                width: 80.0,
                height: 60.0,
            },
            Some((320.0, 180.0)),
        );

        assert!(result.is_err());
    }
}
