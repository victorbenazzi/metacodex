// Protocol mapping informed by CodexBar (MIT). See docs/third-party-notices.md.
use super::{
    account_auth::Credential,
    account_http as http,
    types::{AccountUsage, ProviderUsage, QuotaWindow},
};

pub async fn fetch(credential: &Credential) -> Result<ProviderUsage, String> {
    let client = http::client()?;
    let now = chrono::Utc::now().timestamp();
    let billing = http::json(
        client
            .get("https://cli-chat-proxy.grok.com/v1/billing?format=credits")
            .header("Authorization", &credential.header)
            .header("x-xai-token-auth", "xai-grok-cli")
            .header("Accept", "application/json")
            .send()
            .await,
    )
    .await?;
    let mut result = super::grok::normalize(&billing, now)?;
    result.account_label = credential.label.clone();
    result.account = Some(AccountUsage::default());
    if result.windows.is_empty() {
        let response = tokio::time::timeout(std::time::Duration::from_secs(6), async {
            let bytes = http::bytes(
                client
                    .post("https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig")
                    .header("Authorization", &credential.header)
                    .header("Content-Type", "application/grpc-web+proto")
                    .header("x-grpc-web", "1")
                    .header("x-user-agent", "connect-es/2.1.1")
                    .header("Origin", "https://grok.com")
                    .header("Referer", "https://grok.com/?_s=usage")
                    .body(vec![0u8; 5])
                    .send()
                    .await,
            )
            .await?;
            parse(&bytes, now)
        })
        .await;
        if let Ok(Ok(window)) = response {
            result.windows.push(window);
            result.status = "ready".into();
            result.issue = None;
        }
        // A failed optional enrichment never removes valid proxy billing dates.
    }
    Ok(result)
}

#[derive(Default)]
struct Scan {
    floats: Vec<(Vec<u64>, f64)>,
    integers: Vec<(Vec<u64>, u64)>,
}
fn varint(bytes: &[u8], index: &mut usize) -> Result<u64, String> {
    let mut value = 0;
    for shift in (0..=63).step_by(7) {
        let byte = *bytes.get(*index).ok_or("protocol")?;
        *index += 1;
        if shift == 63 && byte > 1 {
            return Err("protocol".into());
        }
        value |= ((byte & 127) as u64) << shift;
        if byte & 128 == 0 {
            return Ok(value);
        }
    }
    Err("protocol".into())
}
fn known(path: &[u64]) -> bool {
    matches!(
        path,
        [1] | [1, 2]
            | [1, 3]
            | [1, 4]
            | [1, 5]
            | [1, 6]
            | [1, 7]
            | [1, 8]
            | [1, 12]
            | [1, 6, 1]
            | [1, 6, 2]
            | [1, 6, 3]
            | [1, 8, 2]
            | [1, 8, 3]
            | [1, 6, 3, 2]
            | [1, 6, 3, 3]
    )
}
fn scan(bytes: &[u8], path: &[u64], result: &mut Scan) -> Result<(), String> {
    let mut i = 0;
    while i < bytes.len() {
        let tag = varint(bytes, &mut i)?;
        let field = tag >> 3;
        if field == 0 || field > 536_870_911 {
            return Err("protocol".into());
        }
        let mut next = path.to_vec();
        next.push(field);
        match tag & 7 {
            0 => result.integers.push((next, varint(bytes, &mut i)?)),
            1 => {
                bytes.get(i..i + 8).ok_or("protocol")?;
                i += 8;
            }
            2 => {
                let length = usize::try_from(varint(bytes, &mut i)?).map_err(|_| "protocol")?;
                let end = i.checked_add(length).ok_or("protocol")?;
                let nested = bytes.get(i..end).ok_or("protocol")?;
                if path.len() < 4 && known(&next) {
                    scan(nested, &next, result)?;
                }
                i = end;
            }
            5 => {
                let bits: [u8; 4] = bytes
                    .get(i..i + 4)
                    .ok_or("protocol")?
                    .try_into()
                    .map_err(|_| "protocol")?;
                i += 4;
                result.floats.push((next, f32::from_le_bytes(bits) as f64));
            }
            _ => return Err("protocol".into()),
        }
    }
    Ok(())
}

fn parse(bytes: &[u8], now: i64) -> Result<QuotaWindow, String> {
    let mut index = 0;
    let mut payloads = Vec::new();
    let mut success = false;
    while index < bytes.len() {
        let header = bytes.get(index..index + 5).ok_or("protocol")?;
        if header[0] != 0 && header[0] != 128 {
            return Err("protocol".into());
        }
        let len = u32::from_be_bytes(header[1..5].try_into().unwrap()) as usize;
        index += 5;
        let end = index.checked_add(len).ok_or("protocol")?;
        let payload = bytes.get(index..end).ok_or("protocol")?;
        if header[0] == 128 {
            for line in std::str::from_utf8(payload)
                .map_err(|_| "protocol")?
                .lines()
            {
                if let Some((key, value)) = line.split_once(':') {
                    if key.trim().eq_ignore_ascii_case("grpc-status") {
                        if value.trim() != "0" {
                            return Err("unavailable".into());
                        }
                        success = true;
                    }
                }
            }
        } else {
            payloads.push(payload);
        }
        index = end;
    }
    // Unary method: require one complete data frame plus a successful trailer.
    if payloads.len() != 1 || !success {
        return Err("protocol".into());
    }
    let mut result = Scan::default();
    scan(payloads[0], &[], &mut result)?;
    let scalar = |path: &[u64]| {
        result
            .integers
            .iter()
            .find(|(p, _)| p == path)
            .map(|(_, v)| *v)
    };
    let timestamp = |path: &[u64]| {
        scalar(path)
            .filter(|v| (1_700_000_000..=2_100_000_000).contains(v))
            .map(|v| v as i64)
    };
    let start = timestamp(&[1, 8, 2, 1]);
    let end = timestamp(&[1, 8, 3, 1]);
    let reset = end.or_else(|| timestamp(&[1, 5, 1]));
    // Do not interpret opaque bytes or historical nested spending as a percent.
    let published = result
        .floats
        .iter()
        .find(|(p, _)| p == &[1, 1])
        .map(|(_, v)| *v)
        .filter(|v| v.is_finite() && (0.0..=100.0).contains(v));
    let implicit_zero = result.floats.is_empty()
        && matches!(scalar(&[1, 8, 1]), Some(1 | 2))
        && start.is_some_and(|s| s <= now)
        && end.is_some_and(|e| e > now);
    let used_percent = published
        .or(if implicit_zero { Some(0.0) } else { None })
        .ok_or("noQuota")?;
    Ok(QuotaWindow {
        id: "grok_credits".into(),
        used_percent,
        resets_at: reset,
        duration_minutes: start
            .zip(end)
            .filter(|(s, e)| e > s)
            .map(|(s, e)| ((e - s) / 60) as u64),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame(payload: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0];
        bytes.extend((payload.len() as u32).to_be_bytes());
        bytes.extend(payload);
        bytes.extend([128, 0, 0, 0, 15]);
        bytes.extend(b"grpc-status:0\r\n");
        bytes
    }
    #[test]
    fn published_percentage_trailers_and_truncation() {
        let mut payload = vec![10, 5, 13];
        payload.extend(37f32.to_le_bytes());
        assert_eq!(parse(&frame(&payload), 1).unwrap().used_percent, 37.0);
        let mut failed = frame(&payload);
        let len = failed.len();
        failed[len - 3] = b'7';
        assert!(parse(&failed, 1).is_err());
        assert!(parse(&frame(&payload)[..10], 1).is_err());
        assert!(parse(&frame(&[10, 2, 13, 0]), 1).is_err());
        assert!(parse(&frame(&[10, 0]), 1).is_err());
    }
    #[test]
    fn proven_active_zero_is_not_missing_or_expired_usage() {
        // Public CodexBar regression fixture, no account identifiers.
        let hex = "0a4212001a00220b0887a8c6d40610f0d7dd142a0b08879debd40610f0d7dd14421c0802120b0887a8c6d40610f0d7dd141a0b08879debd40610f0d7dd14580162006801";
        let payload: Vec<u8> = (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect();
        let p = parse(&frame(&payload), 1_788_000_000).unwrap();
        assert_eq!(p.used_percent, 0.0);
        assert!(parse(&frame(&payload), 2_000_000_000).is_err());
        let mut malformed = payload.clone();
        malformed.push(0);
        assert!(parse(&frame(&malformed), 1_788_000_000).is_err());
        let mut opaque = payload;
        opaque.extend([114, 5, 13, 0, 0, 20, 66]);
        assert_eq!(
            parse(&frame(&opaque), 1_788_000_000).unwrap().used_percent,
            0.0
        );
    }
}

#[cfg(test)]
mod live_tests {
    #[tokio::test]
    #[ignore = "explicit read-only check of the locally authenticated Grok account"]
    async fn installed_grok_account_smoke() {
        use crate::usage::account_auth::{default_directory, AccountGrant};
        let path = default_directory("grok").unwrap().join("auth.json");
        let grant = AccountGrant::from_picker(path, "grok").expect("local account file");
        let credential = grant
            .read("grok")
            .unwrap_or_else(|issue| panic!("credential status: {issue}"));
        let value = super::fetch(&credential)
            .await
            .unwrap_or_else(|issue| panic!("account status: {issue}"));
        assert!(value.billing.is_some());
        println!(
            "Grok account: status={}, quota_windows={}",
            value.status,
            value.windows.len()
        );
    }
}
