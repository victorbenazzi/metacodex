use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

use crate::agent::AgentRuntime;
use crate::config_paths;
use crate::error::AppResult;

/// A recurring task: run `prompt` on `model` every `interval_minutes`. Local
/// scheduling only fires while the app is open (the cloud/Railway path is the
/// always-on story). Persisted to `~/.metacodex/state/agent-cron.json`.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CronTask {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub interval_minutes: u64,
    pub provider_id: String,
    pub model_id: String,
    pub enabled: bool,
    #[serde(default)]
    pub last_run_at: Option<i64>,
    #[serde(default)]
    pub last_session_id: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CronFile {
    tasks: Vec<CronTask>,
}

/// New-task payload from the frontend (id + bookkeeping fields filled in here).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCronTask {
    pub title: String,
    pub prompt: String,
    pub interval_minutes: u64,
    pub provider_id: String,
    pub model_id: String,
}

pub struct CronStore {
    tasks: Mutex<Vec<CronTask>>,
}

impl CronStore {
    pub fn load() -> Self {
        let tasks = config_paths::state_dir()
            .map(|d| d.join("agent-cron.json"))
            .and_then(|p| config_paths::read_json::<CronFile>(&p))
            .map(|f| f.tasks)
            .unwrap_or_default();
        Self {
            tasks: Mutex::new(tasks),
        }
    }

    fn persist(&self) {
        let snapshot = CronFile {
            tasks: self.tasks.lock().clone(),
        };
        if let Ok(dir) = config_paths::state_dir() {
            let path = dir.join("agent-cron.json");
            if let Err(e) = config_paths::write_json_atomic(&path, &snapshot) {
                eprintln!("[metacodex] cron persist failed: {e}");
            }
        }
    }

    pub fn list(&self) -> Vec<CronTask> {
        self.tasks.lock().clone()
    }

    pub fn create(&self, input: NewCronTask, now: i64) -> CronTask {
        let task = CronTask {
            id: Uuid::new_v4().to_string(),
            title: input.title,
            prompt: input.prompt,
            interval_minutes: input.interval_minutes.max(1),
            provider_id: input.provider_id,
            model_id: input.model_id,
            enabled: true,
            // Seed last_run_at to now so the first fire is one interval out, not
            // immediately on the next scheduler tick.
            last_run_at: Some(now),
            last_session_id: None,
        };
        self.tasks.lock().push(task.clone());
        self.persist();
        task
    }

    pub fn delete(&self, id: &str) {
        self.tasks.lock().retain(|t| t.id != id);
        self.persist();
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) {
        if let Some(t) = self.tasks.lock().iter_mut().find(|t| t.id == id) {
            t.enabled = enabled;
        }
        self.persist();
    }

    pub fn get(&self, id: &str) -> Option<CronTask> {
        self.tasks.lock().iter().find(|t| t.id == id).cloned()
    }

    fn due(&self, now: i64) -> Vec<CronTask> {
        self.tasks
            .lock()
            .iter()
            .filter(|t| {
                t.enabled
                    && match t.last_run_at {
                        Some(last) => now - last >= (t.interval_minutes as i64) * 60_000,
                        None => true,
                    }
            })
            .cloned()
            .collect()
    }

    pub fn mark_ran(&self, id: &str, now: i64, session_id: Option<String>) {
        if let Some(t) = self.tasks.lock().iter_mut().find(|t| t.id == id) {
            t.last_run_at = Some(now);
            t.last_session_id = session_id;
        }
        self.persist();
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Run one scheduled task now and record the result. Shared by the loop and the
/// "run now" command.
pub async fn fire(app: &AppHandle, task: &CronTask) -> AppResult<()> {
    let runtime = app.state::<AgentRuntime>();
    let session_id = runtime
        .run_prompt(&task.prompt, &task.provider_id, &task.model_id)
        .await?;
    app.state::<CronStore>()
        .mark_ran(&task.id, now_ms(), Some(session_id));
    notify(app, "metacodex", &format!("Ran scheduled task: {}", task.title));
    Ok(())
}

/// Background tick: every minute, fire any due tasks. Cheap when there are none.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let due = app.state::<CronStore>().due(now_ms());
            for task in due {
                if let Err(e) = fire(&app, &task).await {
                    eprintln!("[metacodex] cron task {} failed: {e}", task.id);
                }
            }
        }
    });
}
