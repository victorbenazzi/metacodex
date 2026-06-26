use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGrant {
    pub path: String,
    pub grant_id: String,
}

#[derive(Default)]
pub struct PreviewGrants {
    by_id: Mutex<HashMap<String, String>>,
}

impl PreviewGrants {
    pub fn grant_path(&self, path: String) -> PreviewGrant {
        let grant_id = Uuid::new_v4().to_string();
        self.by_id.lock().insert(grant_id.clone(), path.clone());
        PreviewGrant { path, grant_id }
    }

    pub fn resolve(&self, grant_id: &str) -> AppResult<String> {
        self.by_id
            .lock()
            .get(grant_id)
            .cloned()
            .ok_or_else(|| AppError::PathNotAllowed("unknown preview grant".into()))
    }

    pub fn revoke(&self, grant_id: &str) {
        self.by_id.lock().remove(grant_id);
    }
}
