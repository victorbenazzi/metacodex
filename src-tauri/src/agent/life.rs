//! The "life harness" of agent entities (phases 2-4 of AGENTS_DESIGN.md):
//! memory context assembly, run logs, reports, heartbeat/dream state and the
//! proposal queue. Everything here is plain file IO over the agent home, so
//! the whole life of an agent stays portable (ADRs 0001/0002); the HTTP
//! execution itself lives in `runtime.rs` and the orchestration in
//! `scheduler.rs`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------------
// Memory (phase 2)
// ---------------------------------------------------------------------------

/// Stable key for a project's memory layer: directory basename (slugged) plus
/// a short hash of the full path, so two checkouts named `app` don't collide
/// and a rename keeps the key readable.
pub fn project_memory_key(directory: &str) -> String {
    let base = Path::new(directory)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project");
    let mut slug = String::new();
    for c in base.chars() {
        let c = c.to_ascii_lowercase();
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            slug.push(c);
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
        if slug.len() >= 24 {
            break;
        }
    }
    let slug = slug.trim_matches('-');
    let slug = if slug.is_empty() { "project" } else { slug };
    // FNV-1a, enough to disambiguate paths; not security-relevant.
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in directory.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{slug}-{:06x}", hash & 0xff_ffff)
}

fn read_or_empty(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

/// The system block injected into every turn of an entity session (chat and
/// autonomous alike): where the home is, how memory works, and the current
/// indexes so the agent knows what it already knows.
pub fn memory_context(home: &Path, directory: Option<&str>) -> String {
    let home_s = home.display();
    let global_index = read_or_empty(&home.join("MEMORY.md"));
    let mut out = String::new();
    out.push_str(&format!(
        "[metacodex agent harness]\n\
         Your agent home directory: {home_s}\n\
         Persistent memory rules:\n\
         - Global memory index: {home_s}/MEMORY.md (one line per memory: `- [Title](memory/<file>.md), short hook`).\n\
         - Memory files live in {home_s}/memory/, one durable fact per markdown file.\n\
         - When you learn a durable fact worth keeping (a user preference, a correction, project knowledge), write it as a memory file and add its index line. Update or delete memories that turn out to be wrong.\n\
         - Facts about the user or about yourself go in the global layer. Facts about a specific project go in that project's layer.\n\
         - Read the full memory file with your read tool when its index line is relevant to the task.\n"
    ));
    if let Some(dir) = directory.filter(|d| !d.trim().is_empty()) {
        let key = project_memory_key(dir);
        let project_index = read_or_empty(&home.join("memory/projects").join(&key).join("MEMORY.md"));
        out.push_str(&format!(
            "- Project memory for the current directory ({dir}) lives in {home_s}/memory/projects/{key}/ (same MEMORY.md index + files layout; create the folder on first write).\n"
        ));
        out.push_str("\nProject memory index:\n");
        out.push_str(if project_index.trim().is_empty() { "(empty)\n" } else { &project_index });
    }
    out.push_str("\nGlobal memory index:\n");
    out.push_str(if global_index.trim().is_empty() { "(empty)\n" } else { &global_index });
    out
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFileInfo {
    /// Path relative to the agent home (e.g. `memory/user-prefers-pt.md`).
    pub rel_path: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryGroup {
    pub key: String,
    pub index: String,
    pub files: Vec<MemoryFileInfo>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTree {
    pub index: String,
    pub files: Vec<MemoryFileInfo>,
    pub projects: Vec<ProjectMemoryGroup>,
}

fn list_md_files(dir: &Path, prefix: &str) -> Vec<MemoryFileInfo> {
    let Ok(read) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<MemoryFileInfo> = read
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|n| n.ends_with(".md") && n != "MEMORY.md")
        .map(|n| MemoryFileInfo {
            rel_path: format!("{prefix}{n}"),
            name: n,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn memory_tree(home: &Path) -> MemoryTree {
    let mut projects = Vec::new();
    let projects_dir = home.join("memory/projects");
    if let Ok(read) = fs::read_dir(&projects_dir) {
        for entry in read.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let Some(key) = entry.file_name().to_str().map(String::from) else { continue };
            projects.push(ProjectMemoryGroup {
                index: read_or_empty(&entry.path().join("MEMORY.md")),
                files: list_md_files(&entry.path(), &format!("memory/projects/{key}/")),
                key,
            });
        }
        projects.sort_by(|a, b| a.key.cmp(&b.key));
    }
    MemoryTree {
        index: read_or_empty(&home.join("MEMORY.md")),
        files: list_md_files(&home.join("memory"), "memory/"),
        projects,
    }
}

/// Guard a webview-supplied memory path: only `MEMORY.md` or markdown files
/// under `memory/` (including project layers), no traversal, no absolutes.
fn resolve_memory_path(home: &Path, rel: &str) -> AppResult<PathBuf> {
    let ok_shape = rel == "MEMORY.md"
        || (rel.starts_with("memory/")
            && rel.ends_with(".md")
            && !rel.contains("..")
            && !rel.contains('\\')
            && !rel.starts_with('/'));
    if !ok_shape {
        return Err(AppError::Other(format!("invalid memory path {rel:?}")));
    }
    Ok(home.join(rel))
}

pub fn memory_read(home: &Path, rel: &str) -> AppResult<String> {
    let path = resolve_memory_path(home, rel)?;
    fs::read_to_string(&path).map_err(AppError::Io)
}

pub fn memory_write(home: &Path, rel: &str, content: &str) -> AppResult<()> {
    let path = resolve_memory_path(home, rel)?;
    crate::config_paths::write_text_atomic(&path, content)
}

pub fn memory_delete(home: &Path, rel: &str) -> AppResult<()> {
    // No index is deletable: neither the global one nor a project layer's.
    if rel == "MEMORY.md" || rel.ends_with("/MEMORY.md") {
        return Err(AppError::Other("the index file cannot be deleted".into()));
    }
    let path = resolve_memory_path(home, rel)?;
    fs::remove_file(&path).map_err(AppError::Io)
}

/// The standing heartbeat checklist (user-editable from the Agenda tab).
pub fn heartbeat_read(home: &Path) -> String {
    read_or_empty(&home.join("HEARTBEAT.md"))
}

pub fn heartbeat_write(home: &Path, content: &str) -> AppResult<()> {
    crate::config_paths::write_text_atomic(&home.join("HEARTBEAT.md"), content)
}

/// Cheap harness-side consistency check of the memory layers (risk 2 of
/// AGENTS_DESIGN.md): memory files no index line mentions, and index lines
/// pointing at files that no longer exist. The result feeds the dream prompt
/// as material; the harness never auto-fixes.
pub fn memory_orphans(home: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let layers: Vec<(PathBuf, String)> = {
        let mut v = vec![(home.join("MEMORY.md"), "memory/".to_string())];
        if let Ok(read) = fs::read_dir(home.join("memory/projects")) {
            for entry in read.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    if let Some(key) = entry.file_name().to_str() {
                        v.push((
                            entry.path().join("MEMORY.md"),
                            format!("memory/projects/{key}/"),
                        ));
                    }
                }
            }
        }
        v
    };
    for (index_path, prefix) in layers {
        let index = read_or_empty(&index_path);
        let dir = home.join(prefix.trim_end_matches('/'));
        // A file counts as indexed when its NAME appears anywhere in the
        // layer's index (tolerant of either relative or layer-rooted links).
        for f in list_md_files(&dir, &prefix) {
            if !index.contains(&f.name) {
                out.push(format!("memory file not referenced by its index: {}", f.rel_path));
            }
        }
        // Index lines linking to .md files that don't exist in the layer.
        for line in index.lines() {
            let Some(start) = line.find("](") else { continue };
            let Some(end) = line[start + 2..].find(')') else { continue };
            let link = &line[start + 2..start + 2 + end];
            if !link.ends_with(".md") || link.contains("://") {
                continue;
            }
            let target = if link.starts_with("memory/") {
                home.join(link)
            } else {
                dir.join(link)
            };
            if !target.is_file() {
                out.push(format!("index line points at a missing file: {link}"));
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Run log (phase 3): logs/runs.jsonl, one JSON object per line, append-only.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunLogEntry {
    pub trigger: String,
    pub started_at: i64,
    pub finished_at: i64,
    /// "ok" | "ok-quiet" (heartbeat with nothing to do) | "aborted" | "error: ..."
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    #[serde(default)]
    pub continuations: u32,
}

/// Rotation threshold for `runs.jsonl`: past this size the file is rewritten
/// keeping only the newest entries (a heartbeat every few minutes would grow
/// it without bound otherwise).
const RUN_LOG_MAX_BYTES: u64 = 512 * 1024;
const RUN_LOG_KEEP_LINES: usize = 500;

pub fn append_run_log(home: &Path, entry: &RunLogEntry) {
    let dir = home.join("logs");
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("runs.jsonl");
    let Ok(line) = serde_json::to_string(entry) else { return };
    let res = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| writeln!(f, "{line}"));
    if let Err(e) = res {
        eprintln!("[metacodex] agent run log append failed: {e}");
    }
    let oversized = fs::metadata(&path).map(|m| m.len() > RUN_LOG_MAX_BYTES).unwrap_or(false);
    if oversized {
        if let Ok(raw) = fs::read_to_string(&path) {
            let lines: Vec<&str> = raw.lines().collect();
            let keep = lines.len().saturating_sub(RUN_LOG_KEEP_LINES);
            let trimmed = lines[keep..].join("\n") + "\n";
            if let Err(e) = crate::config_paths::write_text_atomic(&path, &trimmed) {
                eprintln!("[metacodex] agent run log rotation failed: {e}");
            }
        }
    }
}

pub fn recent_runs(home: &Path, limit: usize) -> Vec<RunLogEntry> {
    let Ok(raw) = fs::read_to_string(home.join("logs/runs.jsonl")) else {
        return Vec::new();
    };
    let mut out: Vec<RunLogEntry> = raw
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    out.reverse(); // newest first
    // Collapse the in-flight "needs-you (pending)" row into the run's final
    // entry once it lands (both carry the same session id; keep the newest).
    let mut seen_sessions = std::collections::HashSet::new();
    out.retain(|e| match &e.session_id {
        Some(sid) => seen_sessions.insert(sid.clone()),
        None => true,
    });
    out.truncate(limit);
    out
}

// ---------------------------------------------------------------------------
// Harness state (phases 3-4): logs/state.json, app-managed counters that must
// not live in the hand-editable agent.json.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct HarnessState {
    #[serde(default)]
    pub runs_since_dream: u32,
    #[serde(default)]
    pub last_heartbeat_at: Option<i64>,
    #[serde(default)]
    pub last_dream_at: Option<i64>,
}

pub fn read_state(home: &Path) -> HarnessState {
    crate::config_paths::read_json::<HarnessState>(&home.join("logs/state.json"))
        .unwrap_or_default()
}

pub fn write_state(home: &Path, state: &HarnessState) {
    if let Err(e) = crate::config_paths::write_json_atomic(&home.join("logs/state.json"), state) {
        eprintln!("[metacodex] agent state persist failed: {e}");
    }
}

// ---------------------------------------------------------------------------
// Reports (phase 3) and proposals (phase 4): markdown files with a minimal
// `key: value` frontmatter the harness both writes and parses.
// ---------------------------------------------------------------------------

fn parse_frontmatter(raw: &str) -> (Vec<(String, String)>, String) {
    // Proposals are written by the model and may arrive with CRLF (notably on
    // the Windows port); normalize so the frontmatter still parses.
    let raw = raw.replace("\r\n", "\n");
    let raw = raw.as_str();
    let Some(rest) = raw.strip_prefix("---\n") else {
        return (Vec::new(), raw.to_string());
    };
    let Some(end) = rest.find("\n---") else {
        return (Vec::new(), raw.to_string());
    };
    let head = &rest[..end];
    let body = rest[end + 4..].trim_start_matches('\n').to_string();
    let pairs = head
        .lines()
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();
    (pairs, body)
}

fn fm_get<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReportInfo {
    pub file: String,
    pub title: String,
    pub trigger: String,
    /// "ok" | "needs-you" | "aborted" | "error"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    pub created_at: i64,
    pub content: String,
}

/// Sanitize a value for single-line frontmatter.
fn fm_safe(v: &str) -> String {
    v.replace('\n', " ").trim().to_string()
}

pub fn write_report(
    home: &Path,
    title: &str,
    trigger: &str,
    status: &str,
    directory: Option<&str>,
    body: &str,
) -> AppResult<String> {
    let dir = home.join("reports");
    fs::create_dir_all(&dir)?;
    let now = chrono::Local::now();
    let stamp = now.format("%Y%m%d-%H%M%S");
    // Second-resolution stamps collide (two runs ending together would
    // silently overwrite each other); a short unique suffix prevents that.
    let nonce = &Uuid::new_v4().simple().to_string()[..6];
    let file = format!("{stamp}-{trigger}-{nonce}.md");
    let mut doc = String::new();
    doc.push_str("---\n");
    doc.push_str(&format!("title: {}\n", fm_safe(title)));
    doc.push_str(&format!("trigger: {trigger}\n"));
    doc.push_str(&format!("status: {status}\n"));
    if let Some(d) = directory {
        doc.push_str(&format!("project: {}\n", fm_safe(d)));
    }
    doc.push_str(&format!("createdAt: {}\n", chrono::Utc::now().timestamp_millis()));
    doc.push_str("---\n\n");
    doc.push_str(body.trim());
    doc.push('\n');
    crate::config_paths::write_text_atomic(&dir.join(&file), &doc)?;
    Ok(file)
}

pub fn list_reports(home: &Path, limit: usize) -> Vec<ReportInfo> {
    let dir = home.join("reports");
    let Ok(read) = fs::read_dir(&dir) else { return Vec::new() };
    // File names start with a sortable timestamp: pick the newest `limit`
    // BEFORE reading contents, so an old pile of reports costs nothing.
    let mut names: Vec<String> = read
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|n| n.ends_with(".md"))
        .collect();
    names.sort_by(|a, b| b.cmp(a));
    names.truncate(limit);
    names
        .into_iter()
        .filter_map(|name| {
            let raw = fs::read_to_string(dir.join(&name)).ok()?;
            let (fm, body) = parse_frontmatter(&raw);
            Some(ReportInfo {
                title: fm_get(&fm, "title").unwrap_or(&name).to_string(),
                trigger: fm_get(&fm, "trigger").unwrap_or("unknown").to_string(),
                status: fm_get(&fm, "status").unwrap_or("ok").to_string(),
                project: fm_get(&fm, "project").map(String::from),
                created_at: fm_get(&fm, "createdAt").and_then(|v| v.parse().ok()).unwrap_or(0),
                content: body,
                file: name,
            })
        })
        .collect()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProposalInfo {
    pub file: String,
    pub title: String,
    /// "persona" | "skill" | "new-agent" | "other"
    pub kind: String,
    /// "pending" | "approved" | "rejected"
    pub status: String,
    pub content: String,
    /// Present when the proposal carries an applicable full persona (a fenced
    /// block labeled `persona`); approving applies it to AGENT.md.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persona: Option<String>,
}

/// Extract the body of a fenced block with the given label (```persona,
/// ```skill), if any.
fn extract_fenced_block(body: &str, label: &str) -> Option<String> {
    let marker = format!("```{label}");
    let start = body.find(&marker)?;
    let after = &body[start + marker.len()..];
    let after = after.strip_prefix('\n').unwrap_or(after);
    let end = after.find("```")?;
    let block = after[..end].trim();
    if block.is_empty() { None } else { Some(block.to_string()) }
}

fn extract_persona_block(body: &str) -> Option<String> {
    extract_fenced_block(body, "persona")
}

/// Lowercase-dash slug for file names derived from a proposal title.
fn file_slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let c = c.to_ascii_lowercase();
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
        if out.len() >= 40 {
            break;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() { "item".into() } else { out }
}

fn proposal_path(home: &Path, file: &str) -> AppResult<PathBuf> {
    if file.contains('/') || file.contains('\\') || file.contains("..") || !file.ends_with(".md") {
        return Err(AppError::Other(format!("invalid proposal file {file:?}")));
    }
    Ok(home.join("proposals").join(file))
}

pub fn list_proposals(home: &Path) -> Vec<ProposalInfo> {
    let dir = home.join("proposals");
    let Ok(read) = fs::read_dir(&dir) else { return Vec::new() };
    let mut out: Vec<ProposalInfo> = read
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_string();
            if !name.ends_with(".md") {
                return None;
            }
            let raw = fs::read_to_string(e.path()).ok()?;
            let (fm, body) = parse_frontmatter(&raw);
            Some(ProposalInfo {
                title: fm_get(&fm, "title").unwrap_or(&name).to_string(),
                kind: fm_get(&fm, "kind").unwrap_or("other").to_string(),
                status: fm_get(&fm, "status").unwrap_or("pending").to_string(),
                persona: extract_persona_block(&body),
                content: body,
                file: name,
            })
        })
        .collect();
    out.sort_by(|a, b| b.file.cmp(&a.file));
    out
}

/// Approve or reject a pending proposal. Approving applies the proposal's
/// payload: a `persona` block rewrites AGENT.md, a `skill` block (kind:
/// skill) lands as `skills/<slug>/SKILL.md`. Both ONLY behind this human
/// gate. Rejection records the reason as a memory, so the agent doesn't
/// propose the same thing again.
///
/// Callers must hold `entities::state_mutex` for the entity: the
/// read-check-write below is not atomic on its own (double-resolve gate).
pub fn resolve_proposal(
    home: &Path,
    file: &str,
    approve: bool,
    reason: Option<&str>,
) -> AppResult<()> {
    let path = proposal_path(home, file)?;
    let raw = fs::read_to_string(&path).map_err(AppError::Io)?;
    let (fm, body) = parse_frontmatter(&raw);
    if fm_get(&fm, "status").unwrap_or("pending") != "pending" {
        return Err(AppError::Other("proposal is already resolved".into()));
    }
    let title = fm_get(&fm, "title").unwrap_or(file).to_string();
    let kind = fm_get(&fm, "kind").unwrap_or("other").to_string();

    if approve {
        if let Some(persona) = extract_persona_block(&body) {
            crate::config_paths::write_text_atomic(&home.join("AGENT.md"), &persona)?;
        }
        if kind == "skill" {
            if let Some(skill) = extract_fenced_block(&body, "skill") {
                let slug = file_slug(&title);
                crate::config_paths::write_text_atomic(
                    &home.join("skills").join(&slug).join("SKILL.md"),
                    &skill,
                )?;
            }
        }
    } else if let Some(reason) = reason.filter(|r| !r.trim().is_empty()) {
        let slug: String = file.trim_end_matches(".md").chars().take(40).collect();
        let mem_rel = format!("memory/rejected-proposal-{slug}.md");
        let note = format!(
            "# Rejected proposal: {title}\n\nThe user rejected this proposal. Reason: {}\n\nDo not propose it again unless the situation changes.\n",
            reason.trim()
        );
        memory_write(home, &mem_rel, &note)?;
        // Index line so the agent actually sees it next session.
        let index_path = home.join("MEMORY.md");
        let mut index = read_or_empty(&index_path);
        if !index.contains(&mem_rel) {
            if !index.is_empty() && !index.ends_with('\n') {
                index.push('\n');
            }
            index.push_str(&format!("- [Rejected: {title}]({mem_rel}), do not re-propose\n"));
            crate::config_paths::write_text_atomic(&index_path, &index)?;
        }
    }

    // Rewrite the frontmatter status in place.
    let new_status = if approve { "approved" } else { "rejected" };
    let mut doc = String::from("---\n");
    let mut wrote_status = false;
    for (k, v) in &fm {
        if k == "status" {
            doc.push_str(&format!("status: {new_status}\n"));
            wrote_status = true;
        } else {
            doc.push_str(&format!("{k}: {v}\n"));
        }
    }
    if !wrote_status {
        doc.push_str(&format!("status: {new_status}\n"));
    }
    if let Some(reason) = reason.filter(|r| !r.trim().is_empty()) {
        doc.push_str(&format!("resolution: {}\n", fm_safe(reason)));
    }
    doc.push_str("---\n\n");
    doc.push_str(&body);
    crate::config_paths::write_text_atomic(&path, &doc)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Prompt scaffolding for autonomous executions (phases 3-4)
// ---------------------------------------------------------------------------

/// Marker the model leaves at the END of its reply to request a continuation.
pub const CONTINUE_MARKER: &str = "CONTINUE:";
/// Variant with a delay: `CONTINUE_IN <minutes>: <state summary>`.
pub const CONTINUE_IN_MARKER: &str = "CONTINUE_IN";
/// Reply for a heartbeat with nothing to do (suppressed: log only, no report).
pub const HEARTBEAT_OK: &str = "HEARTBEAT_OK";

/// Instructions appended to the system block of AUTONOMOUS runs only (cron,
/// heartbeat, dream, continuation); interactive chat never carries them.
pub fn autonomous_instructions() -> String {
    format!(
        "Autonomous run protocol:\n\
         - You are running unattended; nobody answers follow-up questions. Decide and act.\n\
         - End your reply with a short plain-text account of what you did and anything that needs the user (it becomes your report).\n\
         - If the task is NOT finished and you need a fresh session to continue, add one more line AFTER the account, as the very last line of your reply: `{CONTINUE_MARKER} <one-line state summary>`. If you instead need to WAIT for something external, make that last line `{CONTINUE_IN_MARKER} <minutes>: <one-line state summary>`. Use these only when genuinely needed.\n\
         - Keep durable progress in files, not in conversation: a continuation starts with a fresh context and only your state summary."
    )
}

pub fn heartbeat_prompt(home: &Path) -> String {
    let checklist = read_or_empty(&home.join("HEARTBEAT.md"));
    format!(
        "This is your scheduled HEARTBEAT. Read your standing checklist below and decide whether anything needs action right now.\n\
         If NOTHING needs attention, reply with exactly `{HEARTBEAT_OK}` and nothing else.\n\
         If something needs action, do it (or describe what needs the user) and report.\n\n\
         Checklist (HEARTBEAT.md):\n{checklist}"
    )
}

pub fn dream_prompt(home: &Path) -> String {
    let home_s = home.display();
    let orphans = memory_orphans(home);
    let orphan_section = if orphans.is_empty() {
        String::new()
    } else {
        format!(
            "\nMemory inconsistencies the harness detected (fix them during step 2):\n{}\n",
            orphans
                .iter()
                .map(|o| format!("- {o}"))
                .collect::<Vec<_>>()
                .join("\n")
        )
    };
    format!(
        "This is your scheduled DREAM: a maintenance session about yourself. Work ONLY inside your agent home: {home_s}. Never touch any project directory.\n\
         1. Read logs/runs.jsonl and the recent files in reports/ (since your last dream) to recall what you did.\n\
         2. Consolidate memory: promote durable facts you learned into memory files + index lines (global layer and memory/projects/<key>/ layers); deduplicate; compress or delete stale entries; keep MEMORY.md indexes accurate.\n\
         3. Write a short journal entry at journal/<yyyy-mm-dd>.md: what I did, what I learned, what I'd do differently.\n\
         4. If you see a concrete way to improve your own persona or a skill worth having, write a proposal file at proposals/<yyyy-mm-dd>-<slug>.md with frontmatter lines (---\\ntitle: ...\\nkind: persona|skill|new-agent\\nstatus: pending\\n---). For a persona change, include the FULL new persona inside a fenced code block labeled persona. For a skill, include the FULL SKILL.md content (frontmatter with name + description, then the instructions) inside a fenced code block labeled skill. NEVER edit AGENT.md or skills/ directly.\n\
         {orphan_section}\
         Finish with a one-paragraph summary of the consolidation."
    )
}

/// Parse a continuation request from the final assistant text. Returns
/// `(delay_minutes, state_summary)`; delay 0 = immediate. The marker is
/// looked for in the LAST few non-empty lines, not only the very last one:
/// models routinely append a closing sentence after it despite the protocol.
pub fn parse_continuation(final_text: &str) -> Option<(u64, String)> {
    for line in final_text
        .trim()
        .lines()
        .rev()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .take(8)
    {
        if let Some(rest) = line.strip_prefix(CONTINUE_MARKER) {
            let summary = rest.trim();
            if !summary.is_empty() {
                return Some((0, summary.to_string()));
            }
        }
        if let Some(rest) = line.strip_prefix(CONTINUE_IN_MARKER) {
            // `CONTINUE_IN 10: summary`
            let rest = rest.trim_start();
            let Some((mins, summary)) = rest.split_once(':') else { continue };
            let Ok(mins) = mins.trim().parse::<u64>() else { continue };
            let summary = summary.trim();
            if !summary.is_empty() {
                return Some((mins.clamp(1, 60), summary.to_string()));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_home() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mcx-life-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("memory")).unwrap();
        fs::create_dir_all(dir.join("proposals")).unwrap();
        dir
    }

    #[test]
    fn project_memory_key_is_stable_and_distinct() {
        let a = project_memory_key("/Users/x/dev/app");
        let b = project_memory_key("/Users/y/other/app");
        assert_ne!(a, b);
        assert!(a.starts_with("app-"));
        assert_eq!(a, project_memory_key("/Users/x/dev/app"));
    }

    #[test]
    fn memory_path_guard() {
        let home = tmp_home();
        assert!(memory_write(&home, "memory/fact.md", "hi").is_ok());
        assert_eq!(memory_read(&home, "memory/fact.md").unwrap(), "hi");
        assert!(memory_write(&home, "../escape.md", "x").is_err());
        assert!(memory_write(&home, "memory/../../escape.md", "x").is_err());
        assert!(memory_write(&home, "/abs.md", "x").is_err());
        assert!(memory_delete(&home, "MEMORY.md").is_err());
        assert!(memory_delete(&home, "memory/fact.md").is_ok());
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn run_log_round_trip() {
        let home = tmp_home();
        for i in 0..3 {
            append_run_log(
                &home,
                &RunLogEntry {
                    trigger: "cron".into(),
                    started_at: i,
                    finished_at: i + 1,
                    status: "ok".into(),
                    session_id: None,
                    directory: None,
                    continuations: 0,
                },
            );
        }
        let runs = recent_runs(&home, 2);
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].started_at, 2); // newest first
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn report_round_trip() {
        let home = tmp_home();
        let file = write_report(&home, "Daily check", "cron", "ok", Some("/p/x"), "All good.").unwrap();
        let reports = list_reports(&home, 10);
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].file, file);
        assert_eq!(reports[0].title, "Daily check");
        assert_eq!(reports[0].status, "ok");
        assert_eq!(reports[0].project.as_deref(), Some("/p/x"));
        assert!(reports[0].content.contains("All good."));
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn proposal_approve_applies_persona_and_reject_writes_memory() {
        let home = tmp_home();
        fs::write(home.join("AGENT.md"), "old persona").unwrap();
        fs::write(
            home.join("proposals/2026-06-11-better.md"),
            "---\ntitle: Better persona\nkind: persona\nstatus: pending\n---\n\nI propose:\n\n```persona\nYou are sharper now.\n```\n",
        )
        .unwrap();

        let list = list_proposals(&home);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].persona.as_deref(), Some("You are sharper now."));

        resolve_proposal(&home, "2026-06-11-better.md", true, None).unwrap();
        assert_eq!(fs::read_to_string(home.join("AGENT.md")).unwrap(), "You are sharper now.");
        assert_eq!(list_proposals(&home)[0].status, "approved");
        // double-resolve refused
        assert!(resolve_proposal(&home, "2026-06-11-better.md", true, None).is_err());

        // rejection records a memory + index line
        fs::write(
            home.join("proposals/2026-06-12-risky.md"),
            "---\ntitle: Risky idea\nkind: skill\nstatus: pending\n---\n\nbody\n",
        )
        .unwrap();
        resolve_proposal(&home, "2026-06-12-risky.md", false, Some("too risky")).unwrap();
        let index = fs::read_to_string(home.join("MEMORY.md")).unwrap_or_default();
        assert!(index.contains("Rejected: Risky idea"));
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn continuation_parse() {
        assert_eq!(
            parse_continuation("did stuff\nCONTINUE: 30 of 240 done"),
            Some((0, "30 of 240 done".into()))
        );
        assert_eq!(
            parse_continuation("waiting on CI\nCONTINUE_IN 10: check build result"),
            Some((10, "check build result".into()))
        );
        assert_eq!(parse_continuation("all done"), None);
        assert_eq!(parse_continuation("CONTINUE:"), None);
    }
}
