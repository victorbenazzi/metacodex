use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::config_paths::{read_json, resume_file, write_json_atomic};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResumeEntry {
    /// Local nanoid — the resume registry's primary key, distinct from
    /// `session_id` which is whatever the CLI prints.
    pub id: String,
    /// Project the session belongs to. `None` if captured in a no-project tab.
    pub project_id: Option<String>,
    /// "claude-code" | "codex-cli" | "opencode" | … — the registry id.
    pub cli_id: String,
    /// CLI-printed session token. UUID for Claude Code; format varies for others.
    pub session_id: String,
    pub cwd: String,
    pub branch: Option<String>,
    /// RFC3339 — when the detector first saw this session id.
    pub captured_at: String,
    /// RFC3339 — bumped on every subsequent detection so prune knows what's recent.
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ResumeFile {
    entries: Vec<ResumeEntry>,
}

fn read_all() -> AppResult<Vec<ResumeEntry>> {
    let path = resume_file()?;
    let file: ResumeFile = read_json(&path)?;
    Ok(file.entries)
}

fn write_all(entries: Vec<ResumeEntry>) -> AppResult<()> {
    let path = resume_file()?;
    write_json_atomic(&path, &ResumeFile { entries })
}

#[tauri::command]
pub async fn resume_list(
    project_id: Option<String>,
    days: Option<u32>,
) -> AppResult<Vec<ResumeEntry>> {
    let mut entries = read_all()?;

    // Filter by project if given.
    if let Some(pid) = project_id.as_ref() {
        entries.retain(|e| e.project_id.as_ref() == Some(pid));
    }

    // Filter by `last_seen_at` recency.
    if let Some(days) = days {
        let cutoff = Utc::now() - chrono::Duration::days(days as i64);
        entries.retain(|e| {
            chrono::DateTime::parse_from_rfc3339(&e.last_seen_at)
                .map(|t| t.with_timezone(&Utc) >= cutoff)
                .unwrap_or(false)
        });
    }

    // Most recent first.
    entries.sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));
    Ok(entries)
}

#[tauri::command]
pub async fn resume_save(entry: ResumeEntry) -> AppResult<()> {
    let mut entries = read_all()?;
    let now = Utc::now().to_rfc3339();
    let key = (entry.cli_id.clone(), entry.session_id.clone(), entry.cwd.clone());
    if let Some(existing) = entries.iter_mut().find(|e| {
        (e.cli_id.clone(), e.session_id.clone(), e.cwd.clone()) == key
    }) {
        existing.last_seen_at = now.clone();
        if let Some(b) = entry.branch {
            existing.branch = Some(b);
        }
        if !entry.project_id.is_none() {
            existing.project_id = entry.project_id;
        }
    } else {
        let mut entry = entry;
        if entry.id.is_empty() {
            entry.id = format!("r-{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        }
        if entry.captured_at.is_empty() {
            entry.captured_at = now.clone();
        }
        if entry.last_seen_at.is_empty() {
            entry.last_seen_at = now;
        }
        entries.push(entry);
    }
    write_all(entries)
}

#[tauri::command]
pub async fn resume_discard(id: String) -> AppResult<()> {
    let mut entries = read_all()?;
    let before = entries.len();
    entries.retain(|e| e.id != id);
    if entries.len() == before {
        return Err(AppError::NotFound(format!("resume entry {id}")));
    }
    write_all(entries)
}

#[tauri::command]
pub async fn resume_prune(older_than_days: u32) -> AppResult<u32> {
    let mut entries = read_all()?;
    let cutoff = Utc::now() - chrono::Duration::days(older_than_days as i64);
    let before = entries.len() as u32;
    entries.retain(|e| {
        chrono::DateTime::parse_from_rfc3339(&e.last_seen_at)
            .map(|t| t.with_timezone(&Utc) >= cutoff)
            .unwrap_or(true) // keep entries with unparseable dates
    });
    let removed = before - entries.len() as u32;
    if removed > 0 {
        write_all(entries)?;
    }
    Ok(removed)
}

/// Synchronous variant for `lib.rs::setup`. Best-effort: ignore errors so a
/// corrupt resume.json doesn't block startup.
pub fn prune_blocking(older_than_days: u32) {
    let _ = (|| -> AppResult<()> {
        let mut entries = read_all()?;
        let cutoff = Utc::now() - chrono::Duration::days(older_than_days as i64);
        let before = entries.len();
        entries.retain(|e| {
            chrono::DateTime::parse_from_rfc3339(&e.last_seen_at)
                .map(|t| t.with_timezone(&Utc) >= cutoff)
                .unwrap_or(true)
        });
        if entries.len() != before {
            write_all(entries)?;
        }
        Ok(())
    })();
}
