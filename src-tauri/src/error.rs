use serde::{Serialize, Serializer};

#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("permission denied: {0}")]
    PermissionDenied(String),

    #[error("path not allowed: {0}")]
    PathNotAllowed(String),

    #[error("file too large: {0}")]
    FileTooLarge(String),

    #[error("pty error: {0}")]
    Pty(String),

    #[error("store error: {0}")]
    Store(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("other: {0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let (code, message) = match self {
            AppError::NotFound(m) => ("NotFound", m.clone()),
            AppError::PermissionDenied(m) => ("PermissionDenied", m.clone()),
            AppError::PathNotAllowed(m) => ("PathNotAllowed", m.clone()),
            AppError::FileTooLarge(m) => ("FileTooLarge", m.clone()),
            AppError::Pty(m) => ("Pty", m.clone()),
            AppError::Store(m) => ("Store", m.clone()),
            AppError::Io(e) => ("Io", e.to_string()),
            AppError::Other(m) => ("Other", m.clone()),
        };
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", code)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
