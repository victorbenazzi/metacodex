//! Read/write `~/.metacodex/state/whats-new.json`, the post-update changelog
//! marker (last release notes version the user has seen).
//!
//! Same contract as the settings commands: the payload is an opaque
//! `serde_json::Value` so the frontend owns the schema and can evolve it
//! without a Rust recompile.

use serde_json::Value;

use crate::config_paths;
use crate::error::AppResult;

#[tauri::command]
pub async fn read_whats_new() -> AppResult<Value> {
    let path = config_paths::whats_new_file()?;
    let value = config_paths::read_json::<Value>(&path)?;
    Ok(if value.is_null() {
        Value::Object(serde_json::Map::new())
    } else {
        value
    })
}

#[tauri::command]
pub async fn write_whats_new(state: Value) -> AppResult<()> {
    let path = config_paths::whats_new_file()?;
    config_paths::write_json_atomic(&path, &state)
}
