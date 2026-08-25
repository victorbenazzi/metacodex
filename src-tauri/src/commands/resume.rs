use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config_paths::{read_json, resume_file, write_json_atomic};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResumeEntry {
    pub id: String,
    pub project_id: Option<String>,
    pub cli_id: String,
    pub session_id: String,
    pub cwd: String,
    pub branch: Option<String>,
    pub captured_at: String,
    pub last_seen_at: String,
    #[serde(default)]
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ResumeFile {
    entries: Vec<ResumeEntry>,
}

pub struct ResumeStore {
    path: PathBuf,
    file: Mutex<ResumeFile>,
}

impl ResumeStore {
    pub fn hydrate() -> AppResult<Self> {
        let path = resume_file()?;
        let file = read_json(&path)?;
        Ok(Self {
            path,
            file: Mutex::new(file),
        })
    }

    #[cfg(test)]
    fn at(path: PathBuf) -> AppResult<Self> {
        let file = read_json(&path)?;
        Ok(Self {
            path,
            file: Mutex::new(file),
        })
    }

    pub fn list(&self, project_id: Option<&str>, days: Option<u32>) -> Vec<ResumeEntry> {
        let mut entries = self.file.lock().entries.clone();
        if let Some(project_id) = project_id {
            entries.retain(|entry| entry.project_id.as_deref() == Some(project_id));
        }
        if let Some(days) = days {
            let cutoff = Utc::now() - chrono::Duration::days(days as i64);
            entries.retain(|entry| {
                chrono::DateTime::parse_from_rfc3339(&entry.last_seen_at)
                    .map(|time| time.with_timezone(&Utc) >= cutoff)
                    .unwrap_or(false)
            });
        }
        entries.sort_by(|left, right| right.last_seen_at.cmp(&left.last_seen_at));
        entries
    }

    pub fn save(&self, mut entry: ResumeEntry) -> AppResult<()> {
        let mut file = self.file.lock();
        let mut next = file.clone();
        let now = Utc::now().to_rfc3339();
        if let Some(existing) = next.entries.iter_mut().find(|existing| {
            existing.cli_id == entry.cli_id && existing.session_id == entry.session_id
        }) {
            if entry.revision < existing.revision {
                return Ok(());
            }
            existing.last_seen_at = now;
            existing.revision = entry.revision;
            existing.cwd = entry.cwd;
            existing.branch = entry.branch.or_else(|| existing.branch.clone());
            if entry.project_id.is_some() {
                existing.project_id = entry.project_id;
            }
        } else {
            if entry.id.is_empty() {
                entry.id = format!("r-{}", uuid::Uuid::new_v4());
            }
            if entry.captured_at.is_empty() {
                entry.captured_at = now.clone();
            }
            if entry.last_seen_at.is_empty() {
                entry.last_seen_at = now;
            }
            next.entries.push(entry);
        }
        write_json_atomic(&self.path, &next)?;
        *file = next;
        Ok(())
    }

    pub fn discard(&self, id: &str) -> AppResult<()> {
        let mut file = self.file.lock();
        let mut next = file.clone();
        let before = next.entries.len();
        next.entries.retain(|entry| entry.id != id);
        if next.entries.len() == before {
            return Err(AppError::NotFound(format!("resume entry {id}")));
        }
        write_json_atomic(&self.path, &next)?;
        *file = next;
        Ok(())
    }

    pub fn prune(&self, older_than_days: u32) -> AppResult<()> {
        let mut file = self.file.lock();
        let mut next = file.clone();
        let cutoff = Utc::now() - chrono::Duration::days(older_than_days as i64);
        let before = next.entries.len();
        next.entries.retain(|entry| {
            chrono::DateTime::parse_from_rfc3339(&entry.last_seen_at)
                .map(|time| time.with_timezone(&Utc) >= cutoff)
                .unwrap_or(true)
        });
        if next.entries.len() != before {
            write_json_atomic(&self.path, &next)?;
            *file = next;
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn resume_list(
    store: State<'_, Arc<ResumeStore>>,
    project_id: Option<String>,
    days: Option<u32>,
) -> AppResult<Vec<ResumeEntry>> {
    Ok(store.list(project_id.as_deref(), days))
}

#[tauri::command]
pub async fn resume_save(store: State<'_, Arc<ResumeStore>>, entry: ResumeEntry) -> AppResult<()> {
    store.save(entry)
}

#[tauri::command]
pub async fn resume_discard(store: State<'_, Arc<ResumeStore>>, id: String) -> AppResult<()> {
    store.discard(&id)
}

#[cfg(test)]
mod tests {
    use super::{ResumeEntry, ResumeStore};
    use std::sync::Arc;

    fn test_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("metacodex-{name}-{}.json", uuid::Uuid::new_v4()))
    }

    fn entry(cli: &str, session: &str, cwd: &str) -> ResumeEntry {
        ResumeEntry {
            id: String::new(),
            project_id: Some("project".into()),
            cli_id: cli.into(),
            session_id: session.into(),
            cwd: cwd.into(),
            branch: None,
            captured_at: String::new(),
            last_seen_at: String::new(),
            revision: 0,
        }
    }

    #[test]
    fn concurrent_unique_saves_preserve_both_records() {
        let path = test_path("resume-concurrent");
        let store = Arc::new(ResumeStore::at(path.clone()).unwrap());
        let left = {
            let store = store.clone();
            std::thread::spawn(move || store.save(entry("claude", "a", "/one")))
        };
        let right = {
            let store = store.clone();
            std::thread::spawn(move || store.save(entry("codex", "b", "/two")))
        };
        left.join().unwrap().unwrap();
        right.join().unwrap().unwrap();
        assert_eq!(store.list(None, None).len(), 2);
        assert_eq!(
            ResumeStore::at(path.clone())
                .unwrap()
                .list(None, None)
                .len(),
            2
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn same_identity_keeps_newest_fields() {
        let path = test_path("resume-merge");
        let store = ResumeStore::at(path.clone()).unwrap();
        store.save(entry("claude", "same", "/old")).unwrap();
        let mut newest = entry("claude", "same", "/new");
        newest.revision = 2;
        newest.branch = Some("feature".into());
        store.save(newest).unwrap();
        let entries = store.list(None, None);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].cwd, "/new");
        assert_eq!(entries[0].branch.as_deref(), Some("feature"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn concurrent_same_identity_keeps_highest_revision() {
        let path = test_path("resume-concurrent-merge");
        let store = Arc::new(ResumeStore::at(path.clone()).unwrap());
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let old = {
            let store = store.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut value = entry("claude", "same", "/old");
                value.revision = 10;
                barrier.wait();
                store.save(value)
            })
        };
        let new = {
            let store = store.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut value = entry("claude", "same", "/new");
                value.branch = Some("feature".into());
                value.revision = 20;
                barrier.wait();
                store.save(value)
            })
        };
        barrier.wait();
        old.join().unwrap().unwrap();
        new.join().unwrap().unwrap();
        let entries = store.list(None, None);
        assert_eq!(entries[0].cwd, "/new");
        assert_eq!(entries[0].branch.as_deref(), Some("feature"));
        assert_eq!(entries[0].revision, 20);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn loads_legacy_fixture() {
        let path = test_path("resume-legacy");
        std::fs::write(&path, r#"{"entries":[{"id":"old","projectId":null,"cliId":"codex","sessionId":"s","cwd":"/tmp","branch":null,"capturedAt":"2026-01-01T00:00:00Z","lastSeenAt":"2026-01-01T00:00:00Z"}]}"#).unwrap();
        let store = ResumeStore::at(path.clone()).unwrap();
        assert_eq!(store.list(None, None)[0].id, "old");
        let _ = std::fs::remove_file(path);
    }
}
