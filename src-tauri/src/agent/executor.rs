//! Executor of agent-entity EXECUTIONS (AGENTS_DESIGN.md phases 3-4): the
//! orchestration of one autonomous run (memory context, the entity's preset,
//! the continuation loop, report + run log + git checkpoint + dream
//! bookkeeping) plus the heartbeat/dream firing helpers. Pure orchestration:
//! the HTTP turn itself lives in `runtime.rs`, the file formats in `life.rs`,
//! and the cron scheduling (when something fires) in `scheduler.rs`.

use std::time::Duration;

use parking_lot::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::agent::entities::{self, AgentEntity};
use crate::agent::life;
use crate::agent::runtime::EntityTurnRequest;
use crate::agent::scheduler::CronStore;
use crate::agent::AgentRuntime;
use crate::config_paths;
use crate::error::{AppError, AppResult};

pub(crate) fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub(crate) fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Terminal outcome of one run, rich enough for the history row. The session
/// id survives FAILED runs too: a "needs-you" run is exactly the one the user
/// must open from the history to answer the pending approval.
pub struct RunOutcome {
    pub session_id: Option<String>,
    /// "ok" or a terminal failure label ("needs-you", "aborted",
    /// "incomplete (continuation cap reached)", "error: ...").
    pub status: String,
    pub ok: bool,
}


pub fn find_entity(slug: &str) -> AppResult<AgentEntity> {
    let dir = config_paths::agents_dir()?;
    entities::scan_entities_light(&dir)
        .into_iter()
        .find(|e| e.id == slug)
        .ok_or_else(|| AppError::NotFound(format!("agent {slug}")))
}

/// Live status of each entity for the agents list: "working" while a run is
/// in flight, "needs-you" after a run ended waiting on the user (sticky until
/// the next run), absent = idle. In-memory only; dies with the app like the
/// running set.
fn entity_status_registry() -> &'static Mutex<std::collections::HashMap<String, String>> {
    static REG: std::sync::OnceLock<Mutex<std::collections::HashMap<String, String>>> =
        std::sync::OnceLock::new();
    REG.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

pub fn entity_status_map() -> std::collections::HashMap<String, String> {
    entity_status_registry().lock().clone()
}

fn set_entity_status(slug: &str, status: &str) {
    let mut map = entity_status_registry().lock();
    if status == "idle" {
        map.remove(slug);
    } else {
        map.insert(slug.to_string(), status.to_string());
    }
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
/// + dream bookkeeping.
///
/// Concurrency: the whole run holds an `entity:<slug>` claim in the running
/// set, so two executions (cron, heartbeat, dream, run-now) of the SAME entity
/// never overlap in its home; a busy entity refuses the run. Short critical
/// sections over `state.json`/git additionally take `entities::state_mutex`.
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
) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<RunOutcome>> + Send + 'a>> {
    Box::pin(async move {
        let store = app.state::<CronStore>();
        let entity_key = format!("entity:{}", entity.id);
        if !store.try_begin_run(&entity_key) {
            return Err(AppError::Other(format!(
                "agent {:?} is already running",
                entity.id
            )));
        }
        set_entity_status(&entity.id, "working");
        let result = run_entity_inner(app, entity, trigger, title, prompt, directory, model_override).await;
        store.end_run(&entity_key);
        match result {
            Ok((outcome, dream_due)) => {
                set_entity_status(
                    &entity.id,
                    if outcome.status == "needs-you" || outcome.status.starts_with("incomplete") {
                        "needs-you"
                    } else {
                        "idle"
                    },
                );
                // The dream is spawned AFTER the entity claim is released so it
                // can claim the slot itself. If something else grabs it first,
                // the dream simply doesn't run now; the counter was NOT reset
                // (only a completed dream resets it), so the next ok execution
                // re-triggers it. Self-healing, no lost dreams.
                if dream_due {
                    let app = app.clone();
                    let entity = entity.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = fire_dream(&app, &entity).await {
                            eprintln!("[metacodex] dream for {} failed: {e}", entity.id);
                        }
                    });
                }
                Ok(outcome)
            }
            Err(e) => {
                set_entity_status(&entity.id, "idle");
                Err(e)
            }
        }
    })
}

async fn run_entity_inner(
    app: &AppHandle,
    entity: &AgentEntity,
    trigger: &str,
    title: &str,
    prompt: &str,
    directory: Option<&str>,
    model_override: Option<(&str, &str)>,
) -> AppResult<(RunOutcome, bool)> {
    let home = config_paths::agents_dir()?.join(&entity.id);
    if !home.is_dir() {
        return Err(AppError::NotFound(format!("agent home for {}", entity.id)));
    }
    let home_s = home.to_string_lossy().to_string();
    let is_home_run = directory.is_some_and(|d| d == home_s);

    // Projects-list guard: an autonomous run may only touch directories that
    // resolve to a project this agent is allowed in (its `projects` config).
    if let Some(dir) = directory.filter(|d| !d.trim().is_empty()) {
        if !is_home_run {
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
    // Heartbeat/dream run IN the home; the home is not a project, so the
    // project memory layer must not be keyed on it.
    let memory_dir = directory.filter(|_| !is_home_run);
    let system = format!(
        "{}\n\n{}",
        life::memory_context(&home, memory_dir),
        life::autonomous_instructions()
    );

    // Permission-pending notification (decision B): fired at most once per
    // turn. Besides the OS notification, a "pending" row lands in runs.jsonl
    // immediately so the Activity tab can open the run's conversation WHILE
    // it waits (heartbeat/dream sessions live in the home and appear in no
    // project's sidebar; this row is their only handle).
    let on_pending: std::sync::Arc<dyn Fn(&str) + Send + Sync> = {
        let app = app.clone();
        let name = entity.name.clone();
        let slug = entity.id.clone();
        let home = home.clone();
        let trigger_s = trigger.to_string();
        let directory_s = directory.map(String::from);
        let pending_started = now_ms();
        std::sync::Arc::new(move |session_id: &str| {
            set_entity_status(&slug, "needs-you");
            {
                let lock = entities::state_mutex(&slug);
                let _guard = lock.lock();
                life::append_run_log(
                    &home,
                    &life::RunLogEntry {
                        trigger: trigger_s.clone(),
                        started_at: pending_started,
                        finished_at: now_ms(),
                        status: "needs-you (pending)".into(),
                        session_id: Some(session_id.to_string()),
                        directory: directory_s.clone(),
                        continuations: 0,
                    },
                );
            }
            notify(
                &app,
                "metacodex",
                &format!("{name} needs your approval to continue"),
            );
        })
    };

    let runtime = app.state::<AgentRuntime>();
    // Hand-edits of AGENT.md/agent.json never pass through the frontend's
    // hot-apply, and a failed dispose there would leave the compiled agent
    // stale (or unknown) in the live sidecar. Regenerate + dispose here so an
    // autonomous run always sees the current entity. Cheap and idempotent.
    if let Err(e) = crate::agent::mcp::regenerate_opencode_config() {
        eprintln!("[metacodex] opencode config regenerate failed: {e}");
    }
    runtime.dispose_global().await;

    let started_at = now_ms();
    let mut continuations: u32 = 0;
    let mut current_prompt = prompt.to_string();
    let mut last_session = String::new();
    let mut final_text = String::new();
    let mut status = "ok".to_string();
    let mut ok = true;

    loop {
        let turn = runtime
            .run_entity_turn(EntityTurnRequest {
                agent_name: Some(&entity.opencode_name),
                preset: &entity.permission_preset,
                provider_id: &provider_id,
                model_id: &model_id,
                variant: entity.variant.as_deref(),
                directory,
                system: Some(system.clone()),
                prompt: &current_prompt,
                on_permission_pending: Some(on_pending.clone()),
                auto_approve_dir: Some(home_s.clone()),
            })
            .await;

        match turn {
            Ok(outcome) => {
                last_session = outcome.session_id;
                final_text = outcome.final_text;
                if outcome.aborted {
                    status = if outcome.permission_pending {
                        "needs-you".into()
                    } else {
                        "aborted".into()
                    };
                    ok = false;
                    break;
                }
            }
            Err(e) => {
                status = format!("error: {e}");
                ok = false;
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
                // The model still wanted to continue: the task is NOT done.
                status = "incomplete (continuation cap reached)".into();
                ok = false;
                break;
            }
            None => break,
        }
    }

    // Heartbeat with nothing to do: log-only, suppressed (no report, no noise).
    let quiet = trigger == "heartbeat" && final_text.trim() == life::HEARTBEAT_OK;
    // Work happened even when the cap cut it short: it still feeds the dream.
    let worked = ok || status.starts_with("incomplete");

    // Bookkeeping over the home (report, run log, state counters, checkpoint):
    // a short, sync critical section under the per-entity state mutex so a
    // concurrent UI command (memory edit, proposal resolve) can't interleave.
    let mut dream_due = false;
    {
        let lock = entities::state_mutex(&entity.id);
        let _guard = lock.lock();

        if !quiet {
            let report_status = if ok {
                "ok"
            } else {
                match status.as_str() {
                    "needs-you" => "needs-you",
                    "aborted" => "aborted",
                    s if s.starts_with("incomplete") => "needs-you",
                    _ => "error",
                }
            };
            let body = if final_text.trim().is_empty() {
                format!("(no final text; status: {status})")
            } else {
                final_text.clone()
            };
            if let Err(e) =
                life::write_report(&home, title, trigger, report_status, directory, &body)
            {
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

        // Dream bookkeeping: real work feeds the counter; only a COMPLETED
        // dream resets it (see the wrapper for why).
        if trigger == "dream" {
            if ok {
                let mut state = life::read_state(&home);
                state.runs_since_dream = 0;
                state.last_dream_at = Some(now_ms());
                life::write_state(&home, &state);
            }
        } else if trigger != "heartbeat" && worked {
            let mut state = life::read_state(&home);
            state.runs_since_dream = state.runs_since_dream.saturating_add(1);
            dream_due = state.runs_since_dream >= entity.dream_after_runs;
            life::write_state(&home, &state);
        }

        if let Err(e) = entities::checkpoint(&home, &format!("{trigger} execution")) {
            eprintln!("[metacodex] agent git checkpoint failed for {}: {e}", entity.id);
        }
    }

    let outcome = RunOutcome {
        session_id: if last_session.is_empty() { None } else { Some(last_session) },
        status: if quiet { "ok".into() } else { status },
        ok: ok || quiet,
    };
    Ok((outcome, dream_due))
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
    let outcome =
        run_entity_execution(app, &dream_entity, "dream", "Dream", &prompt, Some(&home_s), None)
            .await?;
    if outcome.ok {
        Ok(())
    } else {
        Err(AppError::Other(outcome.status))
    }
}

/// A HEARTBEAT execution (phase 4): the standing-checklist pulse. Runs with
/// the agent's own preset, in the agent home (checklist items reference
/// project paths explicitly when they need one).
pub(crate) async fn fire_heartbeat(app: &AppHandle, entity: &AgentEntity) -> AppResult<()> {
    let home = config_paths::agents_dir()?.join(&entity.id);
    let prompt = life::heartbeat_prompt(&home);
    let home_s = home.to_string_lossy().to_string();
    let outcome =
        run_entity_execution(app, entity, "heartbeat", "Heartbeat", &prompt, Some(&home_s), None)
            .await?;
    if outcome.ok {
        Ok(())
    } else {
        Err(AppError::Other(outcome.status))
    }
}

/// Heartbeats due at `now`: entities with heartbeat enabled whose interval has
/// elapsed (or that never beat). Claiming happens by stamping
/// `last_heartbeat_at` BEFORE the run, which also collapses every heartbeat
/// missed while the app was closed into the single catch-up fire.
pub(crate) fn take_due_heartbeats(now_ms_v: i64) -> Vec<AgentEntity> {
    let Ok(dir) = config_paths::agents_dir() else { return Vec::new() };
    let mut due = Vec::new();
    for entity in entities::scan_entities_light(&dir) {
        if !entity.heartbeat.enabled {
            continue;
        }
        let home = dir.join(&entity.id);
        // The claim is a read-modify-write of state.json; the per-entity state
        // mutex keeps a concurrent execution's bookkeeping from reverting the
        // stamp (which would refire the heartbeat on the next tick).
        let lock = entities::state_mutex(&entity.id);
        let _guard = lock.lock();
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
