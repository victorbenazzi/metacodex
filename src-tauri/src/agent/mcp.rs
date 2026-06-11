//! MCP server registry for the Agent View, and the generator for the
//! opencode config layer that carries it.
//!
//! opencode only reads MCP servers from config files (no runtime API to add or
//! remove them), so metacodex keeps its own registry in
//! `~/.metacodex/state/agent-mcp.json` (source of truth, may hold API keys)
//! and renders the enabled entries into
//! `~/.metacodex/state/opencode-config.json`, which the sidecar spawn passes
//! via the `OPENCODE_CONFIG` env var. opencode MERGES that layer on top of the
//! user's global `~/.config/opencode/opencode.json`, so nothing of the user's
//! own setup is touched. Config changes only land after a sidecar restart;
//! mutations report `requiresRestart` and the frontend owns the restart moment
//! (never silent, a restart kills live chat streams and changes the port).
//!
//! Secrets: environment/header values are REDACTED before crossing into the
//! webview (same posture as the provider-key stripping in `list_models`).
//! Sending the sentinel back in an upsert keeps the stored value.

use std::collections::BTreeMap;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config_paths;
use crate::error::{AppError, AppResult};

/// Sentinel the webview sees instead of a secret value. Round-trips on upsert.
pub const REDACTED: &str = "__metacodex_redacted__";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum FeaturedId {
    Brave,
    Exa,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum McpTransport {
    Local {
        /// argv, e.g. `["npx", "-y", "exa-mcp-server"]`.
        command: Vec<String>,
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        environment: BTreeMap<String, String>,
    },
    Remote {
        url: String,
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        headers: BTreeMap<String, String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpServerEntry {
    pub id: String,
    /// Doubles as the key in opencode's `mcp` config map.
    pub name: String,
    #[serde(flatten)]
    pub transport: McpTransport,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub featured: Option<FeaturedId>,
}

#[derive(Serialize, Deserialize, Default)]
struct McpFile {
    servers: Vec<McpServerEntry>,
}

/// Create/update payload from the frontend. `id: None` creates.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(flatten)]
    pub transport: McpTransport,
    pub enabled: bool,
    #[serde(default)]
    pub featured: Option<FeaturedId>,
}

/// One of the ready-to-enable servers the UI offers (web search). Not
/// persisted until the user pastes a key and enables it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FeaturedServerDef {
    pub featured: FeaturedId,
    /// Fixed opencode `mcp` map key.
    pub name: &'static str,
    pub display_name: &'static str,
    /// i18n key for the description (frontend resolves it).
    pub description_key: &'static str,
    /// Env var the API key goes into.
    pub env_var: &'static str,
    pub command: Vec<String>,
}

pub fn featured_catalog() -> Vec<FeaturedServerDef> {
    vec![
        FeaturedServerDef {
            featured: FeaturedId::Brave,
            name: "brave-search",
            display_name: "Brave Search",
            description_key: "agent.mcp.featured.brave",
            env_var: "BRAVE_API_KEY",
            command: ["npx", "-y", "@brave/brave-search-mcp-server", "--transport", "stdio"]
                .map(String::from)
                .to_vec(),
        },
        FeaturedServerDef {
            featured: FeaturedId::Exa,
            name: "exa",
            display_name: "Exa",
            description_key: "agent.mcp.featured.exa",
            env_var: "EXA_API_KEY",
            command: ["npx", "-y", "exa-mcp-server"].map(String::from).to_vec(),
        },
    ]
}

/// `[a-z0-9][a-z0-9_-]*`, the name is an opencode config map key, keep it tame.
fn validate_name(name: &str) -> AppResult<()> {
    let mut chars = name.chars();
    let ok_first = chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let ok_rest = chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
    if ok_first && ok_rest {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "invalid MCP server name {name:?}: use lowercase letters, digits, '-' and '_'"
        )))
    }
}

/// Replace every secret value with the sentinel before the entry crosses IPC.
fn redact(entry: &McpServerEntry) -> McpServerEntry {
    let mut out = entry.clone();
    match &mut out.transport {
        McpTransport::Local { environment, .. } => {
            for v in environment.values_mut() {
                *v = REDACTED.to_string();
            }
        }
        McpTransport::Remote { headers, .. } => {
            for v in headers.values_mut() {
                *v = REDACTED.to_string();
            }
        }
    }
    out
}

/// Swap sentinel values in `incoming` for the stored ones from `existing`.
/// A sentinel with no stored counterpart is an error (nothing to keep).
fn resolve_secrets(
    incoming: &mut BTreeMap<String, String>,
    existing: Option<&BTreeMap<String, String>>,
) -> AppResult<()> {
    for (k, v) in incoming.iter_mut() {
        if v == REDACTED {
            match existing.and_then(|m| m.get(k)) {
                Some(stored) => *v = stored.clone(),
                None => {
                    return Err(AppError::Other(format!(
                        "redacted value for {k:?} has no stored counterpart"
                    )))
                }
            }
        }
    }
    Ok(())
}

/// Validate + apply an upsert against the in-memory list. Pure (no I/O), so
/// the rules are unit-testable. Returns the stored (unredacted) entry.
fn apply_upsert(servers: &mut Vec<McpServerEntry>, input: McpServerInput) -> AppResult<McpServerEntry> {
    validate_name(&input.name)?;

    let existing_idx = match &input.id {
        Some(id) => Some(
            servers
                .iter()
                .position(|s| &s.id == id)
                .ok_or_else(|| AppError::NotFound(format!("MCP server {id}")))?,
        ),
        None => None,
    };

    // Name must stay unique among the OTHER entries (it keys the config map).
    let clash = servers.iter().enumerate().any(|(i, s)| {
        Some(i) != existing_idx && s.name.eq_ignore_ascii_case(&input.name)
    });
    if clash {
        return Err(AppError::Other(format!(
            "an MCP server named {:?} already exists",
            input.name
        )));
    }

    let mut transport = input.transport;

    // Featured entries are pinned to the catalog: the label can never smuggle
    // a different command line or env var (confused-deputy guard). Only the
    // key value comes from the input.
    if let Some(fid) = input.featured {
        let def = featured_catalog()
            .into_iter()
            .find(|d| d.featured == fid)
            .ok_or_else(|| AppError::Other("unknown featured server".into()))?;
        if input.name != def.name {
            return Err(AppError::Other(format!(
                "featured server must be named {:?}",
                def.name
            )));
        }
        let McpTransport::Local { environment, .. } = &transport else {
            return Err(AppError::Other("featured servers are local (npx) servers".into()));
        };
        let mut env = environment.clone();
        if env.len() != 1 || !env.contains_key(def.env_var) {
            return Err(AppError::Other(format!(
                "featured server {:?} takes exactly one env var: {}",
                def.name, def.env_var
            )));
        }
        let existing_env = existing_idx.and_then(|i| match &servers[i].transport {
            McpTransport::Local { environment, .. } => Some(environment),
            McpTransport::Remote { .. } => None,
        });
        resolve_secrets(&mut env, existing_env)?;
        transport = McpTransport::Local {
            command: def.command.clone(),
            environment: env,
        };
    } else {
        let existing_transport = existing_idx.map(|i| &servers[i].transport);
        match &mut transport {
            McpTransport::Local { command, environment } => {
                if command.is_empty() {
                    return Err(AppError::Other("MCP server command must not be empty".into()));
                }
                let existing_env = match existing_transport {
                    Some(McpTransport::Local { environment, .. }) => Some(environment),
                    _ => None,
                };
                resolve_secrets(environment, existing_env)?;
            }
            McpTransport::Remote { url, headers } => {
                if !(url.starts_with("http://") || url.starts_with("https://")) {
                    return Err(AppError::Other("MCP server url must be http(s)".into()));
                }
                let existing_headers = match existing_transport {
                    Some(McpTransport::Remote { headers, .. }) => Some(headers),
                    _ => None,
                };
                resolve_secrets(headers, existing_headers)?;
            }
        }
    }

    let entry = McpServerEntry {
        id: input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        name: input.name,
        transport,
        enabled: input.enabled,
        featured: input.featured,
    };
    match existing_idx {
        Some(i) => servers[i] = entry.clone(),
        None => servers.push(entry.clone()),
    }
    Ok(entry)
}

/// Render the enabled entries as an opencode config document. Disabled entries
/// simply vanish from this layer, emitting `"enabled": false` could disable a
/// same-named server from the user's own global config through the merge.
/// `agents` is the compiled `config.agent` section from the agent entities
/// (see `entities::compiled_agents`); empty maps are omitted entirely.
fn render_opencode_config(
    servers: &[McpServerEntry],
    agents: serde_json::Map<String, serde_json::Value>,
) -> serde_json::Value {
    let mut mcp = serde_json::Map::new();
    for e in servers.iter().filter(|e| e.enabled) {
        let v = match &e.transport {
            McpTransport::Local { command, environment } => {
                let mut obj = serde_json::json!({
                    "type": "local",
                    "command": command,
                    "enabled": true,
                });
                if !environment.is_empty() {
                    obj["environment"] = serde_json::json!(environment);
                }
                obj
            }
            McpTransport::Remote { url, headers } => {
                let mut obj = serde_json::json!({
                    "type": "remote",
                    "url": url,
                    "enabled": true,
                });
                if !headers.is_empty() {
                    obj["headers"] = serde_json::json!(headers);
                }
                obj
            }
        };
        mcp.insert(e.name.clone(), v);
    }
    let mut doc = serde_json::Map::new();
    doc.insert(
        "$schema".into(),
        serde_json::json!("https://opencode.ai/config.json"),
    );
    doc.insert("mcp".into(), serde_json::Value::Object(mcp));
    if !agents.is_empty() {
        doc.insert("agent".into(), serde_json::Value::Object(agents));
    }
    serde_json::Value::Object(doc)
}

/// Compiled `config.agent` section from the agent entities on disk. Failure to
/// resolve the agents dir degrades to "no agents" (the MCP layer must still
/// regenerate even if the entities feature is broken).
fn compiled_agents_from_disk() -> serde_json::Map<String, serde_json::Value> {
    match config_paths::agents_dir() {
        Ok(dir) => crate::agent::entities::compiled_agents(&dir),
        Err(e) => {
            eprintln!("[metacodex] agents dir unavailable: {e}");
            serde_json::Map::new()
        }
    }
}

fn write_opencode_config(servers: &[McpServerEntry]) -> AppResult<()> {
    let path = config_paths::opencode_config_file()?;
    config_paths::write_json_atomic_private(
        &path,
        &render_opencode_config(servers, compiled_agents_from_disk()),
    )
}

/// Standalone regenerate from the store file on disk, the sidecar spawn path
/// and every agent-entity mutation call this so the generated config can never
/// go stale (cheap, idempotent, heals hand-edits and version upgrades).
pub fn regenerate_opencode_config() -> AppResult<()> {
    let path = config_paths::agent_mcp_file()?;
    let file: McpFile = config_paths::read_json(&path)?;
    write_opencode_config(&file.servers)
}

/// Whitelist-sanitize opencode's `GET /mcp` status payload before it reaches
/// the webview: per server, only a status-ish string and an error string. The
/// raw shape is unpinned across opencode versions and could echo config
/// (including env values), never pass it through.
pub fn sanitize_mcp_status(v: &serde_json::Value) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    if let Some(map) = v.as_object() {
        for (name, st) in map {
            let mut entry = serde_json::Map::new();
            let status = st
                .get("status")
                .or_else(|| st.get("state"))
                .or_else(|| st.get("type"))
                .and_then(serde_json::Value::as_str);
            if let Some(s) = status {
                entry.insert("status".into(), serde_json::Value::String(s.to_string()));
            } else if st.is_string() {
                entry.insert("status".into(), st.clone());
            }
            if let Some(err) = st.get("error").and_then(serde_json::Value::as_str) {
                entry.insert("error".into(), serde_json::Value::String(err.to_string()));
            }
            out.insert(name.clone(), serde_json::Value::Object(entry));
        }
    }
    serde_json::Value::Object(out)
}

/// Managed registry (Tauri state), mirroring the `CronStore` pattern.
pub struct McpStore {
    servers: Mutex<Vec<McpServerEntry>>,
    /// Serializes `persist` (snapshot + both file writes) so two concurrent
    /// mutations can't land their writes out of order and resurrect an older
    /// snapshot on disk (lost update).
    io: Mutex<()>,
}

impl McpStore {
    pub fn load() -> Self {
        // `read_json_backed`: a corrupt registry (which holds the only copy of
        // the API keys) is renamed aside, never silently replaced with empty.
        let servers = config_paths::agent_mcp_file()
            .and_then(|p| config_paths::read_json_backed::<McpFile>(&p))
            .map(|f| f.servers)
            .unwrap_or_default();
        let store = Self {
            servers: Mutex::new(servers),
            io: Mutex::new(()),
        };
        // Make sure the generated layer exists and matches on boot, so the
        // first sidecar spawn always has a config file to point at.
        if let Err(e) = write_opencode_config(&store.servers.lock()) {
            eprintln!("[metacodex] opencode config generate failed: {e}");
        }
        store
    }

    fn persist(&self) -> AppResult<()> {
        // Hold the io lock across snapshot + writes: the snapshot is taken
        // AFTER the lock, so the last writer always writes the newest state.
        let _io = self.io.lock();
        let snapshot = McpFile {
            servers: self.servers.lock().clone(),
        };
        let path = config_paths::agent_mcp_file()?;
        config_paths::write_json_atomic_private(&path, &snapshot)?;
        write_opencode_config(&snapshot.servers)
    }

    /// Entries with secrets redacted, the only shape the webview ever sees.
    pub fn list(&self) -> Vec<McpServerEntry> {
        self.servers.lock().iter().map(redact).collect()
    }

    pub fn upsert(&self, input: McpServerInput) -> AppResult<McpServerEntry> {
        let entry = apply_upsert(&mut self.servers.lock(), input)?;
        self.persist()?;
        Ok(redact(&entry))
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        {
            let mut servers = self.servers.lock();
            let before = servers.len();
            servers.retain(|s| s.id != id);
            if servers.len() == before {
                return Err(AppError::NotFound(format!("MCP server {id}")));
            }
        }
        self.persist()
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> AppResult<()> {
        {
            let mut servers = self.servers.lock();
            let entry = servers
                .iter_mut()
                .find(|s| s.id == id)
                .ok_or_else(|| AppError::NotFound(format!("MCP server {id}")))?;
            entry.enabled = enabled;
        }
        self.persist()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_input(name: &str, env: &[(&str, &str)]) -> McpServerInput {
        McpServerInput {
            id: None,
            name: name.into(),
            transport: McpTransport::Local {
                command: vec!["npx".into(), "-y".into(), "some-server".into()],
                environment: env
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
            },
            enabled: true,
            featured: None,
        }
    }

    #[test]
    fn name_validation() {
        assert!(validate_name("brave-search").is_ok());
        assert!(validate_name("a1_b-2").is_ok());
        assert!(validate_name("").is_err());
        assert!(validate_name("Brave").is_err());
        assert!(validate_name("-lead").is_err());
        assert!(validate_name("has space").is_err());
        assert!(validate_name("dot.dot").is_err());
    }

    #[test]
    fn upsert_creates_and_rejects_duplicate_names() {
        let mut servers = Vec::new();
        apply_upsert(&mut servers, local_input("alpha", &[])).unwrap();
        assert!(apply_upsert(&mut servers, local_input("alpha", &[])).is_err());
        assert!(apply_upsert(&mut servers, local_input("beta", &[])).is_ok());
        assert_eq!(servers.len(), 2);
    }

    #[test]
    fn redaction_round_trips_secrets() {
        let mut servers = Vec::new();
        let stored = apply_upsert(&mut servers, local_input("alpha", &[("API_KEY", "real-secret")]))
            .unwrap();

        // The webview-facing copy hides the value...
        let public = redact(&stored);
        let McpTransport::Local { environment, .. } = &public.transport else {
            panic!("expected local")
        };
        assert_eq!(environment.get("API_KEY").unwrap(), REDACTED);

        // ...and an upsert echoing the sentinel keeps the stored plaintext.
        let mut update = local_input("alpha", &[("API_KEY", REDACTED)]);
        update.id = Some(stored.id.clone());
        let after = apply_upsert(&mut servers, update).unwrap();
        let McpTransport::Local { environment, .. } = &after.transport else {
            panic!("expected local")
        };
        assert_eq!(environment.get("API_KEY").unwrap(), "real-secret");
    }

    #[test]
    fn sentinel_without_stored_value_errors() {
        let mut servers = Vec::new();
        assert!(apply_upsert(&mut servers, local_input("alpha", &[("API_KEY", REDACTED)])).is_err());
    }

    #[test]
    fn featured_is_pinned_to_catalog() {
        let mut servers = Vec::new();
        // Right shape: catalog command is forced regardless of input command.
        let mut input = local_input("exa", &[("EXA_API_KEY", "k")]);
        input.featured = Some(FeaturedId::Exa);
        let entry = apply_upsert(&mut servers, input).unwrap();
        let McpTransport::Local { command, .. } = &entry.transport else {
            panic!("expected local")
        };
        assert_eq!(command, &vec!["npx".to_string(), "-y".into(), "exa-mcp-server".into()]);

        // Wrong name or wrong env var: rejected.
        let mut bad_name = local_input("not-exa", &[("EXA_API_KEY", "k")]);
        bad_name.featured = Some(FeaturedId::Exa);
        assert!(apply_upsert(&mut servers, bad_name).is_err());
        let mut bad_env = local_input("brave-search", &[("OTHER", "k")]);
        bad_env.featured = Some(FeaturedId::Brave);
        assert!(apply_upsert(&mut servers, bad_env).is_err());
    }

    #[test]
    fn render_includes_only_enabled() {
        let mut servers = Vec::new();
        apply_upsert(&mut servers, local_input("on", &[("K", "v")])).unwrap();
        let mut off = local_input("off", &[]);
        off.enabled = false;
        apply_upsert(&mut servers, off).unwrap();

        let cfg = render_opencode_config(&servers, serde_json::Map::new());
        let mcp = cfg.get("mcp").and_then(|m| m.as_object()).unwrap();
        assert!(mcp.contains_key("on"));
        assert!(!mcp.contains_key("off"));
        let on = mcp.get("on").unwrap();
        assert_eq!(on.get("type").unwrap(), "local");
        assert_eq!(on.get("enabled").unwrap(), true);
        assert_eq!(on.get("environment").unwrap().get("K").unwrap(), "v");
        // no agents -> no agent key at all (don't ship an empty override layer)
        assert!(cfg.get("agent").is_none());
    }

    #[test]
    fn render_includes_compiled_agents() {
        let mut agents = serde_json::Map::new();
        agents.insert("mcx-qa".into(), serde_json::json!({"mode": "primary"}));
        let cfg = render_opencode_config(&[], agents);
        assert_eq!(cfg["agent"]["mcx-qa"]["mode"], "primary");
    }

    #[test]
    fn sanitize_status_whitelists_fields() {
        let raw = serde_json::json!({
            "exa": { "status": "connected", "config": { "environment": { "EXA_API_KEY": "leak" } } },
            "broken": { "state": "failed", "error": "spawn npx: not found" }
        });
        let clean = sanitize_mcp_status(&raw);
        assert_eq!(clean["exa"]["status"], "connected");
        assert!(clean["exa"].get("config").is_none());
        assert_eq!(clean["broken"]["status"], "failed");
        assert_eq!(clean["broken"]["error"], "spawn npx: not found");
    }
}
