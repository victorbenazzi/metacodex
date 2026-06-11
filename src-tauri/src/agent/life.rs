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
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("md.metacodex.tmp");
    fs::write(&tmp, content.as_bytes())?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        AppError::Io(e)
    })?;
    Ok(())
}

pub fn memory_delete(home: &Path, rel: &str) -> AppResult<()> {
    if rel == "MEMORY.md" {
        return Err(AppError::Other("the index file cannot be deleted".into()));
    }
    let path = resolve_memory_path(home, rel)?;
    fs::remove_file(&path).map_err(AppError::Io)
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

pub fn append_run_log(home: &Path, entry: &RunLogEntry) {
    let dir = home.join("logs");
    let _ = fs::create_dir_all(&dir);
    let Ok(line) = serde_json::to_string(entry) else { return };
    let res = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("runs.jsonl"))
        .and_then(|mut f| writeln!(f, "{line}"));
    if let Err(e) = res {
        eprintln!("[metacodex] agent run log append failed: {e}");
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
    let file = format!("{stamp}-{trigger}.md");
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
    fs::write(dir.join(&file), doc.as_bytes())?;
    Ok(file)
}

pub fn list_reports(home: &Path, limit: usize) -> Vec<ReportInfo> {
    let dir = home.join("reports");
    let Ok(read) = fs::read_dir(&dir) else { return Vec::new() };
    let mut out: Vec<ReportInfo> = read
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_string();
            if !name.ends_with(".md") {
                return None;
            }
            let raw = fs::read_to_string(e.path()).ok()?;
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
        .collect();
    // File names start with a sortable timestamp; newest first.
    out.sort_by(|a, b| b.file.cmp(&a.file));
    out.truncate(limit);
    out
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

/// Extract the body of a ```persona fenced block, if any.
fn extract_persona_block(body: &str) -> Option<String> {
    let start = body.find("```persona")?;
    let after = &body[start + "```persona".len()..];
    let after = after.strip_prefix('\n').unwrap_or(after);
    let end = after.find("```")?;
    let block = after[..end].trim();
    if block.is_empty() { None } else { Some(block.to_string()) }
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

/// Approve or reject a pending proposal. Approving a proposal that carries a
/// `persona` block applies it to AGENT.md (the ONLY self-modification path,
/// always behind this human gate). Rejection records the reason as a memory,
/// so the agent doesn't propose the same thing again.
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

    if approve {
        if let Some(persona) = extract_persona_block(&body) {
            let agent_md = home.join("AGENT.md");
            let tmp = agent_md.with_extension("md.metacodex.tmp");
            fs::write(&tmp, persona.as_bytes())?;
            fs::rename(&tmp, &agent_md)?;
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
            fs::write(&index_path, index.as_bytes())?;
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
    fs::write(&path, doc.as_bytes())?;
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
         - If the task is NOT finished and you need a fresh session to continue, end your reply with a final line `{CONTINUE_MARKER} <one-line state summary>`. If you instead need to WAIT for something external, end with `{CONTINUE_IN_MARKER} <minutes>: <one-line state summary>`. Use these only when genuinely needed.\n\
         - Keep durable progress in files, not in conversation: a continuation starts with a fresh context and only your state summary.\n\
         - End your reply with a short plain-text account of what you did and anything that needs the user (it becomes your report)."
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
    format!(
        "This is your scheduled DREAM: a maintenance session about yourself. Work ONLY inside your agent home: {home_s}. Never touch any project directory.\n\
         1. Read logs/runs.jsonl and the recent files in reports/ (since your last dream) to recall what you did.\n\
         2. Consolidate memory: promote durable facts you learned into memory files + index lines (global layer and memory/projects/<key>/ layers); deduplicate; compress or delete stale entries; keep MEMORY.md indexes accurate.\n\
         3. Write a short journal entry at journal/<yyyy-mm-dd>.md: what I did, what I learned, what I'd do differently.\n\
         4. If you see a concrete way to improve your own persona or a skill worth having, write a proposal file at proposals/<yyyy-mm-dd>-<slug>.md with frontmatter lines (---\\ntitle: ...\\nkind: persona|skill|new-agent\\nstatus: pending\\n---). For a persona change, include the FULL new persona inside a fenced code block labeled persona. NEVER edit AGENT.md directly.\n\
         Finish with a one-paragraph summary of the consolidation."
    )
}

/// Parse a continuation request from the final assistant text. Returns
/// `(delay_minutes, state_summary)`; delay 0 = immediate.
pub fn parse_continuation(final_text: &str) -> Option<(u64, String)> {
    let line = final_text.trim().lines().last()?.trim();
    if let Some(rest) = line.strip_prefix(CONTINUE_MARKER) {
        let summary = rest.trim();
        if !summary.is_empty() {
            return Some((0, summary.to_string()));
        }
    }
    if let Some(rest) = line.strip_prefix(CONTINUE_IN_MARKER) {
        // `CONTINUE_IN 10: summary`
        let rest = rest.trim_start();
        let (mins, summary) = rest.split_once(':')?;
        let mins: u64 = mins.trim().parse().ok()?;
        let summary = summary.trim();
        if !summary.is_empty() {
            return Some((mins.clamp(1, 60), summary.to_string()));
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
