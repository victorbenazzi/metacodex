//! Read/write the user-facing config files under `~/.metacodex`
//! (`settings.json` + `keybindings.json`).
//!
//! These commands are deliberately schema-agnostic: they pass an opaque
//! `serde_json::Value` straight to disk so the frontend can evolve its
//! preferences/keymap shape without requiring a Rust recompile. Validation and
//! defaults live entirely on the TS side.

use serde_json::Value;

use crate::config_paths;
use crate::error::AppResult;

/// Empty JSON object — returned when a config file is absent or unparseable, so
/// the frontend can spread its defaults over a known-shape object.
fn empty_object() -> Value {
    Value::Object(serde_json::Map::new())
}

#[tauri::command]
pub async fn read_settings() -> AppResult<Value> {
    let path = config_paths::settings_file()?;
    let value = config_paths::read_json::<Value>(&path)?;
    Ok(if value.is_null() { empty_object() } else { value })
}

#[tauri::command]
pub async fn write_settings(settings: Value) -> AppResult<()> {
    let path = config_paths::settings_file()?;
    config_paths::write_json_atomic(&path, &settings)
}

#[tauri::command]
pub async fn read_keybindings() -> AppResult<Value> {
    let path = config_paths::keybindings_file()?;
    let value = config_paths::read_json::<Value>(&path)?;
    Ok(if value.is_null() { empty_object() } else { value })
}

#[tauri::command]
pub async fn write_keybindings(keybindings: Value) -> AppResult<()> {
    let path = config_paths::keybindings_file()?;
    config_paths::write_json_atomic(&path, &keybindings)
}
