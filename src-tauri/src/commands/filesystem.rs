use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::error::{AppError, AppResult};
use crate::events::{FsRenamedPayload, EV_FS_RENAMED};
use crate::fs_ops::{self, BytesFile, DirEntry, FileMeta, TextFile};
use crate::preview_grants::{PreviewGrant, PreviewGrants};
use crate::projects::{Project, ProjectOrigin, ProjectsCache};
use crate::remote_access;

/// Look up the owning project id for `path` and emit `fs://renamed` so the
/// frontend can update open editor tabs without losing their unsaved buffer.
/// Best-effort: missing project / emit failure is logged, never propagated.
fn emit_renamed(app: &AppHandle, old_path: &str, new_path: &str) {
    let cache = app.state::<Arc<ProjectsCache>>();
    if let Some((project_id, _root)) = cache.find_owner(new_path) {
        let _ = app.emit(
            EV_FS_RENAMED,
            FsRenamedPayload {
                project_id,
                old_path: old_path.to_string(),
                new_path: new_path.to_string(),
            },
        );
    }
}

async fn blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("join: {e}")))?
}

fn file_path_to_string(path: FilePath) -> AppResult<String> {
    let path = path
        .into_path()
        .map_err(|e| AppError::Other(format!("dialog path: {e}")))?;
    Ok(path.to_string_lossy().to_string())
}

async fn pick_file_path(
    app: AppHandle,
    title: String,
    filter_name: &'static str,
    extensions: Vec<&'static str>,
    default_path: Option<String>,
) -> AppResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter(filter_name, &extensions);
    if let Some(default_path) = default_path.filter(|p| !p.is_empty()) {
        dialog = dialog.set_directory(default_path);
    }
    dialog.pick_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = rx
        .await
        .map_err(|e| AppError::Other(format!("dialog cancelled: {e}")))?;
    picked.map(file_path_to_string).transpose()
}

fn resolve_preview_path(app: &AppHandle, grant_id: &str) -> AppResult<String> {
    app.state::<Arc<PreviewGrants>>().resolve(grant_id)
}

fn project_by_id(app: &AppHandle, project_id: &str) -> AppResult<Project> {
    app.state::<Arc<ProjectsCache>>()
        .snapshot()
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::NotFound(format!("project {project_id}")))
}

enum WorkspaceFs {
    Local,
    Ssh {
        access_id: String,
        remote_path: String,
    },
}

impl WorkspaceFs {
    fn load(app: &AppHandle, project_id: &str) -> AppResult<Self> {
        Ok(match project_by_id(app, project_id)?.origin {
            ProjectOrigin::Local => Self::Local,
            ProjectOrigin::Ssh {
                access_id,
                remote_path,
            } => Self::Ssh {
                access_id,
                remote_path,
            },
        })
    }

    fn read_dir(&self, app: &AppHandle, path: &str) -> AppResult<Vec<DirEntry>> {
        match self {
            Self::Local => fs_ops::read_dir(app, path),
            Self::Ssh {
                access_id,
                remote_path,
            } => remote_access::read_dir(access_id, remote_path, path),
        }
    }

    fn stat(&self, app: &AppHandle, path: &str) -> AppResult<FileMeta> {
        match self {
            Self::Local => fs_ops::stat(app, path),
            Self::Ssh {
                access_id,
                remote_path,
            } => remote_access::stat(access_id, remote_path, path),
        }
    }

    fn read_file_text(
        &self,
        app: &AppHandle,
        path: &str,
        max_bytes: Option<u64>,
    ) -> AppResult<TextFile> {
        match self {
            Self::Local => fs_ops::read_file_text(app, path, max_bytes),
            Self::Ssh {
                access_id,
                remote_path,
            } => remote_access::read_file_text(access_id, remote_path, path, max_bytes),
        }
    }

    fn read_file_bytes(
        &self,
        app: &AppHandle,
        path: &str,
        max_bytes: Option<u64>,
    ) -> AppResult<BytesFile> {
        match self {
            Self::Local => fs_ops::read_file_bytes(app, path, max_bytes),
            Self::Ssh {
                access_id,
                remote_path,
            } => remote_access::read_file_bytes(access_id, remote_path, path, max_bytes),
        }
    }

    fn write_file_text(&self, app: &AppHandle, path: &str, content: &str) -> AppResult<()> {
        match self {
            Self::Local => fs_ops::write_file_text(app, path, content),
            Self::Ssh {
                access_id,
                remote_path,
            } => remote_access::write_file_text(access_id, remote_path, path, content),
        }
    }

    fn create_file(&self, app: &AppHandle, parent: &str, name: &str) -> AppResult<String> {
        match self {
            Self::Local => fs_ops::create_file(app, parent, name),
            Self::Ssh {
                access_id,
                remote_path,
            } => remote_access::create_file(access_id, remote_path, parent, name),
        }
    }

    fn create_dir(&self, app: &AppHandle, parent: &str, name: &str) -> AppResult<String> {
        match self {
            Self::Local => fs_ops::create_dir(app, parent, name),
            Self::Ssh {
                access_id,
                remote_path,
            } => remote_access::create_dir(access_id, remote_path, parent, name),
        }
    }
}

#[tauri::command]
pub async fn pick_preview_file(
    title: String,
    app: AppHandle,
) -> AppResult<Option<PreviewGrant>> {
    let path = pick_file_path(
        app.clone(),
        title,
        "Preview files",
        fs_ops::preview_extensions(),
        None,
    )
    .await?;
    let Some(path) = path else {
        return Ok(None);
    };
    if !fs_ops::preview_ext_allowed_any(&path) {
        return Err(AppError::Other(format!(
            "unsupported preview type: {path:?}"
        )));
    }
    Ok(Some(app.state::<Arc<PreviewGrants>>().grant_path(path)))
}

#[tauri::command]
pub async fn pick_project_icon(
    title: String,
    default_path: String,
    app: AppHandle,
) -> AppResult<Option<BytesFile>> {
    let path = pick_file_path(
        app,
        title,
        "Images",
        fs_ops::ICON_EXTS.to_vec(),
        Some(default_path),
    )
    .await?;
    let Some(path) = path else {
        return Ok(None);
    };
    blocking(move || fs_ops::read_project_icon_image(&path))
        .await
        .map(Some)
}

#[tauri::command]
pub async fn read_dir(path: String, app: AppHandle) -> AppResult<Vec<DirEntry>> {
    // read_dir does a blocking std::fs walk plus a per-entry symlink_metadata.
    // Run it on the blocking pool so a directory read can't stall a Tauri async
    // IPC worker (which also pumps PTY data and other commands) while an agent
    // is bursting files into the project.
    blocking(move || fs_ops::read_dir(&app, &path)).await
}

#[tauri::command]
pub async fn stat(path: String, app: AppHandle) -> AppResult<FileMeta> {
    blocking(move || fs_ops::stat(&app, &path)).await
}

#[tauri::command]
pub async fn read_file_text(
    path: String,
    max_bytes: Option<u64>,
    app: AppHandle,
) -> AppResult<TextFile> {
    blocking(move || fs_ops::read_file_text(&app, &path, max_bytes)).await
}

#[tauri::command]
pub async fn read_file_bytes(
    path: String,
    max_bytes: Option<u64>,
    app: AppHandle,
) -> AppResult<BytesFile> {
    blocking(move || fs_ops::read_file_bytes(&app, &path, max_bytes)).await
}

/// Preview reads and writes are allowed only through backend-issued grants.
#[tauri::command]
pub async fn read_preview_text(
    grant_id: String,
    max_bytes: Option<u64>,
    app: AppHandle,
) -> AppResult<TextFile> {
    let path = resolve_preview_path(&app, &grant_id)?;
    blocking(move || fs_ops::read_preview_text(&path, max_bytes)).await
}

#[tauri::command]
pub async fn read_preview_bytes(
    grant_id: String,
    max_bytes: Option<u64>,
    app: AppHandle,
) -> AppResult<BytesFile> {
    let path = resolve_preview_path(&app, &grant_id)?;
    blocking(move || fs_ops::read_preview_bytes(&path, max_bytes)).await
}

#[tauri::command]
pub async fn write_preview_text(
    grant_id: String,
    content: String,
    app: AppHandle,
) -> AppResult<()> {
    let path = resolve_preview_path(&app, &grant_id)?;
    blocking(move || fs_ops::write_preview_text(&path, &content)).await
}

/// Move a previewed file into a chosen project folder ("send to project"). `from`
/// is the previewed file (unowned), `to_dir` must be within a registered root.
#[tauri::command]
pub async fn move_into_project(
    grant_id: String,
    to_dir: String,
    app: AppHandle,
) -> AppResult<String> {
    let from = resolve_preview_path(&app, &grant_id)?;
    let app_for_move = app.clone();
    let from_for_move = from.clone();
    let new_path =
        blocking(move || fs_ops::move_into_project(&app_for_move, &from_for_move, &to_dir)).await?;
    app.state::<Arc<PreviewGrants>>().revoke(&grant_id);
    emit_renamed(&app, &from, &new_path);
    Ok(new_path)
}

#[tauri::command]
pub async fn write_file_text(path: String, content: String, app: AppHandle) -> AppResult<()> {
    blocking(move || fs_ops::write_file_text(&app, &path, &content)).await
}

#[tauri::command]
pub async fn create_file(parent: String, name: String, app: AppHandle) -> AppResult<String> {
    blocking(move || fs_ops::create_file(&app, &parent, &name)).await
}

#[tauri::command]
pub async fn create_dir(parent: String, name: String, app: AppHandle) -> AppResult<String> {
    blocking(move || fs_ops::create_dir(&app, &parent, &name)).await
}

#[tauri::command]
pub async fn workspace_read_dir(
    project_id: String,
    path: String,
    app: AppHandle,
) -> AppResult<Vec<DirEntry>> {
    blocking(move || {
        let workspace = WorkspaceFs::load(&app, &project_id)?;
        workspace.read_dir(&app, &path)
    })
    .await
}

#[tauri::command]
pub async fn workspace_stat(
    project_id: String,
    path: String,
    app: AppHandle,
) -> AppResult<FileMeta> {
    blocking(move || {
        let workspace = WorkspaceFs::load(&app, &project_id)?;
        workspace.stat(&app, &path)
    })
    .await
}

#[tauri::command]
pub async fn workspace_read_file_text(
    project_id: String,
    path: String,
    max_bytes: Option<u64>,
    app: AppHandle,
) -> AppResult<TextFile> {
    blocking(move || {
        let workspace = WorkspaceFs::load(&app, &project_id)?;
        workspace.read_file_text(&app, &path, max_bytes)
    })
    .await
}

#[tauri::command]
pub async fn workspace_read_file_bytes(
    project_id: String,
    path: String,
    max_bytes: Option<u64>,
    app: AppHandle,
) -> AppResult<BytesFile> {
    blocking(move || {
        let workspace = WorkspaceFs::load(&app, &project_id)?;
        workspace.read_file_bytes(&app, &path, max_bytes)
    })
    .await
}

#[tauri::command]
pub async fn workspace_write_file_text(
    project_id: String,
    path: String,
    content: String,
    app: AppHandle,
) -> AppResult<()> {
    blocking(move || {
        let workspace = WorkspaceFs::load(&app, &project_id)?;
        workspace.write_file_text(&app, &path, &content)
    })
    .await
}

#[tauri::command]
pub async fn workspace_create_file(
    project_id: String,
    parent: String,
    name: String,
    app: AppHandle,
) -> AppResult<String> {
    blocking(move || {
        let workspace = WorkspaceFs::load(&app, &project_id)?;
        workspace.create_file(&app, &parent, &name)
    })
    .await
}

#[tauri::command]
pub async fn workspace_create_dir(
    project_id: String,
    parent: String,
    name: String,
    app: AppHandle,
) -> AppResult<String> {
    blocking(move || {
        let workspace = WorkspaceFs::load(&app, &project_id)?;
        workspace.create_dir(&app, &parent, &name)
    })
    .await
}
