pub(crate) mod account_auth;
mod account_http;
pub mod claude;
mod codex;
pub mod cursor;
mod cursor_account;
mod grok;
mod grok_web;
pub mod types;

use crate::config_paths::{read_json, write_json_atomic};
use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use types::{ProviderUsage, UsageSnapshot};

#[derive(Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UsageOptions {
    pub claude_enabled: bool,
    pub cursor_enabled: bool,
    pub cursor_account: Option<account_auth::AccountGrant>,
    pub grok_account: Option<account_auth::AccountGrant>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageCache {
    schema_version: u32,
    codex: Option<ProviderUsage>,
    grok: Option<ProviderUsage>,
}

#[derive(Default)]
pub struct UsageManager {
    cache: Mutex<Option<UsageCache>>,
    refresh: tokio::sync::Mutex<()>,
    last_attempt: Mutex<Option<std::time::Instant>>,
    accounts: Mutex<std::collections::HashMap<String, AccountCache>>,
    cursor_cookie: Mutex<Option<account_auth::Credential>>,
}

struct AccountCache {
    fingerprint: String,
    value: ProviderUsage,
}
struct AccountInput {
    source: &'static str,
    credential: Result<account_auth::Credential, String>,
}

fn account_value(id: &str, input: &AccountInput, cache: Option<&AccountCache>) -> ProviderUsage {
    let mut value = match &input.credential {
        Ok(credential) => cache
            .filter(|cached| cached.fingerprint == credential.fingerprint)
            .map(|cached| cached.value.clone())
            .unwrap_or_else(|| ProviderUsage::empty(id, "waiting")),
        Err(issue) => {
            let mut value = ProviderUsage::empty(
                id,
                if issue == "signedOut" {
                    "signedOut"
                } else {
                    "error"
                },
            );
            value.issue = Some(issue.clone());
            value
        }
    };
    value.account.get_or_insert_with(Default::default).source = input.source.into();
    value
}

fn update_account(
    id: &str,
    input: &AccountInput,
    fetched: Result<ProviderUsage, String>,
    cache: &mut std::collections::HashMap<String, AccountCache>,
) {
    let Ok(credential) = &input.credential else {
        cache.remove(id);
        return;
    };
    let mut value = match fetched {
        Ok(value) => value,
        Err(issue) => {
            let mut value = if issue == "signedOut" {
                ProviderUsage::empty(id, "signedOut")
            } else {
                account_value(id, input, cache.get(id))
            };
            if issue != "signedOut" {
                value.status = "error".into();
            }
            value.issue = Some(issue);
            value
        }
    };
    value.account.get_or_insert_with(Default::default).source = input.source.into();
    cache.insert(
        id.into(),
        AccountCache {
            fingerprint: credential.fingerprint.clone(),
            value,
        },
    );
}

pub fn root() -> AppResult<PathBuf> {
    Ok(crate::config_paths::state_dir()?.join("usage"))
}
pub fn options() -> AppResult<UsageOptions> {
    read_json(&root()?.join("options.json"))
}

impl UsageManager {
    fn load(&self) -> AppResult<()> {
        let mut cache = self.cache.lock();
        if cache.is_none() {
            let mut loaded: UsageCache = read_json(&root()?.join("cache.json"))?;
            // ACP does not identify the account. Revalidate its billing each run.
            loaded.grok = None;
            *cache = Some(loaded);
        }
        Ok(())
    }

    pub fn snapshot(&self) -> AppResult<UsageSnapshot> {
        self.load()?;
        let options = options()?;
        let codex = self
            .cache
            .lock()
            .as_ref()
            .and_then(|c| c.codex.clone())
            .unwrap_or_else(|| ProviderUsage::empty("codex-cli", "waiting"));
        let mut grok = self
            .cache
            .lock()
            .as_ref()
            .and_then(|c| c.grok.clone())
            .unwrap_or_else(|| ProviderUsage::empty("grok", "waiting"));
        let mut cursor = cursor::snapshot(options.cursor_enabled)?;
        let inputs = self.account_inputs(&options);
        let accounts = self.accounts.lock();
        if let Some(input) = inputs.get("cursor-cli") {
            let mut remote = account_value("cursor-cli", input, accounts.get("cursor-cli"));
            remote.turns = cursor.turns;
            cursor = remote;
        }
        if let Some(input) = inputs.get("grok") {
            grok = account_value("grok", input, accounts.get("grok"));
        }
        Ok(UsageSnapshot {
            claude_enabled: options.claude_enabled,
            cursor_enabled: options.cursor_enabled,
            providers: vec![
                codex,
                claude::snapshot(options.claude_enabled)?,
                cursor,
                grok,
            ],
        })
    }

    fn account_inputs(
        &self,
        options: &UsageOptions,
    ) -> std::collections::HashMap<String, AccountInput> {
        let mut inputs = std::collections::HashMap::new();
        if let Some(cookie) = self.cursor_cookie.lock().clone() {
            inputs.insert(
                "cursor-cli".into(),
                AccountInput {
                    source: "sessionCookie",
                    credential: Ok(cookie),
                },
            );
        } else if let Some(grant) = &options.cursor_account {
            inputs.insert(
                "cursor-cli".into(),
                AccountInput {
                    source: "localFile",
                    credential: grant.read("cursor-cli"),
                },
            );
        }
        if let Some(grant) = &options.grok_account {
            inputs.insert(
                "grok".into(),
                AccountInput {
                    source: "localFile",
                    credential: grant.read("grok"),
                },
            );
        }
        inputs
    }

    pub async fn set_capture(
        self: &Arc<Self>,
        id: String,
        enabled: bool,
    ) -> AppResult<UsageSnapshot> {
        let _guard = self.refresh.lock().await;
        let manager = self.clone();
        tokio::task::spawn_blocking(move || {
            let mut opts = options()?;
            match id.as_str() {
                "claude-code" => opts.claude_enabled = enabled,
                "cursor-cli" => opts.cursor_enabled = enabled,
                _ => {
                    return Err(AppError::InvalidArgument(
                        "unsupported usage capture".into(),
                    ))
                }
            }
            write_json_atomic(&root()?.join("options.json"), &opts)?;
            manager.snapshot()
        })
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
    }

    pub async fn set_account(
        self: &Arc<Self>,
        id: String,
        grant: Option<account_auth::AccountGrant>,
        cookie: Option<account_auth::Credential>,
    ) -> AppResult<UsageSnapshot> {
        let _guard = self.refresh.lock().await;
        let manager = self.clone();
        tokio::task::spawn_blocking(move || {
            let mut opts = options()?;
            match id.as_str() {
                "cursor-cli" => opts.cursor_account = grant,
                "grok" => opts.grok_account = grant,
                _ => return Err(AppError::InvalidArgument("unsupported provider".into())),
            }
            write_json_atomic(&root()?.join("options.json"), &opts)?;
            if id == "cursor-cli" {
                *manager.cursor_cookie.lock() = cookie;
            }
            manager.accounts.lock().remove(&id);
            manager.load()?;
            if id == "grok" {
                manager.cache.lock().as_mut().unwrap().grok = None;
            }
            *manager.last_attempt.lock() = None;
            manager.snapshot()
        })
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
    }

    pub async fn refresh(self: &Arc<Self>, force: bool) -> AppResult<UsageSnapshot> {
        let _guard = self.refresh.lock().await;
        let manager = self.clone();
        tokio::task::spawn_blocking(move || manager.load())
            .await
            .map_err(|e| AppError::Other(e.to_string()))??;
        let cooldown = if force { 15 } else { 120 };
        let recent = self
            .last_attempt
            .lock()
            .is_some_and(|last| last.elapsed().as_secs() < cooldown);
        if !recent {
            *self.last_attempt.lock() = Some(std::time::Instant::now());
            let manager = self.clone();
            let inputs = tokio::task::spawn_blocking(move || {
                Ok::<_, AppError>(manager.account_inputs(&options()?))
            })
            .await
            .map_err(|e| AppError::Other(e.to_string()))??;
            let cursor_fetch = async {
                match inputs.get("cursor-cli") {
                    Some(AccountInput {
                        credential: Ok(c), ..
                    }) => cursor_account::fetch(c).await,
                    _ => Err("signedOut".into()),
                }
            };
            let grok_fetch = async {
                match inputs.get("grok") {
                    Some(AccountInput {
                        credential: Ok(c), ..
                    }) => grok_web::fetch(c).await,
                    Some(_) => Err("signedOut".into()),
                    None => grok::fetch().await,
                }
            };
            let (fetched, grok_fetched, cursor_fetched) =
                tokio::join!(codex::fetch(), grok_fetch, cursor_fetch);
            let manager = self.clone();
            tokio::task::spawn_blocking(move || {
                let mut cache = manager.cache.lock();
                let state = cache.as_mut().expect("usage loaded");
                match fetched {
                    Ok(provider) => state.codex = Some(provider),
                    Err(issue) => {
                        let value = state
                            .codex
                            .get_or_insert_with(|| ProviderUsage::empty("codex-cli", "error"));
                        value.status = "error".into();
                        value.issue = Some(issue);
                    }
                }
                // Re-read the selected file before accepting a response. An external
                // login change while the request is running invalidates its result.
                let current = manager.account_inputs(&options()?);
                let mut accounts = manager.accounts.lock();
                for (id, fetched) in [("cursor-cli", cursor_fetched), ("grok", grok_fetched)] {
                    if let Some(input) = inputs.get(id) {
                        let same = input
                            .credential
                            .as_ref()
                            .ok()
                            .zip(current.get(id).and_then(|i| i.credential.as_ref().ok()))
                            .is_some_and(|(a, b)| a.fingerprint == b.fingerprint);
                        if same {
                            update_account(id, input, fetched, &mut accounts);
                        } else {
                            accounts.remove(id);
                        }
                    } else if id == "grok" {
                        state.grok = Some(fetched.unwrap_or_else(|issue| {
                            let mut p = ProviderUsage::empty("grok", "error");
                            p.issue = Some(issue);
                            p
                        }));
                    }
                }
                state.schema_version = 1;
                write_json_atomic(&root()?.join("cache.json"), state)
            })
            .await
            .map_err(|e| AppError::Other(e.to_string()))??;
        }
        let manager = self.clone();
        tokio::task::spawn_blocking(move || manager.snapshot())
            .await
            .map_err(|e| AppError::Other(e.to_string()))?
    }
}

#[cfg(test)]
mod account_tests {
    use super::*;
    fn input(token: &str) -> AccountInput {
        AccountInput {
            source: "sessionCookie",
            credential: account_auth::cursor_cookie(token),
        }
    }
    fn populated() -> ProviderUsage {
        let mut p = ProviderUsage::empty("cursor-cli", "ready");
        p.windows.push(types::QuotaWindow {
            used_percent: 37.0,
            ..Default::default()
        });
        p
    }
    #[test]
    fn account_rotation_never_reuses_the_previous_quota() {
        let mut cache = std::collections::HashMap::new();
        update_account("cursor-cli", &input("first"), Ok(populated()), &mut cache);
        assert_eq!(
            account_value("cursor-cli", &input("first"), cache.get("cursor-cli"))
                .windows
                .len(),
            1
        );
        assert!(
            account_value("cursor-cli", &input("second"), cache.get("cursor-cli"))
                .windows
                .is_empty()
        );
        update_account(
            "cursor-cli",
            &input("second"),
            Err("timeout".into()),
            &mut cache,
        );
        assert!(
            account_value("cursor-cli", &input("second"), cache.get("cursor-cli"))
                .windows
                .is_empty()
        );
    }
    #[test]
    fn only_transient_failure_of_same_credential_preserves_stale_quota() {
        let mut cache = std::collections::HashMap::new();
        let auth = input("first");
        update_account("cursor-cli", &auth, Ok(populated()), &mut cache);
        update_account("cursor-cli", &auth, Err("timeout".into()), &mut cache);
        let stale = account_value("cursor-cli", &auth, cache.get("cursor-cli"));
        assert_eq!(stale.status, "error");
        assert_eq!(stale.windows.len(), 1);
        update_account("cursor-cli", &auth, Err("signedOut".into()), &mut cache);
        let expired = account_value("cursor-cli", &auth, cache.get("cursor-cli"));
        assert_eq!(expired.status, "signedOut");
        assert!(expired.windows.is_empty());
    }
}
