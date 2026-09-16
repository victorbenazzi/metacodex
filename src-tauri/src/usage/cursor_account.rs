use super::{
    account_auth::Credential,
    account_http as http,
    types::{short_string, AccountDay, AccountUsage, BillingUsage, ProviderUsage, QuotaWindow},
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn finite_number(value: Option<&Value>) -> Option<f64> {
    let value = value?;
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|v| v.is_finite() && *v >= 0.0)
}

fn percent(plan: &Value) -> Option<f64> {
    finite_number(plan.get("totalPercentUsed")).or_else(|| {
        let used = finite_number(plan.get("used"))?;
        let limit = finite_number(plan.get("limit")).filter(|v| *v > 0.0)?;
        let ratio = used / limit * 100.0;
        ratio.is_finite().then_some(ratio)
    })
}

fn normalize(value: &Value, identity: &Value, now: i64) -> Result<ProviderUsage, String> {
    let plan = value
        .pointer("/individualUsage/plan")
        .filter(|v| v.is_object())
        .ok_or("protocol")?;
    if identity
        .get("sub")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .is_none()
    {
        return Err("protocol".into());
    }
    let mut result = ProviderUsage::empty("cursor-cli", "ready");
    result.account_label = short_string(identity.get("email"));
    result.plan = short_string(value.get("membershipType"));
    result.observed_at = Some(now);
    let reset = http::timestamp(value.get("billingCycleEnd"));
    for (id, used) in [
        ("cursor_plan", percent(plan)),
        ("cursor_auto", finite_number(plan.get("autoPercentUsed"))),
        ("cursor_api", finite_number(plan.get("apiPercentUsed"))),
    ] {
        if let Some(used_percent) = used {
            result.windows.push(QuotaWindow {
                id: id.into(),
                used_percent,
                resets_at: reset,
                ..Default::default()
            });
        }
    }
    result.billing = Some(BillingUsage {
        period_start: http::timestamp(value.get("billingCycleStart")),
        period_end: reset,
        ..Default::default()
    });
    let usd = |v| finite_number(v).map(|n| n / 100.0);
    result.account = Some(AccountUsage {
        included_used_usd: usd(plan.get("used")).or_else(|| usd(plan.pointer("/breakdown/total"))),
        included_limit_usd: usd(plan.get("limit")),
        on_demand_used_usd: usd(value.pointer("/individualUsage/onDemand/used")),
        on_demand_limit_usd: usd(value.pointer("/individualUsage/onDemand/limit")),
        ..Default::default()
    });
    if result.windows.is_empty() {
        result.status = "partial".into();
        result.issue = Some("noQuota".into());
    }
    Ok(result)
}

pub async fn fetch(credential: &Credential) -> Result<ProviderUsage, String> {
    let client = http::client()?;
    let get = |path| {
        client
            .get(format!("https://cursor.com{path}"))
            .header("Cookie", &credential.header)
            .header("Accept", "application/json")
    };
    let (usage, identity) = tokio::join!(
        http::json(get("/api/usage-summary").send().await),
        http::json(get("/api/auth/me").send().await)
    );
    let now = chrono::Utc::now().timestamp();
    let mut result = normalize(&usage?, &identity?, now)?;
    let start = (now - 29 * 86400) / 86400 * 86400;
    let history = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        fetch_history(&client, credential, start, now),
    )
    .await
    .unwrap_or_else(|_| Err("timeout".into()));
    let account = result.account.as_mut().unwrap();
    account.history_start = Some(start);
    account.history_end = Some(now);
    match history {
        Ok(days) => account.history = days,
        Err(issue) if issue == "signedOut" => return Err(issue),
        Err(issue) => {
            account.history_issue = Some(issue);
            result.status = "partial".into();
        }
    }
    Ok(result)
}

fn reconcile(pages: Vec<Vec<Value>>, expected: usize) -> Result<Vec<Value>, String> {
    let received: usize = pages.iter().map(Vec::len).sum();
    if received < expected {
        return Err("incompleteHistory".into());
    }
    let mut excess = received - expected;
    let mut rows = Vec::with_capacity(expected);
    for (index, page) in pages.iter().enumerate() {
        let overlap = if index == 0 {
            0
        } else {
            let prev = &pages[index - 1];
            (1..=prev.len().min(page.len()))
                .rev()
                .find(|&n| prev[prev.len() - n..] == page[..n])
                .unwrap_or(0)
        };
        let skip = overlap.min(excess);
        excess -= skip;
        rows.extend(page[skip..].iter().cloned());
    }
    if excess != 0 || rows.len() != expected {
        return Err("incompleteHistory".into());
    }
    Ok(rows)
}

async fn fetch_history(
    client: &reqwest::Client,
    credential: &Credential,
    start: i64,
    end: i64,
) -> Result<Vec<AccountDay>, String> {
    let mut pages = Vec::new();
    let mut total = None;
    let mut count = 0;
    for page in 1..=200 {
        let response = http::json(client.post("https://cursor.com/api/dashboard/get-filtered-usage-events")
            .header("Cookie", &credential.header).header("Origin", "https://cursor.com").header("Accept", "application/json")
            .json(&json!({"page":page,"pageSize":1000,"startDate":(start*1000).to_string(),"endDate":(end*1000).to_string()})).send().await).await?;
        let object = response.as_object().ok_or("protocol")?;
        if object.is_empty() && page == 1 {
            return Ok(vec![]);
        }
        if object.contains_key("error") || object.contains_key("errors") {
            return Err("protocol".into());
        }
        if let Some(value) = object.get("totalUsageEventsCount") {
            let n = counter(Some(value))
                .filter(|n| *n <= 200000)
                .ok_or("protocol")? as usize;
            if total.is_some_and(|old| old != n) {
                return Err("incompleteHistory".into());
            }
            total = Some(n);
        }
        let rows = match object.get("usageEventsDisplay") {
            Some(rows) => rows.as_array().ok_or("protocol")?.clone(),
            None if total.is_some() && object.len() == 1 => vec![],
            _ => return Err("incompleteHistory".into()),
        };
        if rows.len() > 1000 {
            return Err("protocol".into());
        }
        let last = rows.len() < 1000;
        count += rows.len();
        pages.push(rows);
        if last {
            // Without an authoritative count only a short final page proves coverage.
            let expected = total.unwrap_or(count);
            return aggregate(reconcile(pages, expected)?, start, end);
        }
    }
    Err("incompleteHistory".into())
}

fn counter(value: Option<&Value>) -> Option<u64> {
    match value? {
        Value::String(s) => s.parse().ok(),
        v => v.as_u64().filter(|n| *n <= 9_007_199_254_740_991),
    }
}

fn aggregate(rows: Vec<Value>, start: i64, end: i64) -> Result<Vec<AccountDay>, String> {
    let mut days: BTreeMap<String, AccountDay> = BTreeMap::new();
    for row in rows {
        let millis = row
            .get("timestamp")
            .and_then(|v| {
                v.as_str()
                    .and_then(|s| s.parse::<i64>().ok())
                    .or_else(|| v.as_i64())
            })
            .ok_or("protocol")?;
        let seconds = millis / 1000;
        if seconds < start || seconds > end {
            return Err("incompleteHistory".into());
        }
        let date = chrono::DateTime::from_timestamp(seconds, 0)
            .ok_or("protocol")?
            .format("%Y-%m-%d")
            .to_string();
        let day = days.entry(date.clone()).or_insert_with(|| AccountDay {
            date,
            tokens: Some("0".into()),
            api_cost_usd: Some(0.0),
            charged_usd: Some(0.0),
            ..Default::default()
        });
        day.requests += 1;
        let tokens = [
            "inputTokens",
            "outputTokens",
            "cacheReadTokens",
            "cacheWriteTokens",
        ]
        .iter()
        .try_fold(0u64, |sum, key| {
            sum.checked_add(counter(row.get("tokenUsage").and_then(|v| v.get(key)))?)
        });
        day.tokens = day
            .tokens
            .as_ref()
            .and_then(|s| s.parse::<u128>().ok())
            .zip(tokens)
            .and_then(|(a, b)| a.checked_add(b as u128))
            .map(|n| n.to_string());
        day.api_cost_usd = day
            .api_cost_usd
            .zip(finite_number(row.pointer("/tokenUsage/totalCents")))
            .map(|(a, b)| a + b / 100.0)
            .filter(|n| n.is_finite());
        day.charged_usd = day
            .charged_usd
            .zip(finite_number(row.get("chargedCents")))
            .map(|(a, b)| a + b / 100.0)
            .filter(|n| n.is_finite());
    }
    Ok(days.into_values().rev().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn percentages_are_already_percent_and_costs_are_cents() {
        let value = json!({"individualUsage":{"plan":{"totalPercentUsed":0.36,"used":500,"limit":2000,"breakdown":{"total":500}},"onDemand":{"used":25}}});
        let result = normalize(&value, &json!({"sub":"fixture"}), 10).unwrap();
        assert_eq!(result.windows[0].used_percent, 0.36);
        assert_eq!(result.account.unwrap().included_used_usd, Some(5.0));
        assert_eq!(percent(&json!({"breakdown":{"total":300}})), None);
        assert_eq!(percent(&json!({"used":5,"limit":0})), None);
        assert_eq!(percent(&json!({"used":5,"limit":20})), Some(25.0));
    }
    #[test]
    fn pagination_keeps_identical_real_requests_and_rejects_partial_totals() {
        let a = json!({"timestamp":"10000"});
        let b = json!({"timestamp":"11000"});
        assert_eq!(
            reconcile(vec![vec![a.clone(), b.clone()], vec![b.clone()]], 3)
                .unwrap()
                .len(),
            3
        );
        assert_eq!(
            reconcile(vec![vec![a.clone(), b.clone()], vec![b]], 2)
                .unwrap()
                .len(),
            2
        );
        assert!(reconcile(vec![vec![a]], 3).is_err());
    }
    #[test]
    fn history_distinguishes_api_equivalent_from_charge_and_missing_counters() {
        let rows = vec![
            json!({"timestamp":"10000","tokenUsage":{"inputTokens":1,"outputTokens":2,"cacheReadTokens":3,"cacheWriteTokens":4,"totalCents":8},"chargedCents":2}),
        ];
        let day = aggregate(rows, 0, 20).unwrap().remove(0);
        assert_eq!(day.tokens.as_deref(), Some("10"));
        assert_eq!(day.api_cost_usd, Some(0.08));
        assert_eq!(day.charged_usd, Some(0.02));
        let day = aggregate(vec![json!({"timestamp":"10000"})], 0, 20)
            .unwrap()
            .remove(0);
        assert_eq!(day.tokens, None);
        assert_eq!(day.charged_usd, None);
    }
}

#[cfg(test)]
mod live_tests {
    #[tokio::test]
    #[ignore = "explicit read-only check of the locally authenticated Cursor account"]
    async fn installed_cursor_account_smoke() {
        use crate::usage::account_auth::{default_directory, AccountGrant};
        let path = default_directory("cursor-cli").unwrap().join("state.vscdb");
        let grant = AccountGrant::from_picker(path, "cursor-cli").expect("local account database");
        let credential = grant
            .read("cursor-cli")
            .unwrap_or_else(|issue| panic!("credential status: {issue}"));
        let value = super::fetch(&credential)
            .await
            .unwrap_or_else(|issue| panic!("account status: {issue}"));
        assert!(value.account.is_some());
        let account = value.account.as_ref().unwrap();
        println!(
            "Cursor account: status={}, quota_windows={}, history_days={}, history_issue={}",
            value.status,
            value.windows.len(),
            account.history.len(),
            account.history_issue.as_deref().unwrap_or("none")
        );
    }
}
