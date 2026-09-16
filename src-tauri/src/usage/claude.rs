use super::types::{finite_number, short_string, ProviderUsage, QuotaWindow, SessionUsage};
use crate::config_paths::{read_json, write_json_atomic};
use crate::error::{AppError, AppResult};
use crate::pty::{PtyKind, PtySpawnSpec};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;

pub const HELPER_FLAG: &str = "--metacodex-usage-statusline";
const MAX_PAYLOAD: u64 = 64 * 1024;
const RETENTION_SECONDS: i64 = 90 * 86400;

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureGrant {
    project_id: Option<String>,
    created_at: i64,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Capture {
    windows: Vec<QuotaWindow>,
    session: Option<SessionUsage>,
}

fn capture_dir() -> AppResult<std::path::PathBuf> {
    Ok(super::root()?.join("claude"))
}

fn validate_id(id: &str) -> AppResult<String> {
    uuid::Uuid::parse_str(id)
        .map(|v| v.to_string())
        .map_err(|_| AppError::InvalidArgument("invalid usage capture".into()))
}

/// Applies only after an explicit opt-in, to future launches owned by this app.
/// User/project settings are never read or modified. Existing explicit launch
/// settings take precedence, and managed Claude policy remains authoritative.
pub fn decorate(spec: &mut PtySpawnSpec) -> AppResult<()> {
    if spec.cli_id.as_deref() != Some("claude-code") || !super::options()?.claude_enabled {
        return Ok(());
    }
    let PtyKind::Cli {
        args, environment, ..
    } = &mut spec.kind
    else {
        return Ok(());
    };
    if args
        .iter()
        .any(|arg| arg == "--settings" || arg.starts_with("--settings=") || arg == "--bare")
    {
        return Ok(());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let exe = std::env::current_exe()?;
    let exe = exe.to_string_lossy();
    #[cfg(windows)]
    let exe = exe.replace('\\', "/");
    // Claude executes statusLine commands via a shell, including Git Bash on Windows.
    let command = format!("'{}' {HELPER_FLAG} {id}", exe.replace('\'', "'\\''"));
    let settings = json!({"statusLine":{"type":"command","command":command,"padding":0}});
    write_json_atomic(
        &capture_dir()?.join(format!("{id}.grant.json")),
        &CaptureGrant {
            project_id: spec.project_id.clone(),
            created_at: chrono::Utc::now().timestamp(),
        },
    )?;
    args.extend(["--settings".into(), settings.to_string()]);
    environment.insert(
        "METACODEX_HOME".into(),
        crate::config_paths::config_root()?
            .to_string_lossy()
            .into_owned(),
    );
    Ok(())
}

fn parse(payload: &Value, grant: &CaptureGrant, now: i64) -> Capture {
    let mut windows = vec![];
    for (key, duration) in [
        ("five_hour", Some(300)),
        ("seven_day", Some(10080)),
        ("spend_limit", None),
    ] {
        let Some(window) = payload.get("rate_limits").and_then(|v| v.get(key)) else {
            continue;
        };
        let Some(used) = finite_number(window.get("used_percentage")) else {
            continue;
        };
        let resets_at = window.get("resets_at").and_then(Value::as_i64);
        if resets_at.is_some_and(|time| time <= now) {
            continue;
        }
        windows.push(QuotaWindow {
            id: key.into(),
            label: None,
            used_percent: used,
            duration_minutes: duration,
            resets_at,
        });
    }
    let session = payload
        .get("session_id")
        .and_then(Value::as_str)
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
        .map(|id| SessionUsage {
            session_id: id.to_string(),
            project_id: grant.project_id.clone(),
            model: short_string(payload.pointer("/model/display_name")),
            estimated_cost_usd: finite_number(payload.pointer("/cost/total_cost_usd")),
            context_used_percent: finite_number(payload.pointer("/context_window/used_percentage")),
            observed_at: now,
        });
    Capture { windows, session }
}

fn capture(id: &str, payload: &Value) -> AppResult<Capture> {
    let id = validate_id(id)?;
    let dir = capture_dir()?;
    let grant_path = dir.join(format!("{id}.grant.json"));
    let meta = std::fs::symlink_metadata(&grant_path)?;
    if !meta.is_file() || meta.len() > MAX_PAYLOAD {
        return Err(AppError::PermissionDenied("invalid usage grant".into()));
    }
    let grant: CaptureGrant = read_json(&grant_path)?;
    let now = chrono::Utc::now().timestamp();
    if grant.created_at <= 0 || now - grant.created_at > RETENTION_SECONDS {
        return Err(AppError::PermissionDenied("expired usage grant".into()));
    }
    let result = parse(payload, &grant, now);
    if super::options()?.claude_enabled {
        write_json_atomic(&dir.join(format!("{id}.sample.json")), &result)?;
    }
    Ok(result)
}

/// Runs before Tauri starts. Only sanitized numbers are stored, never raw stdin.
pub fn run_helper(id: &str) {
    let result = (|| -> AppResult<Capture> {
        let mut bytes = Vec::new();
        std::io::stdin()
            .take(MAX_PAYLOAD + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_PAYLOAD {
            return Err(AppError::FileTooLarge("usage payload".into()));
        }
        let payload: Value = serde_json::from_slice(&bytes)
            .map_err(|_| AppError::InvalidArgument("usage payload".into()))?;
        capture(id, &payload)
    })();
    if let Ok(capture) = result {
        let values: Vec<String> = capture
            .windows
            .iter()
            .map(|window| {
                let label = match window.id.as_str() {
                    "five_hour" => "5h",
                    "seven_day" => "7d",
                    _ => "$",
                };
                format!("{label}: {:.0}%", window.used_percent)
            })
            .collect();
        println!(
            "Claude{}",
            if values.is_empty() {
                String::new()
            } else {
                format!(" | {}", values.join(" | "))
            }
        );
    }
}

pub fn snapshot(enabled: bool) -> AppResult<ProviderUsage> {
    let mut provider =
        ProviderUsage::empty("claude-code", if enabled { "waiting" } else { "disabled" });
    if !enabled {
        return Ok(provider);
    }
    let dir = capture_dir()?;
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(provider),
        Err(e) => return Err(e.into()),
    };
    let now = chrono::Utc::now().timestamp();
    let mut samples = vec![];
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".sample.json") else {
            continue;
        };
        if validate_id(id).is_err() {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !meta.is_file() || meta.len() > MAX_PAYLOAD {
            continue;
        }
        let sample: Capture = match read_json(&entry.path()) {
            Ok(sample) => sample,
            Err(_) => continue,
        };
        let Some(session) = &sample.session else {
            continue;
        };
        if now - session.observed_at > RETENTION_SECONDS {
            let _ = std::fs::remove_file(entry.path());
            let _ = std::fs::remove_file(dir.join(format!("{id}.grant.json")));
            continue;
        }
        samples.push(sample);
    }
    samples.sort_by_key(|sample| {
        std::cmp::Reverse(
            sample
                .session
                .as_ref()
                .map(|s| s.observed_at)
                .unwrap_or_default(),
        )
    });
    if let Some(latest) = samples.first() {
        provider.status = "partial".into();
        provider.issue = Some("latestSession".into());
        provider.observed_at = latest.session.as_ref().map(|s| s.observed_at);
        provider.windows = latest
            .windows
            .iter()
            .filter(|w| w.resets_at.is_none_or(|time| time > now))
            .cloned()
            .collect();
    }
    // Keep separate executions; estimates restart on resume/clear and are not summed.
    provider.sessions = samples
        .into_iter()
        .take(50)
        .filter_map(|s| s.session)
        .collect();
    Ok(provider)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn grant() -> CaptureGrant {
        CaptureGrant {
            project_id: Some("p1".into()),
            created_at: 1,
        }
    }

    #[test]
    fn missing_and_expired_windows_are_removed_and_zero_is_valid() {
        let value = json!({"session_id":"11111111-1111-4111-8111-111111111111", "rate_limits":{
            "five_hour":{"used_percentage":55,"resets_at":99},
            "seven_day":{"used_percentage":0,"resets_at":200},
            "spend_limit":{"used_percentage":103.5}
        }, "cost":{"total_cost_usd":0.125}, "context_window":{"used_percentage":null}});
        let parsed = parse(&value, &grant(), 100);
        assert_eq!(parsed.windows.len(), 2);
        assert_eq!(parsed.windows[0].used_percent, 0.0);
        assert_eq!(parsed.windows[1].used_percent, 103.5);
        assert_eq!(parsed.session.unwrap().estimated_cost_usd, Some(0.125));
        assert!(parse(&json!({}), &grant(), 100).windows.is_empty());
    }

    #[test]
    fn rejects_path_injection_and_discards_unrelated_payload_data() {
        assert!(validate_id("../../auth.json").is_err());
        let value = parse(
            &json!({"session_id":"11111111-1111-4111-8111-111111111111","prompt":"secret","transcript_path":"/private/transcript"}),
            &grant(),
            100,
        );
        let serialized = serde_json::to_string(&value).unwrap();
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("transcript"));
    }
}
