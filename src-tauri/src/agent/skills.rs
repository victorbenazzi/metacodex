use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// A discovered Agent Skill (Anthropic Agent Skills standard: a directory with a
/// `SKILL.md` carrying `name` + `description` frontmatter). Read-only inventory
/// of the skills the opencode runtime can load.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub source: String,
    pub path: String,
}

/// Standard on-disk skill locations, in priority order. The first occurrence of
/// a given slug wins (so a metacodex-local override shadows a global one).
fn skill_roots() -> Vec<(&'static str, PathBuf)> {
    let home = dirs::home_dir().unwrap_or_default();
    vec![
        ("metacodex", home.join(".metacodex/skills")),
        ("opencode", home.join(".config/opencode/skills")),
        ("claude", home.join(".claude/skills")),
        ("agents", home.join(".agents/skills")),
    ]
}

pub fn list_skills() -> Vec<SkillInfo> {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for (source, root) in skill_roots() {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            let skill_md = dir.join("SKILL.md");
            if !skill_md.exists() {
                continue;
            }
            let slug = entry.file_name().to_string_lossy().to_string();
            if !seen.insert(slug.clone()) {
                continue;
            }
            let (name, description) =
                parse_frontmatter(&skill_md).unwrap_or_else(|| (slug.clone(), String::new()));
            out.push(SkillInfo {
                name: if name.is_empty() { slug } else { name },
                description,
                source: source.to_string(),
                path: dir.to_string_lossy().to_string(),
            });
        }
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// Pull `name` + `description` from the leading `--- ... ---` YAML frontmatter
/// without a full YAML parser (the two fields are simple scalars).
fn parse_frontmatter(path: &Path) -> Option<(String, String)> {
    let content = fs::read_to_string(path).ok()?;
    let mut name = String::new();
    let mut description = String::new();
    let mut in_fm = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            if in_fm {
                break;
            }
            in_fm = true;
            continue;
        }
        if !in_fm {
            // No frontmatter fence at the top; give up.
            if !trimmed.is_empty() {
                break;
            }
            continue;
        }
        if let Some(v) = trimmed.strip_prefix("name:") {
            name = unquote(v);
        } else if let Some(v) = trimmed.strip_prefix("description:") {
            description = unquote(v);
        }
    }

    Some((name, description))
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').trim_matches('\'').trim().to_string()
}
