use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryGrant {
    pub path: String,
    pub grant_id: String,
}

#[derive(Default)]
pub struct DirectoryGrants {
    by_id: Mutex<HashMap<String, String>>,
}

impl DirectoryGrants {
    pub fn grant_path(&self, path: String) -> DirectoryGrant {
        let grant_id = Uuid::new_v4().to_string();
        self.by_id.lock().insert(grant_id.clone(), path.clone());
        DirectoryGrant { path, grant_id }
    }

    pub fn resolve(&self, grant_id: &str) -> AppResult<String> {
        self.by_id
            .lock()
            .get(grant_id)
            .cloned()
            .ok_or_else(|| AppError::PathNotAllowed("unknown directory grant".into()))
    }
}
