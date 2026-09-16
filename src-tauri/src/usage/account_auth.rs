//! Credentials stay in Rust. A native picker grants read access to one selected
//! file and its SQLite journal sidecars. No credential is copied into app state.
use super::types::short_string;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Clone, Deserialize, Serialize)]
pub struct AccountGrant {
    path: PathBuf,
}

#[derive(Clone)]
pub struct Credential {
    pub header: String,
    pub fingerprint: String,
    pub label: Option<String>,
}

impl Credential {
    fn new(header: String, label: Option<String>) -> Result<Self, String> {
        if header.is_empty() || header.len() > 32768 || header.chars().any(|c| c.is_control()) {
            return Err("invalidCredential".into());
        }
        let fingerprint = format!("{:x}", Sha256::digest(header.as_bytes()));
        Ok(Self {
            header,
            fingerprint,
            label,
        })
    }
}

impl AccountGrant {
    // Only call with the path returned by the native picker. The frontend never
    // supplies a path or an authorization identifier to the read operation.
    pub fn from_picker(path: PathBuf, provider: &str) -> Result<Self, String> {
        let expected = match provider {
            "cursor-cli" => "state.vscdb",
            "grok" => "auth.json",
            _ => return Err("unsupported".into()),
        };
        if path.file_name().and_then(|n| n.to_str()) != Some(expected) {
            return Err("invalidCredential".into());
        }
        validate_file(
            &path,
            if provider == "grok" {
                1024 * 1024
            } else {
                512 * 1024 * 1024
            },
        )?;
        Ok(Self { path })
    }
    pub fn read(&self, provider: &str) -> Result<Credential, String> {
        match provider {
            "grok" => {
                validate_file(&self.path, 1024 * 1024)?;
                let mut bytes = Vec::new();
                std::fs::File::open(&self.path)
                    .map_err(|_| "signedOut")?
                    .take(1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "signedOut")?;
                if bytes.len() > 1024 * 1024 {
                    return Err("invalidCredential".into());
                }
                grok_credential(&bytes, chrono::Utc::now().timestamp())
            }
            "cursor-cli" => {
                validate_file(&self.path, 512 * 1024 * 1024)?;
                for suffix in ["-wal", "-shm", "-journal"] {
                    let sidecar = PathBuf::from(format!("{}{suffix}", self.path.to_string_lossy()));
                    if sidecar.exists() {
                        validate_file(&sidecar, 512 * 1024 * 1024)?;
                    }
                }
                let db = rusqlite::Connection::open_with_flags(
                    &self.path,
                    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                        | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
                )
                .map_err(|_| "signedOut")?;
                db.busy_timeout(std::time::Duration::from_millis(500))
                    .map_err(|_| "unavailable")?;
                let bytes = db
                    .query_row(
                        "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1",
                        [],
                        |row| {
                            use rusqlite::types::ValueRef;
                            match row.get_ref(0)? {
                                ValueRef::Text(v) | ValueRef::Blob(v) if v.len() <= 32768 => {
                                    Ok(v.to_vec())
                                }
                                _ => Err(rusqlite::Error::InvalidQuery),
                            }
                        },
                    )
                    .map_err(|_| "signedOut")?;
                cursor_token(&decode_token(&bytes)?, chrono::Utc::now().timestamp())
            }
            _ => Err("unsupported".into()),
        }
    }
}

fn validate_file(path: &Path, max: u64) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("invalidCredential".into());
    }
    // Reject symlink replacement in every component, including sidecars.
    let mut walked = PathBuf::new();
    for part in path.components() {
        if matches!(part, std::path::Component::ParentDir) {
            return Err("invalidCredential".into());
        }
        walked.push(part);
        // A Windows drive or UNC prefix is not a complete absolute path until
        // its root component has been appended. Validate starting at that root.
        if matches!(part, std::path::Component::Prefix(_)) {
            continue;
        }
        if std::fs::symlink_metadata(&walked)
            .map_err(|_| "signedOut")?
            .file_type()
            .is_symlink()
        {
            return Err("invalidCredential".into());
        }
    }
    let meta = std::fs::metadata(path).map_err(|_| "signedOut")?;
    if !meta.is_file() || meta.len() > max {
        return Err("invalidCredential".into());
    }
    Ok(())
}

fn decode_token(bytes: &[u8]) -> Result<String, String> {
    let (pairs, remainder) = bytes.as_chunks::<2>();
    if remainder.is_empty() && pairs.iter().all(|pair| pair[1] == 0 && pair[0].is_ascii()) {
        return Ok(pairs.iter().map(|pair| pair[0] as char).collect());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "invalidCredential".into())
}

fn jwt(token: &str, now: i64) -> Result<Value, String> {
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 {
        return Err("invalidCredential".into());
    }
    let payload = URL_SAFE_NO_PAD
        .decode(parts[1].trim_end_matches('='))
        .map_err(|_| "invalidCredential")?;
    let value: Value = serde_json::from_slice(&payload).map_err(|_| "invalidCredential")?;
    if value
        .get("exp")
        .and_then(Value::as_i64)
        .is_some_and(|exp| exp <= now + 60)
    {
        return Err("signedOut".into());
    }
    Ok(value)
}

fn cursor_token(token: &str, now: i64) -> Result<Credential, String> {
    let value = jwt(token, now)?;
    let user = value
        .get("sub")
        .and_then(Value::as_str)
        .and_then(|s| s.rsplit('|').next())
        .filter(|s| {
            !s.is_empty()
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        })
        .ok_or("invalidCredential")?;
    Credential::new(
        format!("WorkosCursorSessionToken={user}%3A%3A{token}"),
        short_string(value.get("email")),
    )
}

pub fn cursor_cookie(input: &str) -> Result<Credential, String> {
    // Accept only this session cookie, not a full browser Cookie header.
    let value = input
        .trim()
        .strip_prefix("WorkosCursorSessionToken=")
        .unwrap_or(input.trim());
    if value.is_empty()
        || value
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b == b';' || !b.is_ascii())
    {
        return Err("invalidCredential".into());
    }
    Credential::new(format!("WorkosCursorSessionToken={value}"), None)
}

fn grok_credential(bytes: &[u8], now: i64) -> Result<Credential, String> {
    let root: Value = serde_json::from_slice(bytes).map_err(|_| "invalidCredential")?;
    let entries = root.as_object().ok_or("invalidCredential")?;
    let preferred: Vec<_> = entries
        .iter()
        .filter(|(scope, value)| {
            scope.starts_with("https://auth.x.ai::")
                && value
                    .get("key")
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.is_empty())
        })
        .collect();
    // Multiple accounts require an explicit choice in the CLI, never guess.
    let entry = match preferred.as_slice() {
        [(_, value)] => *value,
        [] => entries
            .get("https://accounts.x.ai/sign-in")
            .ok_or("signedOut")?,
        _ => return Err("ambiguousAccount".into()),
    };
    if entry
        .get("principal_type")
        .and_then(Value::as_str)
        .is_some_and(|s| s.eq_ignore_ascii_case("team"))
    {
        return Err("personalOnly".into());
    }
    if let Some(expiry) = entry
        .get("expires_at")
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    {
        if expiry.timestamp() <= now + 60 {
            return Err("signedOut".into());
        }
    }
    let token = entry
        .get("key")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && !s.starts_with("xai-"))
        .ok_or("invalidCredential")?;
    if token.split('.').count() == 3 {
        jwt(token, now)?;
    }
    Credential::new(format!("Bearer {token}"), short_string(entry.get("email")))
}

pub fn default_directory(provider: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    if provider == "grok" {
        return Some(
            std::env::var_os("GROK_HOME")
                .map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .unwrap_or_else(|| home.join(".grok")),
        );
    }
    #[cfg(target_os = "macos")]
    return Some(home.join("Library/Application Support/Cursor/User/globalStorage"));
    #[cfg(not(target_os = "macos"))]
    return dirs::config_dir().map(|p| p.join("Cursor/User/globalStorage"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cursor_blob_and_jwt_are_expiry_checked() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"sub":"auth0|user_1","exp":1000}"#);
        let token = format!("head.{payload}.signature");
        let bytes: Vec<u8> = token.bytes().flat_map(|b| [b, 0]).collect();
        assert_eq!(decode_token(&bytes).unwrap(), token);
        assert!(cursor_token(&token, 900)
            .unwrap()
            .header
            .starts_with("WorkosCursorSessionToken=user_1%3A%3A"));
        assert!(cursor_token(&token, 950).is_err());
        assert!(cursor_cookie("secret; other=value").is_err());
        assert!(cursor_cookie("secret\r\nheader").is_err());
    }
    #[test]
    fn grok_rejects_wrong_scope_team_and_multiple_accounts() {
        for fixture in [
            r#"{"https://evil/sign-in":{"key":"secret"}}"#,
            r#"{"https://auth.x.ai::a":{"key":"secret","principal_type":"team"}}"#,
            r#"{"https://auth.x.ai::a":{"key":"one"},"https://auth.x.ai::b":{"key":"two"}}"#,
        ] {
            assert!(grok_credential(fixture.as_bytes(), 1).is_err());
        }
        let c = grok_credential(
            br#"{"https://auth.x.ai::personal":{"key":"secret","email":"fixture@example.test"}}"#,
            1,
        )
        .unwrap();
        assert_eq!(c.label.as_deref(), Some("fixture@example.test"));
        assert!(!c.fingerprint.contains("secret"));
    }
    #[test]
    fn selected_cursor_database_reads_wal_without_copying_or_mutating_credentials() {
        let temp =
            std::env::temp_dir().join(format!("metacodex-account-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&temp).unwrap();
        let temp = temp.canonicalize().unwrap();
        let path = temp.join("state.vscdb");
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB);").unwrap();
        let token = format!("head.{}.signature",URL_SAFE_NO_PAD.encode(serde_json::to_vec(&serde_json::json!({"sub":"fixture-user","exp":chrono::Utc::now().timestamp()+3600})).unwrap()));
        let blob: Vec<u8> = token.bytes().flat_map(|b| [b, 0]).collect();
        db.execute(
            "INSERT INTO ItemTable VALUES ('cursorAuth/accessToken',?1)",
            [&blob],
        )
        .unwrap();
        let grant = AccountGrant::from_picker(path, "cursor-cli").unwrap();
        let credential = grant.read("cursor-cli").unwrap();
        assert!(credential.header.ends_with(&token));
        assert_eq!(
            db.query_row("SELECT value FROM ItemTable", [], |row| row
                .get::<_, Vec<u8>>(0))
                .unwrap(),
            blob
        );
        assert!(!serde_json::to_string(&grant).unwrap().contains(&token));
        drop(db);
        std::fs::remove_dir_all(temp).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn replacing_an_authorized_file_with_a_symlink_is_rejected() {
        let temp =
            std::env::temp_dir().join(format!("metacodex-account-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&temp).unwrap();
        let temp = temp.canonicalize().unwrap();
        let path = temp.join("auth.json");
        let fixture = br#"{"https://auth.x.ai::personal":{"key":"synthetic"}}"#;
        std::fs::write(&path, fixture).unwrap();
        let grant = AccountGrant::from_picker(path.clone(), "grok").unwrap();
        assert!(grant.read("grok").is_ok());
        std::fs::rename(&path, temp.join("target.json")).unwrap();
        std::os::unix::fs::symlink(temp.join("target.json"), &path).unwrap();
        assert!(grant.read("grok").is_err());
        std::fs::remove_dir_all(temp).unwrap();
    }
}
