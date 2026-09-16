use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn run(root: &PathBuf, id: &str, payload: &Value) -> std::process::Output {
    run_flag(root, "--metacodex-usage-statusline", id, payload)
}

fn run_flag(root: &PathBuf, flag: &str, id: &str, payload: &Value) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_metacodex"))
        .args([flag, id])
        .env("METACODEX_HOME", root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start helper without a Tauri window");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(payload.to_string().as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn cursor_hook_sanitizes_deduplicates_and_honors_disable() {
    let fixture =
        Fixture(std::env::temp_dir().join(format!("metacodex-cursor-{}", uuid::Uuid::new_v4())));
    let dir = fixture.0.join("state/usage/cursor");
    std::fs::create_dir_all(&dir).unwrap();
    let options = fixture.0.join("state/usage/options.json");
    std::fs::write(&options, r#"{"cursorEnabled":true}"#).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let session = uuid::Uuid::new_v4().to_string();
    let generation = uuid::Uuid::new_v4().to_string();
    let payload = json!({
        "conversation_id":session,"generation_id":generation,"hook_event_name":"afterAgentResponse",
        "input_tokens":123,"output_tokens":0,"cache_read_tokens":42,
        "text":"private reply must not survive", "user_email":"private@example.test", "transcript_path":"/private/transcript"
    });
    let flag = "--metacodex-usage-cursor";
    let sample = dir.join(format!("{session}.{generation}.turn.json"));
    assert!(run_flag(&fixture.0, flag, &id, &payload).status.success());
    assert!(!sample.exists());
    std::fs::write(
        dir.join(format!("{id}.grant.json")),
        json!({"projectId":"fixture", "createdAt":chrono::Utc::now().timestamp()}).to_string(),
    )
    .unwrap();
    for _ in 0..2 {
        let result = run_flag(&fixture.0, flag, &id, &payload);
        assert!(result.status.success());
        assert!(result.stdout.is_empty());
    }
    let saved = std::fs::read_to_string(&sample).unwrap();
    assert!(!saved.contains("private"));
    let value: Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(value["inputTokens"], "123");
    assert_eq!(value["outputTokens"], "0");
    assert_eq!(value["cacheWriteTokens"], Value::Null);
    assert_eq!(
        std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|f| f.file_name().to_string_lossy().ends_with(".turn.json"))
            .count(),
        1
    );
    std::fs::write(options, r#"{"cursorEnabled":false}"#).unwrap();
    let mut changed = payload;
    changed["input_tokens"] = json!(999);
    run_flag(&fixture.0, flag, &id, &changed);
    assert_eq!(std::fs::read_to_string(sample).unwrap(), saved);
}

#[test]
fn helper_requires_a_grant_sanitizes_payload_and_honors_disable() {
    let fixture = Fixture(
        std::env::temp_dir().join(format!("metacodex-usage-test-{}", uuid::Uuid::new_v4())),
    );
    let dir = fixture.0.join("state/usage/claude");
    std::fs::create_dir_all(&dir).unwrap();
    let options = fixture.0.join("state/usage/options.json");
    std::fs::write(&options, r#"{"claudeEnabled":true}"#).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let payload = json!({
        "session_id":session_id, "prompt":"must never be saved",
        "transcript_path":"/private/transcript", "cost":{"total_cost_usd":1.25},
        "rate_limits":{"five_hour":{"used_percentage":42,"resets_at":now + 3600}}
    });
    let absent = run(&fixture.0, &id, &payload);
    assert!(absent.status.success());
    assert!(absent.stdout.is_empty());
    let sample = dir.join(format!("{id}.sample.json"));
    assert!(!sample.exists());
    std::fs::write(
        dir.join(format!("{id}.grant.json")),
        json!({"projectId":"fixture", "createdAt":now}).to_string(),
    )
    .unwrap();
    let captured = run(&fixture.0, &id, &payload);
    assert!(captured.status.success());
    assert!(String::from_utf8_lossy(&captured.stdout).contains("5h: 42%"));
    let saved = std::fs::read_to_string(&sample).unwrap();
    assert!(!saved.contains("must never be saved"));
    assert!(!saved.contains("transcript"));
    let parsed: Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(parsed["session"]["estimatedCostUsd"], 1.25);
    assert_eq!(parsed["session"]["projectId"], "fixture");
    std::fs::write(options, r#"{"claudeEnabled":false}"#).unwrap();
    run(
        &fixture.0,
        &id,
        &json!({"session_id":session_id,"cost":{"total_cost_usd":9}}),
    );
    assert_eq!(std::fs::read_to_string(sample).unwrap(), saved);
}
