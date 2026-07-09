use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccess {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub identity_file: Option<String>,
    #[serde(default)]
    pub root_paths: Vec<String>,
    #[serde(default)]
    pub known_host_sha256: Option<String>,
    pub created_at: String,
    pub last_connected_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub label: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub identity_file: Option<String>,
    #[serde(default)]
    pub root_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessTestResult {
    pub status: String,
    pub fingerprint_sha256: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProjectCandidate {
    pub name: String,
    pub path: String,
    pub markers: Vec<String>,
}

fn default_port() -> u16 {
    22
}
