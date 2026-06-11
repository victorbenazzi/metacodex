//! Agent entities ("Agentes"): persistent agents with an on-disk home.
//!
//! Each entity lives in `~/.metacodex/agents/<slug>/` (see AGENTS_DESIGN.md):
//!
//! ```text
//! <slug>/
//! ├── AGENT.md       # persona/prompt (the only part a Dream proposal may touch)
//! ├── agent.json     # harness config (model, preset, projects, schedule caps)
//! ├── avatar.<ext>   # optional photo (or an emoji stored in agent.json)
//! ├── HEARTBEAT.md   # standing checklist (phase 4)
//! ├── MEMORY.md      # memory index (phase 2)
//! └── memory/ skills/ reports/ logs/ journal/
//! ```
//!
//! The home is a git repository; the harness commits a checkpoint after every
//! mutation (ADR 0002), which gives rollback and a future deploy path for free.
//!
//! Entities are compiled into opencode `config.agent` entries (named
//! `mcx-<slug>`) inside the generated `OPENCODE_CONFIG` layer. opencode caches
//! config per directory instance, so after a mutation the frontend hot-applies
//! with `POST /global/dispose` (no sidecar restart needed; spike 2026-06-11).
//!
//! SECURITY: these files live under `~/.metacodex`, outside every project
//! root, so like `config_paths` this module deliberately skips
//! `ensure_within_roots`. Safe because every path is derived from a validated
//! slug (`[a-z0-9][a-z0-9-]*`); the webview can never inject a path.

use std::fs;
use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::config_paths;
use crate::error::{AppError, AppResult};

/// Prefix for the compiled opencode agent name: avoids colliding with agents
/// from the user's own opencode config (our layer merges on top and would
/// silently override a same-named one).
pub const OPENCODE_NAME_PREFIX: &str = "mcx-";

const MAX_AVATAR_BYTES: usize = 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Avatar {
    /// An emoji (or short glyph) rendered as text.
    Emoji { value: String },
    /// A photo stored in the agent home; `value` is the file name
    /// (`avatar.png` / `avatar.jpg` / `avatar.webp`).
    Image { value: String },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatConfig {
    pub enabled: bool,
    pub interval_minutes: u32,
}

impl Default for HeartbeatConfig {
    fn default() -> Self {
        Self { enabled: false, interval_minutes: 30 }
    }
}

fn default_dream_after_runs() -> u32 {
    5
}
fn default_continuation_cap() -> u32 {
    10
}

/// `agent.json`: everything about the entity except the persona (AGENT.md)
/// and the avatar image bytes. Hand-editable, forward-compatible (phase 2+
/// fields ship with defaults so the file format doesn't churn).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentEntityConfig {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<Avatar>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    /// One of the 3 chat presets: "ask" | "auto-edit" | "full-auto".
    pub permission_preset: String,
    /// Registered project ids this agent may work in. `None` = all.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub projects: Option<Vec<String>>,
    #[serde(default)]
    pub heartbeat: HeartbeatConfig,
    #[serde(default = "default_dream_after_runs")]
    pub dream_after_runs: u32,
    #[serde(default = "default_continuation_cap")]
    pub continuation_cap: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Webview-facing shape: config + persona + avatar resolved for display
/// (image avatars become a data URL so the webview never needs a file path).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentEntity {
    pub id: String,
    pub name: String,
    pub persona: String,
    /// "emoji" avatar carries the emoji; "image" carries a data URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar: Option<Avatar>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    pub permission_preset: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projects: Option<Vec<String>>,
    pub heartbeat: HeartbeatConfig,
    pub dream_after_runs: u32,
    pub continuation_cap: u32,
    /// Compiled opencode agent name (`mcx-<slug>`), what the chat sends.
    pub opencode_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Avatar coming from the frontend on create/update.
#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AvatarInput {
    Emoji { value: String },
    /// `data:image/png;base64,...` (also jpeg/webp), capped at 1 MiB.
    Image { data_url: String },
    /// Keep the avatar already stored on disk (update flows that didn't touch it).
    Keep,
}

/// Create/update payload. `id: None` creates (slug derived from `name`).
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentEntityInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub persona: String,
    #[serde(default)]
    pub avatar: Option<AvatarInput>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub variant: Option<String>,
    pub permission_preset: String,
    #[serde(default)]
    pub projects: Option<Vec<String>>,
    /// Harness knobs (Agenda tab). Absent = keep stored values (update) or
    /// defaults (create).
    #[serde(default)]
    pub heartbeat: Option<HeartbeatConfig>,
    #[serde(default)]
    pub dream_after_runs: Option<u32>,
    #[serde(default)]
    pub continuation_cap: Option<u32>,
}

const PRESETS: [&str; 3] = ["ask", "auto-edit", "full-auto"];

const HEARTBEAT_TEMPLATE: &str = "# Heartbeat checklist\n\n\
<!-- Standing items this agent checks when its heartbeat fires (phase 4).\n\
     One item per line. Edit freely; the agent reads this file as-is. -->\n";

const MEMORY_TEMPLATE: &str = "# Memory index\n\n\
<!-- One line per memory: - [Title](memory/<file>.md), short hook.\n\
     Maintained by the agent itself (phase 2). -->\n";

/// Subdirectories of the agent home, created eagerly with a `.gitkeep` so the
/// initial commit captures the whole layout.
const HOME_SUBDIRS: [&str; 6] = ["memory", "skills", "reports", "logs", "journal", "proposals"];

fn validate_slug(slug: &str) -> AppResult<()> {
    let mut chars = slug.chars();
    let ok_first = chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let ok_rest = chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ok_first && ok_rest && slug.len() <= 64 {
        Ok(())
    } else {
        Err(AppError::Other(format!("invalid agent id {slug:?}")))
    }
}

/// Derive a slug from a display name: lowercase ascii, runs of anything else
/// collapse to a single '-'. Diacritics are dropped (ASCII-only on purpose:
/// the slug doubles as a directory name and an opencode config key).
fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut dash = true; // suppress leading '-'
    for c in name.chars() {
        let c = c.to_ascii_lowercase();
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
        if out.len() >= 48 {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "agent".into()
    } else {
        trimmed
    }
}

fn validate_color(color: &Option<String>) -> AppResult<()> {
    if let Some(c) = color {
        let ok = c.len() == 7
            && c.starts_with('#')
            && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
        if !ok {
            return Err(AppError::Other(format!("invalid color {c:?}: expected #RRGGBB")));
        }
    }
    Ok(())
}

fn validate_preset(preset: &str) -> AppResult<()> {
    if PRESETS.contains(&preset) {
        Ok(())
    } else {
        Err(AppError::Other(format!("invalid permission preset {preset:?}")))
    }
}

/// Decode a `data:image/...;base64,...` URL into (extension, bytes).
fn decode_avatar_data_url(data_url: &str) -> AppResult<(&'static str, Vec<u8>)> {
    let rest = data_url
        .strip_prefix("data:")
        .ok_or_else(|| AppError::Other("avatar must be a data: URL".into()))?;
    let (meta, payload) = rest
        .split_once(',')
        .ok_or_else(|| AppError::Other("malformed avatar data URL".into()))?;
    let mime = meta.split(';').next().unwrap_or_default();
    let ext = match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        other => {
            return Err(AppError::Other(format!(
                "unsupported avatar type {other:?} (png, jpeg or webp)"
            )))
        }
    };
    if !meta.ends_with(";base64") {
        return Err(AppError::Other("avatar data URL must be base64".into()));
    }
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| AppError::Other(format!("avatar base64 decode failed: {e}")))?;
    if bytes.len() > MAX_AVATAR_BYTES {
        return Err(AppError::Other("avatar image too large (max 1 MiB)".into()));
    }
    Ok((ext, bytes))
}

fn avatar_mime(file_name: &str) -> &'static str {
    match Path::new(file_name).extension().and_then(|e| e.to_str()) {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "image/png",
    }
}

/// Resolve the stored avatar for the webview: emoji passes through, an image
/// file becomes a data URL (capped; an oversized hand-placed file is dropped).
fn resolve_avatar(home: &Path, stored: &Option<Avatar>) -> Option<Avatar> {
    match stored {
        Some(Avatar::Emoji { value }) => Some(Avatar::Emoji { value: value.clone() }),
        Some(Avatar::Image { value }) => {
            // The file name is app-derived, but a hand-edited agent.json could
            // hold anything: refuse separators so it can't escape the home.
            if value.contains('/') || value.contains('\\') || value.contains("..") {
                return None;
            }
            let bytes = fs::read(home.join(value)).ok()?;
            if bytes.len() > MAX_AVATAR_BYTES * 2 {
                return None;
            }
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            Some(Avatar::Image {
                value: format!("data:{};base64,{}", avatar_mime(value), b64),
            })
        }
        None => None,
    }
}

fn read_config(home: &Path) -> AppResult<AgentEntityConfig> {
    let raw = fs::read_to_string(home.join("agent.json"))?;
    serde_json::from_str(&raw)
        .map_err(|e| AppError::Other(format!("parse {}: {e}", home.join("agent.json").display())))
}

fn read_entity(agents_dir: &Path, slug: &str) -> AppResult<AgentEntity> {
    let home = agents_dir.join(slug);
    let config = read_config(&home)?;
    let persona = fs::read_to_string(home.join("AGENT.md")).unwrap_or_default();
    Ok(AgentEntity {
        id: slug.to_string(),
        name: config.name.clone(),
        persona,
        avatar: resolve_avatar(&home, &config.avatar),
        color: config.color.clone(),
        provider_id: config.provider_id.clone(),
        model_id: config.model_id.clone(),
        variant: config.variant.clone(),
        permission_preset: config.permission_preset.clone(),
        projects: config.projects.clone(),
        heartbeat: config.heartbeat.clone(),
        dream_after_runs: config.dream_after_runs,
        continuation_cap: config.continuation_cap,
        opencode_name: format!("{OPENCODE_NAME_PREFIX}{slug}"),
        created_at: config.created_at.clone(),
        updated_at: config.updated_at.clone(),
    })
}

/// Scan the agents directory. Entries that fail to parse are skipped with a
/// log line (one corrupt agent.json must not hide every other agent).
pub fn scan_entities(agents_dir: &Path) -> Vec<AgentEntity> {
    let Ok(read) = fs::read_dir(agents_dir) else {
        return Vec::new();
    };
    let mut out: Vec<AgentEntity> = Vec::new();
    for entry in read.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_dir() {
            continue;
        }
        let Some(slug) = entry.file_name().to_str().map(String::from) else {
            continue;
        };
        if validate_slug(&slug).is_err() {
            continue;
        }
        match read_entity(agents_dir, &slug) {
            Ok(e) => out.push(e),
            Err(e) => eprintln!("[metacodex] skipping agent {slug:?}: {e}"),
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// Compile every entity into its opencode `config.agent` entry:
/// `mcx-<slug> -> { prompt, model, variant, mode, description, color }`.
/// Permission is deliberately absent: the session-level ruleset (preset sent
/// on session create) stays the single authority, exactly like plain chat.
pub fn compiled_agents(agents_dir: &Path) -> serde_json::Map<String, serde_json::Value> {
    let mut map = serde_json::Map::new();
    for entity in scan_entities(agents_dir) {
        let mut agent = serde_json::Map::new();
        agent.insert("description".into(), serde_json::json!(entity.name));
        // "all": usable as a chat primary AND invocable as a subagent by other
        // agents via the task tool (delegation, phase 4).
        agent.insert("mode".into(), serde_json::json!("all"));
        if !entity.persona.trim().is_empty() {
            agent.insert("prompt".into(), serde_json::json!(entity.persona));
        }
        if let (Some(provider), Some(model)) = (&entity.provider_id, &entity.model_id) {
            agent.insert("model".into(), serde_json::json!(format!("{provider}/{model}")));
        }
        if let Some(variant) = &entity.variant {
            agent.insert("variant".into(), serde_json::json!(variant));
        }
        if let Some(color) = &entity.color {
            agent.insert("color".into(), serde_json::json!(color));
        }
        map.insert(entity.opencode_name.clone(), serde_json::Value::Object(agent));
    }
    map
}

/// git checkpoint of the whole home (ADR 0002): init on first call, then
/// stage-all + commit. A checkpoint with no changes is a silent no-op.
/// Failures are returned but callers treat them as non-fatal (the entity
/// mutation itself already landed on disk).
pub fn checkpoint(home: &Path, message: &str) -> Result<(), git2::Error> {
    let repo = match git2::Repository::open(home) {
        Ok(r) => r,
        Err(_) => git2::Repository::init(home)?,
    };
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
    index.write()?;
    let tree_id = index.write_tree()?;
    let parent = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .and_then(|oid| repo.find_commit(oid).ok());
    if let Some(p) = &parent {
        if p.tree_id() == tree_id {
            return Ok(()); // nothing changed
        }
    }
    let tree = repo.find_tree(tree_id)?;
    let sig = git2::Signature::now("metacodex", "agents@metacodex.local")?;
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
    Ok(())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Apply an avatar input to the home dir; returns what agent.json should store.
fn apply_avatar(
    home: &Path,
    input: Option<AvatarInput>,
    existing: Option<Avatar>,
) -> AppResult<Option<Avatar>> {
    let remove_files = |keep: Option<&str>| {
        for ext in ["png", "jpg", "webp"] {
            let name = format!("avatar.{ext}");
            if Some(name.as_str()) != keep {
                let _ = fs::remove_file(home.join(&name));
            }
        }
    };
    match input {
        None => {
            remove_files(None);
            Ok(None)
        }
        Some(AvatarInput::Keep) => Ok(existing),
        Some(AvatarInput::Emoji { value }) => {
            let value = value.trim().to_string();
            if value.is_empty() || value.chars().count() > 4 {
                return Err(AppError::Other("invalid emoji avatar".into()));
            }
            remove_files(None);
            Ok(Some(Avatar::Emoji { value }))
        }
        Some(AvatarInput::Image { data_url }) => {
            let (ext, bytes) = decode_avatar_data_url(&data_url)?;
            let file_name = format!("avatar.{ext}");
            fs::write(home.join(&file_name), &bytes)?;
            remove_files(Some(file_name.as_str()));
            Ok(Some(Avatar::Image { value: file_name }))
        }
    }
}

fn write_config(home: &Path, config: &AgentEntityConfig) -> AppResult<()> {
    config_paths::write_json_atomic(&home.join("agent.json"), config)
}

/// Atomic-ish text write (tmp + rename) for AGENT.md and templates.
fn write_text(path: &Path, contents: &str) -> AppResult<()> {
    let tmp = path.with_file_name(format!(
        "{}.metacodex.tmp",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("file")
    ));
    fs::write(&tmp, contents.as_bytes())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        AppError::Io(e)
    })?;
    Ok(())
}

fn create_entity(agents_dir: &Path, input: AgentEntityInput) -> AppResult<AgentEntity> {
    validate_preset(&input.permission_preset)?;
    validate_color(&input.color)?;
    if input.name.trim().is_empty() {
        return Err(AppError::Other("agent name must not be empty".into()));
    }

    // Unique slug: base, base-2, base-3...
    let base = slugify(input.name.trim());
    let mut slug = base.clone();
    let mut n = 1;
    while agents_dir.join(&slug).exists() {
        n += 1;
        slug = format!("{base}-{n}");
        if n > 99 {
            return Err(AppError::Other("could not allocate agent directory".into()));
        }
    }
    validate_slug(&slug)?;

    let home = agents_dir.join(&slug);
    for sub in HOME_SUBDIRS {
        let dir = home.join(sub);
        fs::create_dir_all(&dir)?;
        fs::write(dir.join(".gitkeep"), b"")?;
    }
    write_text(&home.join("AGENT.md"), &input.persona)?;
    write_text(&home.join("HEARTBEAT.md"), HEARTBEAT_TEMPLATE)?;
    write_text(&home.join("MEMORY.md"), MEMORY_TEMPLATE)?;

    let avatar = apply_avatar(&home, input.avatar, None)?;
    let now = now_iso();
    let config = AgentEntityConfig {
        name: input.name.trim().to_string(),
        avatar,
        color: input.color,
        provider_id: input.provider_id,
        model_id: input.model_id,
        variant: input.variant,
        permission_preset: input.permission_preset,
        projects: input.projects,
        heartbeat: HeartbeatConfig::default(),
        dream_after_runs: default_dream_after_runs(),
        continuation_cap: default_continuation_cap(),
        created_at: Some(now.clone()),
        updated_at: Some(now),
    };
    write_config(&home, &config)?;

    if let Err(e) = checkpoint(&home, "create agent") {
        eprintln!("[metacodex] agent git checkpoint failed for {slug}: {e}");
    }
    read_entity(agents_dir, &slug)
}

fn update_entity(agents_dir: &Path, slug: &str, input: AgentEntityInput) -> AppResult<AgentEntity> {
    validate_slug(slug)?;
    validate_preset(&input.permission_preset)?;
    validate_color(&input.color)?;
    if input.name.trim().is_empty() {
        return Err(AppError::Other("agent name must not be empty".into()));
    }
    let home = agents_dir.join(slug);
    let mut config = read_config(&home)?; // NotFound surfaces here

    write_text(&home.join("AGENT.md"), &input.persona)?;
    config.avatar = apply_avatar(&home, input.avatar, config.avatar.take())?;
    config.name = input.name.trim().to_string();
    config.color = input.color;
    config.provider_id = input.provider_id;
    config.model_id = input.model_id;
    config.variant = input.variant;
    config.permission_preset = input.permission_preset;
    config.projects = input.projects;
    if let Some(hb) = input.heartbeat {
        config.heartbeat = HeartbeatConfig {
            enabled: hb.enabled,
            interval_minutes: hb.interval_minutes.clamp(5, 24 * 60),
        };
    }
    if let Some(n) = input.dream_after_runs {
        config.dream_after_runs = n.clamp(1, 100);
    }
    if let Some(n) = input.continuation_cap {
        config.continuation_cap = n.clamp(0, 50);
    }
    config.updated_at = Some(now_iso());
    write_config(&home, &config)?;

    if let Err(e) = checkpoint(&home, "update agent") {
        eprintln!("[metacodex] agent git checkpoint failed for {slug}: {e}");
    }
    read_entity(agents_dir, slug)
}

fn delete_entity(agents_dir: &Path, slug: &str) -> AppResult<()> {
    validate_slug(slug)?;
    let home = agents_dir.join(slug);
    if !home.is_dir() {
        return Err(AppError::NotFound(format!("agent {slug}")));
    }
    fs::remove_dir_all(&home)?;
    Ok(())
}

/// Resolve (and validate) an agent's home directory from its slug. The slug
/// check is the security boundary: every life/memory command path derives
/// from this, so a webview-supplied id can never escape `~/.metacodex/agents`.
pub fn home_dir(slug: &str) -> AppResult<PathBuf> {
    validate_slug(slug)?;
    let home = config_paths::agents_dir()?.join(slug);
    if !home.is_dir() {
        return Err(AppError::NotFound(format!("agent {slug}")));
    }
    Ok(home)
}

/// Managed store (Tauri state). Stateless reads (the directory IS the truth,
/// hand-edits welcome); the mutex only serializes mutations + the config
/// regeneration that follows them.
pub struct AgentEntityStore {
    io: Mutex<()>,
}

impl AgentEntityStore {
    pub fn new() -> Self {
        Self { io: Mutex::new(()) }
    }

    fn dir(&self) -> AppResult<PathBuf> {
        let dir = config_paths::agents_dir()?;
        fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    pub fn list(&self) -> AppResult<Vec<AgentEntity>> {
        Ok(scan_entities(&self.dir()?))
    }

    pub fn create(&self, input: AgentEntityInput) -> AppResult<AgentEntity> {
        let _io = self.io.lock();
        let entity = create_entity(&self.dir()?, input)?;
        crate::agent::mcp::regenerate_opencode_config()?;
        Ok(entity)
    }

    pub fn update(&self, slug: &str, input: AgentEntityInput) -> AppResult<AgentEntity> {
        let _io = self.io.lock();
        let entity = update_entity(&self.dir()?, slug, input)?;
        crate::agent::mcp::regenerate_opencode_config()?;
        Ok(entity)
    }

    pub fn delete(&self, slug: &str) -> AppResult<()> {
        let _io = self.io.lock();
        delete_entity(&self.dir()?, slug)?;
        crate::agent::mcp::regenerate_opencode_config()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str) -> AgentEntityInput {
        AgentEntityInput {
            id: None,
            name: name.into(),
            persona: "You are a test agent.".into(),
            avatar: Some(AvatarInput::Emoji { value: "🤖".into() }),
            color: Some("#FF5733".into()),
            provider_id: Some("opencode-go".into()),
            model_id: Some("kimi-k2.6".into()),
            variant: None,
            permission_preset: "auto-edit".into(),
            projects: None,
            heartbeat: None,
            dream_after_runs: None,
            continuation_cap: None,
        }
    }

    #[test]
    fn slugify_basics() {
        assert_eq!(slugify("QA Reviewer"), "qa-reviewer");
        assert_eq!(slugify("  ágil & Rápido!  "), "gil-r-pido");
        assert_eq!(slugify("___"), "agent");
        assert!(validate_slug(&slugify("Weird///Name")).is_ok());
    }

    #[test]
    fn create_lays_out_home_and_compiles() {
        let tmp = std::env::temp_dir().join(format!("mcx-entities-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();

        let entity = create_entity(&tmp, input("QA Reviewer")).unwrap();
        assert_eq!(entity.id, "qa-reviewer");
        assert_eq!(entity.opencode_name, "mcx-qa-reviewer");
        let home = tmp.join("qa-reviewer");
        for f in ["AGENT.md", "agent.json", "HEARTBEAT.md", "MEMORY.md"] {
            assert!(home.join(f).is_file(), "missing {f}");
        }
        for d in HOME_SUBDIRS {
            assert!(home.join(d).is_dir(), "missing {d}/");
        }
        // git checkpoint landed
        assert!(home.join(".git").is_dir());

        // duplicate name allocates a suffixed slug
        let second = create_entity(&tmp, input("QA Reviewer")).unwrap();
        assert_eq!(second.id, "qa-reviewer-2");

        // compiled config.agent entry
        let agents = compiled_agents(&tmp);
        let compiled = agents.get("mcx-qa-reviewer").unwrap();
        // "all": chat primary AND delegable as a subagent (phase 4).
        assert_eq!(compiled["mode"], "all");
        assert_eq!(compiled["model"], "opencode-go/kimi-k2.6");
        assert_eq!(compiled["color"], "#FF5733");
        assert_eq!(compiled["prompt"], "You are a test agent.");
        // permission must NOT be compiled (session ruleset is the authority)
        assert!(compiled.get("permission").is_none());

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn update_and_delete_round_trip() {
        let tmp = std::env::temp_dir().join(format!("mcx-entities-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();

        let created = create_entity(&tmp, input("Dev")).unwrap();
        let mut upd = input("Dev Senior");
        upd.persona = "You are senior.".into();
        upd.avatar = Some(AvatarInput::Keep);
        let updated = update_entity(&tmp, &created.id, upd).unwrap();
        assert_eq!(updated.name, "Dev Senior");
        assert_eq!(updated.persona, "You are senior.");
        // Keep preserved the emoji avatar
        assert_eq!(updated.avatar, Some(Avatar::Emoji { value: "🤖".into() }));
        // slug is stable across rename
        assert_eq!(updated.id, "dev");

        delete_entity(&tmp, "dev").unwrap();
        assert!(scan_entities(&tmp).is_empty());
        assert!(delete_entity(&tmp, "dev").is_err());

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn validation_rejects_bad_inputs() {
        let tmp = std::env::temp_dir().join(format!("mcx-entities-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();

        let mut bad = input("X");
        bad.permission_preset = "yolo".into();
        assert!(create_entity(&tmp, bad).is_err());

        let mut bad = input("X");
        bad.color = Some("red".into());
        assert!(create_entity(&tmp, bad).is_err());

        let mut bad = input("  ");
        bad.name = "  ".into();
        assert!(create_entity(&tmp, bad).is_err());

        assert!(delete_entity(&tmp, "../oops").is_err());

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn avatar_data_url_decode() {
        // 1x1 png
        let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let (ext, bytes) = decode_avatar_data_url(png).unwrap();
        assert_eq!(ext, "png");
        assert!(!bytes.is_empty());
        assert!(decode_avatar_data_url("data:image/gif;base64,AAAA").is_err());
        assert!(decode_avatar_data_url("nope").is_err());
    }
}
