use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

use super::types::{finite_number, short_string, DailyUsage, ProviderUsage, QuotaWindow};
use crate::commands::cli::cli_detect;

const MAX_FRAME: u64 = 1024 * 1024;

pub fn normalize(account: &Value, limits: &Value, activity: &Value, now: i64) -> ProviderUsage {
    let mut result = ProviderUsage::empty("codex-cli", "ready");
    result.account_label = short_string(account.pointer("/account/email"));
    result.plan = short_string(account.pointer("/account/planType"));
    result.observed_at = Some(now);
    // The legacy payload mirrors a bucket. Never count both representations.
    let buckets: Vec<(String, &Value)> = match limits
        .get("rateLimitsByLimitId")
        .and_then(Value::as_object)
    {
        Some(values) if !values.is_empty() => values.iter().map(|(k, v)| (k.clone(), v)).collect(),
        _ => limits
            .get("rateLimits")
            .filter(|v| v.is_object())
            .map(|v| {
                vec![(
                    short_string(v.get("limitId")).unwrap_or_else(|| "codex".into()),
                    v,
                )]
            })
            .unwrap_or_default(),
    };
    for (bucket_id, bucket) in buckets {
        for name in ["primary", "secondary"] {
            let Some(window) = bucket.get(name) else {
                continue;
            };
            let Some(used) = finite_number(window.get("usedPercent")) else {
                continue;
            };
            result.windows.push(QuotaWindow {
                id: format!("{bucket_id}:{name}"),
                label: short_string(bucket.get("limitName")),
                used_percent: used,
                duration_minutes: window.get("windowDurationMins").and_then(Value::as_u64),
                resets_at: window.get("resetsAt").and_then(Value::as_i64),
            });
        }
    }
    if let Some(days) = activity.get("dailyUsageBuckets").and_then(Value::as_array) {
        for day in days {
            if let (Some(date), Some(tokens)) = (
                day.get("startDate").and_then(Value::as_str),
                day.get("tokens").and_then(Value::as_u64),
            ) {
                if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok() {
                    result.daily_usage.push(DailyUsage {
                        date: date.into(),
                        tokens: tokens.to_string(),
                    });
                }
            }
        }
    }
    result.daily_usage.sort_by(|a, b| a.date.cmp(&b.date));
    result.daily_usage.dedup_by(|a, b| a.date == b.date);
    let trim = result.daily_usage.len().saturating_sub(90);
    result.daily_usage.drain(..trim);
    if result.windows.is_empty() {
        result.status = "partial".into();
        result.issue = Some("noQuota".into());
    }
    result
}

struct Rpc {
    input: tokio::process::ChildStdin,
    output: BufReader<tokio::process::ChildStdout>,
    next_id: u32,
}

impl Rpc {
    async fn send(&mut self, value: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&value).map_err(|_| "protocol")?;
        bytes.push(b'\n');
        self.input
            .write_all(&bytes)
            .await
            .map_err(|_| "protocol".into())
    }

    async fn read_result(&mut self, id: u32) -> Result<Value, String> {
        loop {
            let mut frame = Vec::new();
            let n = (&mut self.output)
                .take(MAX_FRAME + 1)
                .read_until(b'\n', &mut frame)
                .await
                .map_err(|_| "protocol")?;
            if n == 0 || n as u64 > MAX_FRAME {
                return Err("protocol".into());
            }
            let value: Value = serde_json::from_slice(&frame).map_err(|_| "protocol")?;
            if value.get("id").and_then(Value::as_u64) != Some(id as u64) {
                continue;
            }
            if value.get("error").is_some() {
                return Err("unavailable".into());
            }
            return value
                .get("result")
                .cloned()
                .ok_or_else(|| "protocol".into());
        }
    }

    async fn request(&mut self, method: &str, params: Option<Value>) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        let mut request = json!({"id": id, "method": method});
        if let Some(params) = params {
            request["params"] = params;
        }
        self.send(request).await?;
        tokio::time::timeout(Duration::from_secs(8), self.read_result(id))
            .await
            .map_err(|_| "timeout")?
    }
}

pub async fn fetch() -> Result<ProviderUsage, String> {
    let detected = cli_detect("codex".into()).await.map_err(|_| "detection")?;
    let Some(path) = detected.path else {
        return Ok(ProviderUsage::empty("codex-cli", "notInstalled"));
    };
    // No prompts, turns, login, resets, or mutations are sent to this client.
    let mut command = tokio::process::Command::new(&path);
    #[cfg(windows)]
    {
        if !path.to_lowercase().ends_with(".exe") {
            let (shell, _) = crate::pty::shell::detect_login_shell();
            if !shell.to_lowercase().contains("powershell")
                && !shell.to_lowercase().contains("pwsh")
            {
                return Err("unavailable".into());
            }
            command = tokio::process::Command::new(shell);
            command.args([
                "-NoLogo",
                "-NonInteractive",
                "-Command",
                &format!(
                    "& '{}' app-server --listen stdio://",
                    path.replace('\'', "''")
                ),
            ]);
        } else {
            command.args(["app-server", "--listen", "stdio://"]);
        }
        command.creation_flags(0x08000000);
    }
    #[cfg(not(windows))]
    command.args(["app-server", "--listen", "stdio://"]);
    // App-owned working directory avoids loading an unrelated project's config.
    command.current_dir(crate::config_paths::config_root().map_err(|_| "storage")?);
    command
        .envs(detected.environment)
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| "unavailable")?;
    let mut rpc = Rpc {
        input: child.stdin.take().ok_or("protocol")?,
        output: BufReader::new(child.stdout.take().ok_or("protocol")?),
        next_id: 0,
    };
    let result = async {
        rpc.request("initialize", Some(json!({"clientInfo":{"name":"metacodex_usage","version":"1.0.0"},"capabilities":{}}))).await?;
        rpc.send(json!({"method":"initialized"})).await?;
        let account = rpc.request("account/read", Some(json!({"refreshToken":false}))).await?;
        if account.get("account").is_none_or(Value::is_null) {
            return Ok(ProviderUsage::empty("codex-cli", "signedOut"));
        }
        let limits = rpc.request("account/rateLimits/read", None).await;
        let activity = rpc.request("account/usage/read", None).await;
        if limits.is_err() && activity.is_err() {
            return Err("unavailable".into());
        }
        Ok(normalize(&account, &limits.unwrap_or(Value::Null), &activity.unwrap_or(Value::Null), chrono::Utc::now().timestamp()))
    }.await;
    drop(rpc);
    let _ = child.kill().await;
    let _ = child.wait().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "reads the locally authenticated Codex account; run explicitly"]
    async fn installed_codex_read_only_smoke() {
        let result = fetch().await.expect("installed Codex read-only connection");
        assert!(matches!(result.status.as_str(), "ready" | "partial"));
        assert!(result.observed_at.is_some());
        assert!(!result.windows.is_empty(), "authenticated quota windows");
        println!(
            "Codex read-only smoke: {} quota windows, {} history days",
            result.windows.len(),
            result.daily_usage.len()
        );
    }

    #[test]
    fn multi_bucket_does_not_double_count_and_missing_is_not_zero() {
        let result = normalize(
            &json!({}),
            &json!({
                "rateLimits": {"primary":{"usedPercent":40}},
                "rateLimitsByLimitId": {"codex": {"primary":{"usedPercent":40,"windowDurationMins":300,"resetsAt":123},"secondary":null}, "other":{"primary":{"usedPercent":0}}}
            }),
            &json!({}),
            1,
        );
        assert_eq!(result.windows.len(), 2);
        assert_eq!(result.windows[0].duration_minutes, Some(300));
        assert_eq!(result.windows[1].used_percent, 0.0);
    }

    #[test]
    fn validates_history_and_keeps_large_counters_exact() {
        let result = normalize(
            &json!({}),
            &json!({}),
            &json!({"dailyUsageBuckets":[
                {"startDate":"2026-09-01","tokens":9007199254740993_u64},
                {"startDate":"invalid","tokens":5}
            ]}),
            1,
        );
        assert_eq!(result.status, "partial");
        assert!(result.windows.is_empty());
        assert_eq!(result.daily_usage.len(), 1);
        assert_eq!(result.daily_usage[0].tokens, "9007199254740993");
    }
}
