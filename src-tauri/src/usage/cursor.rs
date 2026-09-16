use super::types::{short_string, ProviderUsage, UsageTurn};
use crate::config_paths::{read_json, write_json_atomic};
use crate::error::{AppError, AppResult};
use crate::pty::{PtyKind, PtySpawnSpec};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;

pub const HELPER_FLAG: &str = "--metacodex-usage-cursor";
const MAX_PAYLOAD: u64 = 4 * 1024 * 1024;
const RETENTION: i64 = 90 * 86400;

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Grant {
    project_id: Option<String>,
    created_at: i64,
}

fn dir() -> AppResult<std::path::PathBuf> {
    Ok(super::root()?.join("cursor"))
}

fn uuid(value: &str) -> AppResult<String> {
    uuid::Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| AppError::InvalidArgument("invalid usage identifier".into()))
}

/// Installs a per-launch plugin in app-owned state. Cursor keeps its own login,
/// settings and hooks. No user or project configuration file is changed.
pub fn decorate(spec: &mut PtySpawnSpec) -> AppResult<()> {
    if spec.cli_id.as_deref() != Some("cursor-cli") || !super::options()?.cursor_enabled {
        return Ok(());
    }
    let PtyKind::Cli {
        args, environment, ..
    } = &mut spec.kind
    else {
        return Ok(());
    };
    let id = uuid::Uuid::new_v4().to_string();
    let plugin = dir()?.join(&id);
    let exe = std::env::current_exe()?.to_string_lossy().into_owned();
    #[cfg(windows)]
    let command = format!("\"{exe}\" {HELPER_FLAG} {id}");
    #[cfg(not(windows))]
    let command = format!("'{}' {HELPER_FLAG} {id}", exe.replace('\'', "'\\''"));
    write_json_atomic(
        &plugin.join(".cursor-plugin/plugin.json"),
        &json!({
            "name":"metacodex-usage", "version":"1.0.0",
            "hooks":{"hooks":{"afterAgentResponse":[{"command":command}]}}
        }),
    )?;
    write_json_atomic(
        &dir()?.join(format!("{id}.grant.json")),
        &Grant {
            project_id: spec.project_id.clone(),
            created_at: chrono::Utc::now().timestamp(),
        },
    )?;
    args.extend(["--plugin-dir".into(), plugin.to_string_lossy().into_owned()]);
    environment.insert(
        "METACODEX_HOME".into(),
        crate::config_paths::config_root()?
            .to_string_lossy()
            .into_owned(),
    );
    Ok(())
}

fn counter(value: Option<&Value>) -> Option<String> {
    let value = value?;
    // The installed CLI converts protobuf counters to JS numbers. Reject an
    // already imprecise numeric counter; strings can represent the full u64.
    if let Some(number) = value.as_u64().filter(|n| *n <= 9_007_199_254_740_991) {
        return Some(number.to_string());
    }
    value
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .map(|n| n.to_string())
}

fn parse(payload: &Value, grant: &Grant, now: i64) -> AppResult<UsageTurn> {
    if payload
        .get("hook_event_name")
        .and_then(Value::as_str)
        .is_some_and(|name| name != "afterAgentResponse")
    {
        return Err(AppError::InvalidArgument("unexpected usage event".into()));
    }
    let turn = UsageTurn {
        session_id: uuid(
            payload
                .get("conversation_id")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )?,
        generation_id: uuid(
            payload
                .get("generation_id")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )?,
        project_id: grant.project_id.clone(),
        model: short_string(payload.get("model")),
        input_tokens: counter(payload.get("input_tokens")),
        output_tokens: counter(payload.get("output_tokens")),
        cache_read_tokens: counter(payload.get("cache_read_tokens")),
        cache_write_tokens: counter(payload.get("cache_write_tokens")),
        observed_at: now,
    };
    if [
        &turn.input_tokens,
        &turn.output_tokens,
        &turn.cache_read_tokens,
        &turn.cache_write_tokens,
    ]
    .iter()
    .all(|v| v.is_none())
    {
        return Err(AppError::InvalidArgument("missing usage counters".into()));
    }
    Ok(turn)
}

/// Cursor sends response text as well as counters. Only this whitelist survives.
/// Empty stdout is intentional: the hook must not add context or follow-ups.
pub fn run_helper(id: &str) {
    let _ = (|| -> AppResult<()> {
        let id = uuid(id)?;
        if !super::options()?.cursor_enabled {
            return Ok(());
        }
        let path = dir()?.join(format!("{id}.grant.json"));
        let meta = std::fs::symlink_metadata(&path)?;
        if !meta.is_file() || meta.len() > 4096 {
            return Err(AppError::PermissionDenied("invalid usage grant".into()));
        }
        let grant: Grant = read_json(&path)?;
        let now = chrono::Utc::now().timestamp();
        if grant.created_at <= 0 || now - grant.created_at > RETENTION {
            return Err(AppError::PermissionDenied("expired usage grant".into()));
        }
        let mut bytes = vec![];
        std::io::stdin()
            .take(MAX_PAYLOAD + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_PAYLOAD {
            return Err(AppError::FileTooLarge("usage payload".into()));
        }
        let payload: Value = serde_json::from_slice(&bytes)
            .map_err(|_| AppError::InvalidArgument("usage payload".into()))?;
        let turn = parse(&payload, &grant, now)?;
        // A generation is one user turn. Replayed hooks replace the same file,
        // including when a conversation is resumed in a different app tab.
        write_json_atomic(
            &dir()?.join(format!(
                "{}.{}.turn.json",
                turn.session_id, turn.generation_id
            )),
            &turn,
        )
    })();
}

pub fn snapshot(enabled: bool) -> AppResult<ProviderUsage> {
    let mut provider =
        ProviderUsage::empty("cursor-cli", if enabled { "waiting" } else { "disabled" });
    if !enabled {
        return Ok(provider);
    }
    let entries = match std::fs::read_dir(dir()?) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(provider),
        Err(e) => return Err(e.into()),
    };
    let now = chrono::Utc::now().timestamp();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(id) = name.strip_suffix(".grant.json") {
            if uuid(id).is_err() {
                continue;
            }
            let Ok(meta) = std::fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if !meta.is_file() || meta.len() > 4096 {
                continue;
            }
            let Ok(grant) = read_json::<Grant>(&entry.path()) else {
                continue;
            };
            if now - grant.created_at > RETENTION {
                let _ = std::fs::remove_file(entry.path());
                let plugin = dir()?.join(id);
                // Only remove the two generated files, never an arbitrary tree.
                let _ = std::fs::remove_file(plugin.join(".cursor-plugin/plugin.json"));
                let _ = std::fs::remove_dir(plugin.join(".cursor-plugin"));
                let _ = std::fs::remove_dir(plugin);
            }
            continue;
        }
        if !name.ends_with(".turn.json") {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !meta.is_file() || meta.len() > 8192 {
            continue;
        }
        let Ok(turn) = read_json::<Option<UsageTurn>>(&entry.path()) else {
            continue;
        };
        let Some(turn) = turn else { continue };
        if uuid(&turn.session_id).is_err() || uuid(&turn.generation_id).is_err() {
            continue;
        }
        if now - turn.observed_at > RETENTION {
            let _ = std::fs::remove_file(entry.path());
            continue;
        }
        provider.turns.push(turn);
    }
    provider
        .turns
        .sort_by_key(|t| std::cmp::Reverse(t.observed_at));
    // Bound the IPC/UI payload independently of the on-disk retention period.
    provider.turns.truncate(500);
    if let Some(latest) = provider.turns.first() {
        provider.observed_at = Some(latest.observed_at);
        provider.status = "partial".into();
        provider.issue = Some("localTurns".into());
    }
    Ok(provider)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_ids_and_metrics_and_keeps_missing_distinct_from_zero() {
        let base = json!({"conversation_id":uuid::Uuid::new_v4(), "generation_id":uuid::Uuid::new_v4(), "input_tokens":0, "text":"private response", "cache_read_tokens":-1});
        let turn = parse(&base, &Grant::default(), 123).unwrap();
        assert_eq!(turn.input_tokens.as_deref(), Some("0"));
        assert_eq!(turn.output_tokens, None);
        assert_eq!(turn.cache_read_tokens, None);
        assert!(!serde_json::to_string(&turn)
            .unwrap()
            .contains("private response"));
        assert!(parse(&json!({"input_tokens":3}), &Grant::default(), 123).is_err());
        assert_eq!(counter(Some(&json!(9007199254740993_u64))), None);
        assert_eq!(
            counter(Some(&json!("9007199254740993"))).as_deref(),
            Some("9007199254740993")
        );
    }
}
