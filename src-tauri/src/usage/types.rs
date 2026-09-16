use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub id: String,
    pub label: Option<String>,
    pub used_percent: f64,
    pub duration_minutes: Option<u64>,
    pub resets_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    pub date: String,
    // Decimal strings preserve counters larger than JavaScript's safe integer range.
    pub tokens: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsage {
    pub session_id: String,
    pub project_id: Option<String>,
    pub model: Option<String>,
    pub estimated_cost_usd: Option<f64>,
    pub context_used_percent: Option<f64>,
    pub observed_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTurn {
    pub session_id: String,
    pub generation_id: String,
    pub project_id: Option<String>,
    pub model: Option<String>,
    pub input_tokens: Option<String>,
    pub output_tokens: Option<String>,
    pub cache_read_tokens: Option<String>,
    pub cache_write_tokens: Option<String>,
    pub observed_at: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingUsage {
    pub period_start: Option<i64>,
    pub period_end: Option<i64>,
    pub usage_period_start: Option<i64>,
    pub usage_period_end: Option<i64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDay {
    pub date: String,
    pub requests: u64,
    pub tokens: Option<String>,
    pub api_cost_usd: Option<f64>,
    pub charged_usd: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsage {
    pub source: String,
    pub included_used_usd: Option<f64>,
    pub included_limit_usd: Option<f64>,
    pub on_demand_used_usd: Option<f64>,
    pub on_demand_limit_usd: Option<f64>,
    pub history: Vec<AccountDay>,
    pub history_start: Option<i64>,
    pub history_end: Option<i64>,
    pub history_issue: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    pub id: String,
    pub status: String,
    pub account_label: Option<String>,
    pub plan: Option<String>,
    pub observed_at: Option<i64>,
    pub windows: Vec<QuotaWindow>,
    pub daily_usage: Vec<DailyUsage>,
    pub sessions: Vec<SessionUsage>,
    #[serde(default)]
    pub turns: Vec<UsageTurn>,
    #[serde(default)]
    pub billing: Option<BillingUsage>,
    #[serde(default)]
    pub account: Option<AccountUsage>,
    pub issue: Option<String>,
}

impl ProviderUsage {
    pub fn empty(id: &str, status: &str) -> Self {
        Self {
            id: id.into(),
            status: status.into(),
            account_label: None,
            plan: None,
            observed_at: None,
            windows: vec![],
            daily_usage: vec![],
            sessions: vec![],
            turns: vec![],
            billing: None,
            account: None,
            issue: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub providers: Vec<ProviderUsage>,
    pub claude_enabled: bool,
    pub cursor_enabled: bool,
}

pub fn finite_number(value: Option<&serde_json::Value>) -> Option<f64> {
    value
        .and_then(serde_json::Value::as_f64)
        .filter(|n| n.is_finite() && *n >= 0.0)
}

pub fn short_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().filter(|c| !c.is_control()).take(160).collect())
}
