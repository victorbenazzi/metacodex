use std::path::Path;

use grep_matcher::Matcher;
use grep_regex::RegexMatcher;
use grep_searcher::{Searcher, SearcherBuilder, SinkMatch};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub regex: bool,
    /// Maximum total matches before truncation kicks in.
    #[serde(default = "default_max")]
    pub max_matches: usize,
}

fn default_max() -> usize {
    500
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub line: u64,
    /// 0-based byte offsets in `line_text` where the match starts/ends.
    pub start: u32,
    pub end: u32,
    pub line_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileResult {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub files: Vec<SearchFileResult>,
    pub total_matches: u64,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

/// List files under `root` as absolute paths, respecting .gitignore and hidden
/// rules, capped at `max`. Powers the command palette's go-to-file. Read-only.
pub fn list_files(root: &str, max: usize) -> AppResult<Vec<String>> {
    let limit = max.max(1);
    let mut out: Vec<String> = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .require_git(false)
        .ignore(true)
        .build();
    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        match entry.file_type() {
            Some(ft) if ft.is_file() => {}
            _ => continue,
        }
        out.push(entry.path().to_string_lossy().into_owned());
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

pub fn search(root: &str, query: &str, options: SearchOptions) -> AppResult<SearchResults> {
    let started = std::time::Instant::now();
    if query.is_empty() {
        return Ok(SearchResults {
            files: Vec::new(),
            total_matches: 0,
            truncated: false,
            elapsed_ms: 0,
        });
    }

    let pattern = if options.regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if options.whole_word {
        format!(r"\b{}\b", pattern)
    } else {
        pattern
    };
    let pattern = if !options.case_sensitive {
        format!("(?i){}", pattern)
    } else {
        pattern
    };

    let matcher = RegexMatcher::new(&pattern)
        .map_err(|e| AppError::Other(format!("invalid regex: {e}")))?;

    let mut searcher: Searcher = SearcherBuilder::new()
        .line_number(true)
        .multi_line(false)
        .build();

    let mut files: Vec<SearchFileResult> = Vec::new();
    let mut total: u64 = 0;
    let mut truncated = false;
    let limit = options.max_matches.max(1);

    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .require_git(false)
        .ignore(true)
        .max_filesize(Some(2 * 1024 * 1024)) // skip files > 2 MiB
        .build();

    for entry in walker {
        if truncated {
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let mut matches: Vec<SearchMatch> = Vec::new();
        let res = searcher.search_path(
            &matcher,
            path,
            CollectSink {
                matcher: &matcher,
                matches: &mut matches,
                cap_remaining: limit.saturating_sub(total as usize),
            },
        );
        if res.is_err() {
            continue; // unreadable file; ignore
        }

        if !matches.is_empty() {
            total += matches.len() as u64;
            files.push(SearchFileResult {
                path: path.to_string_lossy().into_owned(),
                matches,
            });
            if total as usize >= limit {
                truncated = true;
            }
        }
    }

    Ok(SearchResults {
        files,
        total_matches: total,
        truncated,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

struct CollectSink<'a> {
    matcher: &'a RegexMatcher,
    matches: &'a mut Vec<SearchMatch>,
    cap_remaining: usize,
}

impl<'a> grep_searcher::Sink for CollectSink<'a> {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &Searcher,
        mat: &SinkMatch<'_>,
    ) -> Result<bool, Self::Error> {
        if self.cap_remaining == 0 {
            return Ok(false);
        }
        let line = mat.line_number().unwrap_or(0);
        let bytes = mat.bytes();
        let line_text = String::from_utf8_lossy(bytes).trim_end().to_string();

        // Use the matcher to find the first match offset within the line bytes
        let mut start = 0u32;
        let mut end = 0u32;
        let _ = self.matcher.find(bytes).map(|opt| {
            if let Some(m) = opt {
                start = m.start() as u32;
                end = m.end() as u32;
            }
        });

        self.matches.push(SearchMatch {
            line,
            start,
            end,
            line_text,
        });
        self.cap_remaining -= 1;
        Ok(self.cap_remaining > 0)
    }
}

/// Workspace-relative path helper for display.
pub fn relative_to<'a>(path: &'a str, root: &'a str) -> &'a str {
    // Trim both separators so Windows paths (`C:\proj\`) and Unix paths
    // (`/home/user/proj/`) normalize the same way before the prefix check.
    let root = root.trim_end_matches(['/', '\\']);
    if let Some(rest) = path.strip_prefix(root) {
        rest.trim_start_matches(['/', '\\'])
    } else {
        path
    }
}

// We need the `regex` crate for escaping; pull it transitively via grep-regex
// but expose it directly.
mod regex {
    pub fn escape(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        for c in s.chars() {
            if "\\.+*?()|[]{}^$".contains(c) {
                out.push('\\');
            }
            out.push(c);
        }
        out
    }
}

// Allow path::Path import not flagged unused on platforms where it's not needed
#[allow(dead_code)]
fn _path_marker(p: &Path) -> &Path {
    p
}
