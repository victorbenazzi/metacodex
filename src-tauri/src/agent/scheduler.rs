use std::collections::HashSet;
use std::time::Duration;

use chrono::{DateTime, Datelike, Local, Timelike};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

use crate::agent::cron;
use crate::agent::entities::{self, AgentEntity};
use crate::agent::life;
use crate::agent::runtime::EntityTurnRequest;
use crate::agent::AgentRuntime;
use crate::config_paths;
use crate::error::{AppError, AppResult};

/// One execution of a task. The `session_id` is the opencode session the run
/// happened in, so the UI can open it as a chat thread.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CronRun {
    pub ran_at: i64,
    pub session_id: Option<String>,
    /// `"ok"` or `"error: ..."`.
    pub status: String,
}

/// A recurring task: run `prompt` on `model` whenever the standard cron
/// expression `cron` matches the local wall clock. The expression is the
/// portability artifact: the exact string a future external scheduler
/// (trigger.dev / Railway / GitHub Actions) would consume to drive `fire`. The
/// local loop only fires while the app is open (the always-on story is the cloud
/// trigger). Persisted to `~/.metacodex/state/agent-cron.json`.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CronTask {
    pub id: String,
    pub title: String,
    pub prompt: String,
    /// Standard 5-field cron expression (`minute hour day-of-month month day-of-week`).
    pub cron: String,
    /// Project root the run executes inside (threaded to opencode as `?directory=`).
    /// None = the sidecar's launch cwd (almost never what you want).
    #[serde(default)]
    pub directory: Option<String>,
    /// Agent entity (slug) this task belongs to. None = a standalone task
    /// (the original behavior: full-auto, no identity). Some = the run is an
    /// Execution of that agent: its persona, memory, preset, log and report.
    #[serde(default)]
    pub agent_id: Option<String>,
    pub provider_id: String,
    pub model_id: String,
    pub enabled: bool,
    /// Epoch ms of the next fire, for display. Derived from `cron`; never the
    /// source of truth for firing (that is a live match against the clock).
    #[serde(default)]
    pub next_run_at: Option<i64>,
    #[serde(default)]
    pub last_run_at: Option<i64>,
    #[serde(default)]
    pub last_session_id: Option<String>,
    /// `"ok"` or `"error: ..."`: last outcome, surfaced in the UI.
    #[serde(default)]
    pub last_status: Option<String>,
    #[serde(default)]
    pub run_count: u32,
    /// Wall-clock minute stamp (yyyyMMddHHmm, local) of the last fire. Guards
    /// against double-firing when the tick runs more than once per minute, and
    /// being wall-clock based it also keeps the repeated fall-back DST hour to
    /// a single fire (same wall minute occurs twice in epoch time).
    #[serde(default)]
    pub last_fired_minute: Option<i64>,
    /// Recent run history (newest first), capped. Powers the sidebar task groups.
    #[serde(default)]
    pub runs: Vec<CronRun>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CronFile {
    tasks: Vec<CronTask>,
}

/// Create/update payload from the frontend (id + bookkeeping filled in here).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronInput {
    pub title: String,
    pub prompt: String,
    pub cron: String,
    #[serde(default)]
    pub directory: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    pub provider_id: String,
    pub model_id: String,
}

/// Next fire of an already-parsed schedule after `now`, as epoch ms.
fn next_run_ms_of(schedule: &cron::CronSchedule, now: &DateTime<Local>) -> Option<i64> {
    schedule.next_after(now).map(|d| d.timestamp_millis())
}

/// Local wall-clock minute as a sortable stamp (yyyyMMddHHmm). Matching is
/// wall-clock (`cron::matches` on `DateTime<Local>`), so the dedupe stamp must
/// be wall-clock too: an epoch-minute stamp would let the repeated DST
/// fall-back hour fire twice. The skipped spring-forward hour simply never
/// matches (documented behavior, not Vixie's run-after-jump).
fn local_minute_stamp(now: &DateTime<Local>) -> i64 {
    (now.year() as i64) * 100_000_000
        + (now.month() as i64) * 1_000_000
        + (now.day() as i64) * 10_000
        + (now.hour() as i64) * 100
        + (now.minute() as i64)
}

/// Single home for "what is the next fire of this cron expression", as epoch ms.
/// Display only (feeds `next_run_at`); firing is always a live match in `take_due`.
fn next_run_ms(cron_expr: &str, now: &DateTime<Local>) -> Option<i64> {
    cron::parse(cron_expr)
        .ok()
        .and_then(|s| next_run_ms_of(&s, now))
}

pub struct CronStore {
    tasks: Mutex<Vec<CronTask>>,
    /// Task ids with a run currently in flight (scheduled or manual). Guards
    /// against overlapping full-auto runs of the same task piling up when a run
    /// outlives its interval. Not persisted: in-flight state dies with the app.
    running: Mutex<HashSet<String>>,
}

impl CronStore {
    pub fn load() -> Self {
        // `read_json_backed`: a corrupt file is renamed aside, never silently
        // replaced (the boot persist below would otherwise destroy the only
        // copy of every scheduled task).
        let tasks = config_paths::state_dir()
            .map(|d| d.join("agent-cron.json"))
            .and_then(|p| config_paths::read_json_backed::<CronFile>(&p))
            .map(|f| f.tasks)
            .unwrap_or_default();
        let store = Self {
            tasks: Mutex::new(tasks),
            running: Mutex::new(HashSet::new()),
        };
        // Refresh next-run estimates for the UI after a (possibly long) downtime.
        store.refresh_next_runs();
        store.persist();
        store
    }

    /// Claim an in-flight slot for the task. False = a run is already going.
    fn try_begin_run(&self, id: &str) -> bool {
        self.running.lock().insert(id.to_string())
    }

    fn end_run(&self, id: &str) {
        self.running.lock().remove(id);
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

    pub fn get(&self, id: &str) -> Option<CronTask> {
        self.tasks.lock().iter().find(|t| t.id == id).cloned()
    }

    pub fn create(&self, input: CronInput) -> AppResult<CronTask> {
        let schedule = cron::parse(&input.cron)
            .map_err(|e| AppError::Other(format!("invalid cron expression: {e}")))?;
        let next = next_run_ms_of(&schedule, &Local::now());
        // Parseable but never matching (e.g. `0 0 31 2 *`): reject at save time
        // instead of persisting a task that silently never fires.
        if next.is_none() {
            return Err(AppError::Other(
                "cron expression never matches (check the day-of-month / month combination)".into(),
            ));
        }

        let task = CronTask {
            id: Uuid::new_v4().to_string(),
            title: input.title,
            prompt: input.prompt,
            cron: input.cron,
            directory: input.directory,
            agent_id: input.agent_id,
            provider_id: input.provider_id,
            model_id: input.model_id,
            enabled: true,
            next_run_at: next,
            last_run_at: None,
            last_session_id: None,
            last_status: None,
            run_count: 0,
            last_fired_minute: None,
            runs: Vec::new(),
        };
        self.tasks.lock().push(task.clone());
        self.persist();
        Ok(task)
    }

    pub fn update(&self, id: &str, input: CronInput) -> AppResult<CronTask> {
        let schedule = cron::parse(&input.cron)
            .map_err(|e| AppError::Other(format!("invalid cron expression: {e}")))?;
        let next = next_run_ms_of(&schedule, &Local::now());
        if next.is_none() {
            return Err(AppError::Other(
                "cron expression never matches (check the day-of-month / month combination)".into(),
            ));
        }

        let mut tasks = self.tasks.lock();
        let task = tasks
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("cron task {id}")))?;
        task.title = input.title;
        task.prompt = input.prompt;
        task.cron = input.cron;
        task.directory = input.directory;
        task.agent_id = input.agent_id;
        task.provider_id = input.provider_id;
        task.model_id = input.model_id;
        task.next_run_at = next;
        let snapshot = task.clone();
        drop(tasks);
        self.persist();
        Ok(snapshot)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let removed = {
            let mut tasks = self.tasks.lock();
            let before = tasks.len();
            tasks.retain(|t| t.id != id);
            tasks.len() != before
        };
        if !removed {
            return Err(AppError::NotFound(format!("cron task {id}")));
        }
        self.persist();
        Ok(())
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> AppResult<()> {
        {
            let mut tasks = self.tasks.lock();
            let task = tasks
                .iter_mut()
                .find(|t| t.id == id)
                .ok_or_else(|| AppError::NotFound(format!("cron task {id}")))?;
            task.enabled = enabled;
            task.next_run_at = if enabled {
                next_run_ms(&task.cron, &Local::now())
            } else {
                None
            };
        }
        self.persist();
        Ok(())
    }

    /// Recompute every task's `next_run_at` from its cron expression (display
    /// only). Called on load so the UI shows a fresh estimate after downtime.
    fn refresh_next_runs(&self) {
        let now = Local::now();
        let mut tasks = self.tasks.lock();
        for t in tasks.iter_mut() {
            t.next_run_at = if t.enabled {
                next_run_ms(&t.cron, &now)
            } else {
                None
            };
        }
    }

    /// Collect the tasks that should fire at `now`, claiming each (stamping its
    /// fired-minute and advancing the displayed next-run) so a second tick in the
    /// same minute won't double-fire. Returns snapshots to run.
    fn take_due(&self, now: &chrono::DateTime<Local>) -> Vec<CronTask> {
        let minute = local_minute_stamp(now);
        let now_ms_v = now.timestamp_millis();
        let mut due = Vec::new();
        let mut changed = false;
        {
            let mut tasks = self.tasks.lock();
            for t in tasks.iter_mut() {
                if !t.enabled {
                    continue;
                }
                // Heal a stale display estimate (e.g. the Mac slept through the
                // fire): the missed run is skipped by design, but the card must
                // not keep showing a next-run in the past.
                if t.next_run_at.is_some_and(|n| n < now_ms_v - 60_000) {
                    t.next_run_at = next_run_ms(&t.cron, now);
                    changed = true;
                }
                if t.last_fired_minute == Some(minute) {
                    continue;
                }
                let Ok(schedule) = cron::parse(&t.cron) else {
                    continue;
                };
                if schedule.matches(now) {
                    t.last_fired_minute = Some(minute);
                    t.next_run_at = next_run_ms_of(&schedule, now);
                    due.push(t.clone());
                    changed = true;
                }
            }
        }
        if changed {
            self.persist();
        }
        due
    }

    /// Record the outcome of a run (manual or scheduled). Does NOT touch the
    /// schedule, `take_due` already advanced it for scheduled fires, and a
    /// manual "run now" must not shift the next scheduled occurrence.
    pub fn record_result(&self, id: &str, session_id: Option<String>, status: String) {
        if let Some(t) = self.tasks.lock().iter_mut().find(|t| t.id == id) {
            let now = now_ms();
            t.last_run_at = Some(now);
            t.last_session_id = session_id.clone();
            t.last_status = Some(status.clone());
            t.run_count = t.run_count.saturating_add(1);
            t.runs.insert(0, CronRun {
                ran_at: now,
                session_id,
                status,
            });
            t.runs.truncate(30);
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
/// "run now" command. Bookkeeping for the schedule itself happens in `take_due`
/// (loop); this only records the outcome. A task with a run still in flight is
/// refused (overlap guard), so a slow run can never stack concurrent full-auto
/// agents on the same directory.
pub async fn fire(app: &AppHandle, task: &CronTask) -> AppResult<()> {
    let store = app.state::<CronStore>();
    if !store.try_begin_run(&task.id) {
        return Err(AppError::Other(format!(
            "task {:?} is already running",
            task.title
        )));
    }
    let result = run_once(app, task).await;
    match &result {
        Ok(session_id) => {
            store.record_result(&task.id, Some(session_id.clone()), "ok".into());
            notify(app, "metacodex", &format!("Ran scheduled task: {}", task.title));
        }
        Err(e) => {
            store.record_result(&task.id, None, format!("error: {e}"));
            // An unattended run that broke deserves the same visibility a
            // successful one gets.
            notify(app, "metacodex", &format!("Scheduled task failed: {}", task.title));
        }
    }
    store.end_run(&task.id);
    result.map(|_| ())
}

/// The actual headless run, with a defense-in-depth roots check: a full-auto
/// agent must never be pointed outside a registered project root, even by a
/// stale task persisted before the project was removed.
async fn run_once(app: &AppHandle, task: &CronTask) -> AppResult<String> {
    if let Some(dir) = task.directory.as_deref().filter(|d| !d.trim().is_empty()) {
        let projects = app.state::<std::sync::Arc<crate::projects::ProjectsCache>>();
        if projects.find_owner(dir).is_none() {
            return Err(AppError::Other(format!(
                "directory {dir:?} is not inside a registered project"
            )));
        }
    }
    // A task assigned to an agent entity runs as an EXECUTION of that agent
    // (decision C of AGENTS_DESIGN.md): persona + memory + its own preset +
    // log/report/dream bookkeeping. A standalone task keeps the original
    // full-auto `run_prompt` path byte for byte.
    if let Some(slug) = task.agent_id.as_deref().filter(|s| !s.trim().is_empty()) {
        let entity = find_entity(slug)?;
        return run_entity_execution(
            app,
            &entity,
            "cron",
            &task.title,
            &task.prompt,
            task.directory.as_deref(),
            Some((&task.provider_id, &task.model_id)),
        )
        .await;
    }
    let runtime = app.state::<AgentRuntime>();
    runtime
        .run_prompt(
            &task.prompt,
            &task.provider_id,
            &task.model_id,
            task.directory.as_deref(),
        )
        .await
}

fn find_entity(slug: &str) -> AppResult<AgentEntity> {
    let dir = config_paths::agents_dir()?;
    entities::scan_entities(&dir)
        .into_iter()
        .find(|e| e.id == slug)
        .ok_or_else(|| AppError::NotFound(format!("agent {slug}")))
}

/// Model fallback chain for runs without an explicit model: the entity's pin,
/// else the user's settings.json pick (read opaquely), else the GO default.
fn resolve_model(entity: &AgentEntity, over: Option<(&str, &str)>) -> (String, String) {
    if let Some((p, m)) = over.filter(|(p, m)| !p.is_empty() && !m.is_empty()) {
        return (p.to_string(), m.to_string());
    }
    if let (Some(p), Some(m)) = (&entity.provider_id, &entity.model_id) {
        return (p.clone(), m.clone());
    }
    let settings = config_paths::settings_file()
        .and_then(|p| config_paths::read_json::<serde_json::Value>(&p))
        .unwrap_or(serde_json::Value::Null);
    let agent = settings.get("agent");
    let pick = |key: &str| {
        agent
            .and_then(|a| a.get(key))
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    (
        pick("providerId").unwrap_or_else(|| "opencode-go".into()),
        // Mirror of DEFAULT_MODEL in chat.store.ts.
        pick("modelId").unwrap_or_else(|| "deepseek-v4-flash".into()),
    )
}

/// Orchestrate one EXECUTION of an agent entity (AGENTS_DESIGN.md phases 3-4):
/// memory-context system block, the entity's permission preset (decision B),
/// the continuation loop with its cap, then report + run log + git checkpoint
/// + dream bookkeeping. Returns the (last) session id.
///
/// Returns a BOXED future on purpose: executions spawn dreams and a dream is
/// itself an execution; with an opaque future type that cycle would be
/// unprovable as `Send`.
pub fn run_entity_execution<'a>(
    app: &'a AppHandle,
    entity: &'a AgentEntity,
    trigger: &'a str,
    title: &'a str,
    prompt: &'a str,
    directory: Option<&'a str>,
    model_override: Option<(&'a str, &'a str)>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<String>> + Send + 'a>> {
    Box::pin(async move {
    let home = config_paths::agents_dir()?.join(&entity.id);
    if !home.is_dir() {
        return Err(AppError::NotFound(format!("agent home for {}", entity.id)));
    }

    // Projects-list guard: an autonomous run may only touch directories that
    // resolve to a project this agent is allowed in (its `projects` config).
    if let Some(dir) = directory.filter(|d| !d.trim().is_empty()) {
        if dir != home.to_string_lossy() {
            let projects = app.state::<std::sync::Arc<crate::projects::ProjectsCache>>();
            let owner = projects.find_owner(dir).ok_or_else(|| {
                AppError::Other(format!("directory {dir:?} is not inside a registered project"))
            })?;
            if let Some(allowed) = &entity.projects {
                if !allowed.contains(&owner.0) {
                    return Err(AppError::Other(format!(
                        "agent {:?} is not allowed to work in project {:?}",
                        entity.id, owner.1
                    )));
                }
            }
        }
    }

    let (provider_id, model_id) = resolve_model(entity, model_override);
    let system = format!(
        "{}\n\n{}",
        life::memory_context(&home, directory),
        life::autonomous_instructions()
    );

    // Permission-pending notification (decision B): fired at most once per
    // turn; the user opens the run's conversation from the sidebar to answer.
    let pending = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let on_pending: std::sync::Arc<dyn Fn() + Send + Sync> = {
        let app = app.clone();
        let pending = pending.clone();
        let name = entity.name.clone();
        std::sync::Arc::new(move || {
            pending.store(true, std::sync::atomic::Ordering::Relaxed);
            notify(
                &app,
                "metacodex",
                &format!("{name} needs your approval to continue"),
            );
        })
    };

    let runtime = app.state::<AgentRuntime>();
    let started_at = now_ms();
    let mut continuations: u32 = 0;
    let mut current_prompt = prompt.to_string();
    let mut last_session = String::new();
    let mut final_text = String::new();
    let mut status = "ok".to_string();

    loop {
        let turn = runtime
            .run_entity_turn(EntityTurnRequest {
                agent_name: &entity.opencode_name,
                preset: &entity.permission_preset,
                provider_id: &provider_id,
                model_id: &model_id,
                variant: entity.variant.as_deref(),
                directory,
                system: Some(system.clone()),
                prompt: &current_prompt,
                on_permission_pending: Some(on_pending.clone()),
            })
            .await;

        match turn {
            Ok(outcome) => {
                last_session = outcome.session_id;
                final_text = outcome.final_text;
                if outcome.aborted {
                    status = if pending.load(std::sync::atomic::Ordering::Relaxed) {
                        "needs-you".into()
                    } else {
                        "aborted".into()
                    };
                    break;
                }
            }
            Err(e) => {
                status = format!("error: {e}");
                break;
            }
        }

        // Continuation protocol: the model asked for a fresh session (or a
        // delayed wake-up), bounded by the entity's cap.
        match life::parse_continuation(&final_text) {
            Some((delay_min, summary)) if continuations < entity.continuation_cap => {
                continuations += 1;
                if delay_min > 0 {
                    tokio::time::sleep(Duration::from_secs(delay_min * 60)).await;
                }
                current_prompt = format!(
                    "You are continuing an unfinished task (continuation {continuations} of max {cap}).\n\
                     Your own state summary from the previous session: {summary}\n\n\
                     Original task:\n{prompt}",
                    cap = entity.continuation_cap,
                );
            }
            Some(_) => {
                status = "ok (continuation cap reached)".into();
                break;
            }
            None => break,
        }
    }

    // Heartbeat with nothing to do: log-only, suppressed (no report, no noise).
    let quiet = trigger == "heartbeat" && final_text.trim() == life::HEARTBEAT_OK;

    if !quiet {
        let report_status = match status.as_str() {
            "ok" | "ok (continuation cap reached)" => "ok",
            "needs-you" => "needs-you",
            "aborted" => "aborted",
            _ => "error",
        };
        let body = if final_text.trim().is_empty() {
            format!("(no final text; status: {status})")
        } else {
            final_text.clone()
        };
        if let Err(e) = life::write_report(&home, title, trigger, report_status, directory, &body) {
            eprintln!("[metacodex] agent report write failed: {e}");
        }
    }
    life::append_run_log(
        &home,
        &life::RunLogEntry {
            trigger: trigger.to_string(),
            started_at,
            finished_at: now_ms(),
            status: if quiet { "ok-quiet".into() } else { status.clone() },
            session_id: if last_session.is_empty() { None } else { Some(last_session.clone()) },
            directory: directory.map(String::from),
            continuations,
        },
    );

    // Dream bookkeeping: real work (not heartbeats, not dreams) feeds the
    // counter; hitting the threshold fires a dream and resets it.
    if trigger != "dream" && trigger != "heartbeat" && status.starts_with("ok") {
        let mut state = life::read_state(&home);
        state.runs_since_dream = state.runs_since_dream.saturating_add(1);
        let due = state.runs_since_dream >= entity.dream_after_runs;
        if due {
            state.runs_since_dream = 0;
            state.last_dream_at = Some(now_ms());
        }
        life::write_state(&home, &state);
        if due {
            let app = app.clone();
            let entity = entity.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = fire_dream(&app, &entity).await {
                    eprintln!("[metacodex] dream for {} failed: {e}", entity.id);
                }
            });
        }
    }

    if let Err(e) = entities::checkpoint(&home, &format!("{trigger} execution")) {
        eprintln!("[metacodex] agent git checkpoint failed for {}: {e}", entity.id);
    }

    if status == "ok" || status == "ok (continuation cap reached)" || quiet {
        Ok(last_session)
    } else if status == "needs-you" {
        Err(AppError::Other("run aborted waiting for an approval".into()))
    } else if status == "aborted" {
        Err(AppError::Other("run timed out and was aborted".into()))
    } else {
        Err(AppError::Other(status))
    }
    })
}

/// A DREAM execution: maintenance about the agent itself. Runs full-auto with
/// the agent HOME as its working directory, so the session's whole world is
/// the home (memory consolidation, journal, proposals); the prompt forbids
/// touching projects and the directory scoping backs that up.
async fn fire_dream(app: &AppHandle, entity: &AgentEntity) -> AppResult<()> {
    let home = config_paths::agents_dir()?.join(&entity.id);
    let prompt = life::dream_prompt(&home);
    let home_s = home.to_string_lossy().to_string();
    // Dream bypasses the projects guard by running IN the home itself; the
    // entity's preset is overridden to full-auto deliberately: a dream only
    // writes inside the home and must run unattended (AGENTS_DESIGN.md).
    let dream_entity = AgentEntity {
        permission_preset: "full-auto".into(),
        ..entity.clone()
    };
    run_entity_execution(app, &dream_entity, "dream", "Dream", &prompt, Some(&home_s), None)
        .await
        .map(|_| ())
}

/// A HEARTBEAT execution (phase 4): the standing-checklist pulse. Runs with
/// the agent's own preset, in the agent home (checklist items reference
/// project paths explicitly when they need one).
async fn fire_heartbeat(app: &AppHandle, entity: &AgentEntity) -> AppResult<()> {
    let home = config_paths::agents_dir()?.join(&entity.id);
    let prompt = life::heartbeat_prompt(&home);
    let home_s = home.to_string_lossy().to_string();
    run_entity_execution(app, entity, "heartbeat", "Heartbeat", &prompt, Some(&home_s), None)
        .await
        .map(|_| ())
}

/// Heartbeats due at `now`: entities with heartbeat enabled whose interval has
/// elapsed (or that never beat). Claiming happens by stamping
/// `last_heartbeat_at` BEFORE the run, which also collapses every heartbeat
/// missed while the app was closed into the single catch-up fire.
fn take_due_heartbeats(now_ms_v: i64) -> Vec<AgentEntity> {
    let Ok(dir) = config_paths::agents_dir() else { return Vec::new() };
    let mut due = Vec::new();
    for entity in entities::scan_entities(&dir) {
        if !entity.heartbeat.enabled {
            continue;
        }
        let home = dir.join(&entity.id);
        let mut state = life::read_state(&home);
        let interval_ms = (entity.heartbeat.interval_minutes as i64) * 60_000;
        let elapsed = state
            .last_heartbeat_at
            .map(|last| now_ms_v - last >= interval_ms)
            .unwrap_or(true);
        if elapsed {
            state.last_heartbeat_at = Some(now_ms_v);
            life::write_state(&home, &state);
            due.push(entity);
        }
    }
    due
}

/// Background tick: a few times a minute, fire any task whose cron matches the
/// current minute. Sub-minute cadence so an `* * * * *` schedule never misses,
/// with per-minute claiming so it never double-fires. Cheap when nothing is due.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(20)).await;
            let now = Local::now();
            let due = app.state::<CronStore>().take_due(&now);
            for task in due {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = fire(&app, &task).await {
                        eprintln!("[metacodex] cron task {} failed: {e}", task.id);
                    }
                });
            }

            // Heartbeats (phase 4): claimed by stamping last_heartbeat_at, so
            // a crash mid-run skips at most one interval instead of stacking.
            // The CronStore running set guards overlap (`hb:<slug>` keys).
            for entity in take_due_heartbeats(now.timestamp_millis()) {
                let store = app.state::<CronStore>();
                let key = format!("hb:{}", entity.id);
                if !store.try_begin_run(&key) {
                    continue;
                }
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = fire_heartbeat(&app, &entity).await {
                        eprintln!("[metacodex] heartbeat for {} failed: {e}", entity.id);
                    }
                    app.state::<CronStore>().end_run(&format!("hb:{}", entity.id));
                });
            }
        }
    });
}
