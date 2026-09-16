use super::types::{finite_number, short_string, BillingUsage, ProviderUsage, QuotaWindow};
use crate::commands::cli::cli_detect;
use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

const MAX_FRAME: u64 = 1024 * 1024;

fn timestamp(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|date| date.timestamp())
}

pub(super) fn normalize(value: &Value, now: i64) -> Result<ProviderUsage, String> {
    let config = value
        .get("config")
        .filter(|v| v.is_object())
        .ok_or("protocol")?;
    let mut provider = ProviderUsage::empty("grok", "partial");
    provider.plan = short_string(value.get("subscription_tier"))
        .or_else(|| short_string(value.get("subscriptionTier")))
        .or_else(|| short_string(config.get("subscriptionTier")));
    provider.observed_at = Some(now);
    provider.issue = Some("noQuota".into());
    let period_start = timestamp(config.get("billingPeriodStart"));
    let period_end = timestamp(config.get("billingPeriodEnd"));
    let usage_period_start = timestamp(config.pointer("/currentPeriod/start"));
    let usage_period_end = timestamp(config.pointer("/currentPeriod/end"));
    provider.billing = Some(BillingUsage {
        period_start,
        period_end,
        usage_period_start,
        usage_period_end,
    });
    if let Some(used_percent) = finite_number(config.get("creditUsagePercent")) {
        provider.windows.push(QuotaWindow {
            id: "grok_credits".into(),
            used_percent,
            resets_at: usage_period_end.or(period_end),
            duration_minutes: usage_period_start
                .zip(usage_period_end)
                .filter(|(s, e)| e > s)
                .map(|(s, e)| ((e - s) / 60) as u64),
            ..Default::default()
        });
        provider.status = "ready".into();
        provider.issue = None;
    }
    // Absolute credit balances have no verified currency unit.
    Ok(provider)
}

async fn request(
    input: &mut tokio::process::ChildStdin,
    output: &mut BufReader<tokio::process::ChildStdout>,
    id: u32,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let mut frame =
        serde_json::to_vec(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .map_err(|_| "protocol")?;
    frame.push(b'\n');
    input.write_all(&frame).await.map_err(|_| "protocol")?;
    tokio::time::timeout(Duration::from_secs(12), async {
        loop {
            let mut bytes = vec![];
            let size = (&mut *output)
                .take(MAX_FRAME + 1)
                .read_until(b'\n', &mut bytes)
                .await
                .map_err(|_| "protocol")?;
            if size == 0 || size as u64 > MAX_FRAME {
                return Err("protocol".into());
            }
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| "protocol")?;
            if value.get("id").and_then(Value::as_u64) != Some(id as u64) {
                continue;
            }
            if let Some(error) = value.get("error") {
                return Err(match error.get("code").and_then(Value::as_i64) {
                    Some(-32000) => "signedOut",
                    Some(-32601) => "unsupported",
                    _ => "unavailable",
                }
                .into());
            }
            return value
                .get("result")
                .cloned()
                .ok_or_else(|| "protocol".into());
        }
    })
    .await
    .map_err(|_| "timeout")?
}

/// Grok 1.0.13 exposes personal billing through its ACP extension. This is a
/// version-dependent CLI contract, not a public xAI Management API endpoint.
pub async fn fetch() -> Result<ProviderUsage, String> {
    let detected = cli_detect("grok".into()).await.map_err(|_| "detection")?;
    let Some(path) = detected.path else {
        return Ok(ProviderUsage::empty("grok", "notInstalled"));
    };
    let mut command = tokio::process::Command::new(path);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    // No session, prompt, auto-update or leader process is started. Authentication
    // is delegated to the CLI's existing cached login in headless mode.
    command
        .args(["--no-auto-update", "agent", "--no-leader", "stdio"])
        .envs(detected.environment)
        .current_dir(crate::config_paths::config_root().map_err(|_| "storage")?)
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| "unavailable")?;
    let mut input = child.stdin.take().ok_or("protocol")?;
    let mut output = BufReader::new(child.stdout.take().ok_or("protocol")?);
    let result = async {
        request(&mut input, &mut output, 1, "initialize", json!({
            "protocolVersion":1, "clientInfo":{"name":"metacodex-usage","version":"1.0.0"}, "clientCapabilities":{}
        })).await?;
        request(&mut input, &mut output, 2, "authenticate", json!({"methodId":"cached_token", "_meta":{"headless":true}})).await?;
        let billing = request(&mut input, &mut output, 3, "_x.ai/billing", json!({})).await?;
        normalize(&billing, chrono::Utc::now().timestamp())
    }.await;
    drop(input);
    drop(output);
    let _ = child.kill().await;
    let _ = child.wait().await;
    match result {
        Err(issue) if issue == "signedOut" || issue == "unsupported" => {
            Ok(ProviderUsage::empty("grok", &issue))
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn personal_billing_keeps_missing_allowance_distinct_from_zero_balance() {
        let value = json!({"config":{
            "currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","start":"2026-09-24T00:00:00Z","end":"2026-10-01T00:00:00Z"},
            "onDemandCap":{"val":0},"onDemandUsed":{"val":0},"prepaidBalance":{"val":0},
            "isUnifiedBillingUser":true
        },"subscription_tier":"fixture-plan"});
        let result = normalize(&value, 10).unwrap();
        assert_eq!(result.status, "partial");
        assert!(result.windows.is_empty());
        let billing = result.billing.unwrap();
        assert_eq!(billing.period_end, None);
        assert_eq!(billing.usage_period_end, Some(1790812800));
        assert!(normalize(&json!({}), 10).is_err());
        let result = normalize(
            &json!({"config":{"creditUsagePercent":37,"prepaidBalance":{"val":-1}}}),
            10,
        )
        .unwrap();
        assert_eq!(result.windows[0].used_percent, 37.0);
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains("prepaidBalance"));
    }

    #[tokio::test]
    #[ignore = "reads the locally authenticated Grok account; run explicitly"]
    async fn installed_grok_read_only_smoke() {
        let provider = fetch().await.expect("installed Grok connection");
        assert!(matches!(provider.status.as_str(), "ready" | "partial"));
        assert!(provider.billing.is_some());
        println!(
            "Grok read-only smoke: billing present, {} quota windows",
            provider.windows.len()
        );
    }
}
