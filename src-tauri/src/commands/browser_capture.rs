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
    #[cfg(target_os = "linux")]
    {
        capture_linux(webview, dest, crop, viewport)
    }
    #[cfg(target_os = "windows")]
    {
        capture_windows(webview, dest, crop, viewport)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
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

#[cfg(target_os = "windows")]
fn capture_windows<R: Runtime>(
    webview: &Webview<R>,
    dest: &Path,
    crop: Option<&BrowserCrop>,
    viewport: Option<(f64, f64)>,
) -> AppResult<()> {
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    let crop = crop.cloned();
    webview
        .with_webview(move |platform| {
            let result = (|| -> Result<(), String> {
                let controller = platform.controller();
                let core =
                    unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
                let stream = unsafe { CreateStreamOnHGlobal(HGLOBAL::default(), true) }
                    .map_err(|error| error.to_string())?;
                let stream_for_callback = stream.clone();
                let tx_done = tx.clone();
                let handler = CapturePreviewCompletedHandler::create(Box::new(move |status| {
                    let result = status
                        .map_err(|error| error.to_string())
                        .and_then(|()| read_windows_stream(&stream_for_callback))
                        .and_then(|png| match crop.as_ref() {
                            Some(rect) => crop_snapshot_png(&png, rect, viewport)
                                .map_err(|error| error.to_string()),
                            None => Ok(png),
                        });
                    let _ = tx_done.send(result);
                    Ok(())
                }));
                unsafe {
                    core.CapturePreview(
                        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                        &stream,
                        &handler,
                    )
                }
                .map_err(|error| error.to_string())?;
                Ok(())
            })();
            if let Err(error) = result {
                let _ = tx.send(Err(error));
            }
        })
        .map_err(|error| AppError::Other(format!("webview snapshot: {error}")))?;

    let bytes = rx
        .recv_timeout(Duration::from_secs(4))
        .map_err(|_| AppError::Other("snapshot timed out".into()))?
        .map_err(AppError::Other)?;
    write_bytes_atomic(dest, &bytes)
}

#[cfg(target_os = "windows")]
fn read_windows_stream(stream: &windows::Win32::System::Com::IStream) -> Result<Vec<u8>, String> {
    use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    let mut stat = STATSTG::default();
    unsafe { stream.Stat(&mut stat, STATFLAG_NONAME) }.map_err(|error| error.to_string())?;
    let length = usize::try_from(stat.cbSize)
        .map_err(|_| "browser snapshot is too large to read".to_string())?;
    if length == 0 {
        return Err("empty snapshot".into());
    }
    unsafe { stream.Seek(0, STREAM_SEEK_SET, None) }.map_err(|error| error.to_string())?;

    let mut output = vec![0_u8; length];
    let mut offset = 0_usize;
    while offset < output.len() {
        let chunk = (output.len() - offset).min(u32::MAX as usize) as u32;
        let mut read = 0_u32;
        unsafe { stream.Read(output[offset..].as_mut_ptr().cast(), chunk, Some(&mut read)) }
            .ok()
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        offset += read as usize;
    }
    output.truncate(offset);
    if output.is_empty() {
        return Err("empty snapshot".into());
    }
    Ok(output)
}

#[cfg(target_os = "linux")]
fn capture_linux<R: Runtime>(
    webview: &Webview<R>,
    dest: &Path,
    crop: Option<&BrowserCrop>,
    viewport: Option<(f64, f64)>,
) -> AppResult<()> {
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    let crop = crop.cloned();
    webview
        .with_webview(move |platform| {
            request_linux_snapshot(&platform.inner(), crop, viewport, tx);
        })
        .map_err(|error| AppError::Other(format!("webview snapshot: {error}")))?;

    let bytes = rx
        .recv_timeout(Duration::from_secs(4))
        .map_err(|_| AppError::Other("snapshot timed out".into()))?
        .map_err(AppError::Other)?;
    write_bytes_atomic(dest, &bytes)
}

#[cfg(target_os = "linux")]
fn request_linux_snapshot(
    view: &webkit2gtk::WebView,
    crop: Option<BrowserCrop>,
    viewport: Option<(f64, f64)>,
    tx: mpsc::Sender<Result<Vec<u8>, String>>,
) {
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

    view.snapshot(
        SnapshotRegion::Visible,
        SnapshotOptions::NONE,
        None::<&webkit2gtk::gio::Cancellable>,
        move |result| {
            let result = result
                .map_err(|error| error.to_string())
                .and_then(|surface| {
                    let image = surface
                        .map_to_image(None)
                        .map_err(|error| error.to_string())?;
                    let mut png = Vec::new();
                    image
                        .write_to_png(&mut png)
                        .map_err(|error| error.to_string())?;
                    match crop.as_ref() {
                        Some(rect) => crop_snapshot_png(&png, rect, viewport)
                            .map_err(|error| error.to_string()),
                        None => Ok(png),
                    }
                });
            let _ = tx.send(result);
        },
    );
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

#[cfg(any(test, target_os = "linux", target_os = "windows"))]
fn crop_snapshot_png(
    png: &[u8],
    crop: &BrowserCrop,
    viewport: Option<(f64, f64)>,
) -> AppResult<Vec<u8>> {
    use image::{GenericImageView, ImageFormat};
    use std::io::Cursor;

    let rect = snapshot_rect(crop, viewport)?;
    let (viewport_width, viewport_height) = viewport.expect("snapshot_rect validates viewport");
    let image = image::load_from_memory_with_format(png, ImageFormat::Png)
        .map_err(|error| AppError::Other(format!("decode browser snapshot: {error}")))?;
    let (image_width, image_height) = image.dimensions();
    let scale_x = image_width as f64 / viewport_width;
    let scale_y = image_height as f64 / viewport_height;
    let left = (rect.x * scale_x).floor().clamp(0.0, image_width as f64) as u32;
    let top = (rect.y * scale_y).floor().clamp(0.0, image_height as f64) as u32;
    let right = ((rect.x + rect.width) * scale_x)
        .ceil()
        .clamp(0.0, image_width as f64) as u32;
    let bottom = ((rect.y + rect.height) * scale_y)
        .ceil()
        .clamp(0.0, image_height as f64) as u32;
    if right <= left || bottom <= top {
        return Err(AppError::InvalidArgument(
            "browser crop is outside the captured image".into(),
        ));
    }

    let cropped = image.crop_imm(left, top, right - left, bottom - top);
    let mut output = Cursor::new(Vec::new());
    cropped
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| AppError::Other(format!("encode browser snapshot: {error}")))?;
    Ok(output.into_inner())
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
    use image::{DynamicImage, GenericImageView, ImageBuffer, ImageFormat, Rgba};
    use std::io::Cursor;
    use std::time::{Duration, SystemTime};

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_webkit_snapshot_returns_a_png() {
        if std::env::var_os("METACODEX_NATIVE_CAPTURE_TEST").is_none() {
            return;
        }

        use gtk::prelude::*;
        use webkit2gtk::{LoadEvent, WebView, WebViewExt};

        gtk::init().unwrap();
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_default_size(320, 180);
        let view = WebView::new();
        window.add(&view);
        window.show_all();

        let (loaded_tx, loaded_rx) = mpsc::channel();
        view.connect_load_changed(move |_, event| {
            if event == LoadEvent::Finished {
                let _ = loaded_tx.send(());
            }
        });
        view.load_html(
            "<!doctype html><style>html,body{margin:0;background:#123456}</style>",
            Some("http://localhost/"),
        );
        pump_linux_main_context_until(|| loaded_rx.try_recv().is_ok());

        let (snapshot_tx, snapshot_rx) = mpsc::channel();
        request_linux_snapshot(&view, None, Some((320.0, 180.0)), snapshot_tx);
        let mut snapshot = None;
        pump_linux_main_context_until(|| {
            if let Ok(result) = snapshot_rx.try_recv() {
                snapshot = Some(result);
                true
            } else {
                false
            }
        });
        let png = snapshot.expect("snapshot callback did not run").unwrap();
        let decoded = image::load_from_memory_with_format(&png, ImageFormat::Png).unwrap();
        assert!(decoded.width() >= 300);
        assert!(decoded.height() >= 160);
        window.close();
    }

    #[cfg(target_os = "linux")]
    fn pump_linux_main_context_until(mut done: impl FnMut() -> bool) {
        let context = webkit2gtk::glib::MainContext::default();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut finished = done();
        while !finished && std::time::Instant::now() < deadline {
            while context.pending() {
                context.iteration(false);
            }
            finished = done();
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(finished, "native Linux webview operation timed out");
    }

    #[test]
    fn bitmap_crop_scales_css_coordinates_to_native_pixels() {
        let source = ImageBuffer::from_fn(400, 200, |x, y| Rgba([x as u8, y as u8, 7, 255]));
        let mut png = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(source)
            .write_to(&mut png, ImageFormat::Png)
            .unwrap();

        let cropped = crop_snapshot_png(
            &png.into_inner(),
            &BrowserCrop {
                x: 25.0,
                y: 20.0,
                width: 50.0,
                height: 40.0,
            },
            Some((200.0, 100.0)),
        )
        .unwrap();
        let decoded = image::load_from_memory_with_format(&cropped, ImageFormat::Png).unwrap();

        assert_eq!(decoded.dimensions(), (132, 112));
        assert_eq!(decoded.get_pixel(0, 0), Rgba([34, 24, 7, 255]));
        assert_eq!(decoded.get_pixel(131, 111), Rgba([165, 135, 7, 255]));
    }

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
