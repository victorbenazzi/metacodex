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
/// a given slug wins (so a metacodex-local override shadows a global one). The
/// metacodex entry goes through `config_root()` so a `METACODEX_HOME` dev run
/// lists its own skills, not the installed app's.
fn skill_roots() -> Vec<(&'static str, PathBuf)> {
    let home = dirs::home_dir().unwrap_or_default();
    let metacodex_skills = crate::config_paths::config_root()
        .map(|r| r.join("skills"))
        .unwrap_or_else(|_| home.join(".metacodex/skills"));
    vec![
        ("metacodex", metacodex_skills),
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

/// Skip absurdly large SKILL.md files instead of slurping them (the inventory
/// only needs two frontmatter scalars).
const MAX_SKILL_MD_BYTES: u64 = 512 * 1024;

/// Pull `name` + `description` from the leading `--- ... ---` YAML frontmatter
/// without a full YAML parser. Handles the two common shapes for the fields:
/// inline scalars and block scalars (`description: >` / `|` followed by
/// indented lines). Keys are only recognized at column 0, so an indented
/// nested key (e.g. `author: { name: ... }` spread over lines) can't clobber
/// the skill name.
fn parse_frontmatter(path: &Path) -> Option<(String, String)> {
    if fs::metadata(path).ok()?.len() > MAX_SKILL_MD_BYTES {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    let mut name = String::new();
    let mut description = String::new();
    let mut in_fm = false;
    let mut lines = content.lines().peekable();

    while let Some(line) = lines.next() {
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
        // Column-0 keys only (untrimmed line).
        let target: Option<&mut String> = if line.starts_with("name:") {
            Some(&mut name)
        } else if line.starts_with("description:") {
            Some(&mut description)
        } else {
            None
        };
        let Some(target) = target else { continue };
        let value = line.split_once(':').map(|(_, v)| v.trim()).unwrap_or("");
        if value == ">" || value == "|" || value == ">-" || value == "|-" {
            // Block scalar: join the following more-indented lines.
            let mut parts: Vec<String> = Vec::new();
            while let Some(next) = lines.peek() {
                if next.trim() == "---" || (!next.starts_with(' ') && !next.starts_with('\t')) {
                    break;
                }
                let chunk = lines.next().unwrap_or_default().trim().to_string();
                if !chunk.is_empty() {
                    parts.push(chunk);
                }
            }
            *target = parts.join(" ");
        } else {
            *target = unquote(value);
        }
    }

    Some((name, description))
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').trim_matches('\'').trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn parse_str(name: &str, content: &str) -> (String, String) {
        let dir = std::env::temp_dir().join(format!("mcx-skill-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        // Unique file per test: tests run in parallel.
        let path = dir.join(format!("{name}.SKILL.md"));
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        let out = parse_frontmatter(&path).unwrap();
        let _ = fs::remove_file(&path);
        out
    }

    #[test]
    fn parses_inline_and_block_scalars() {
        let (name, desc) = parse_str(
            "block",
            "---\nname: my-skill\ndescription: >\n  Line one\n  line two.\n---\nBody\n",
        );
        assert_eq!(name, "my-skill");
        assert_eq!(desc, "Line one line two.");
    }

    #[test]
    fn indented_nested_keys_do_not_clobber() {
        let (name, _) = parse_str(
            "nested",
            "---\nname: real-name\nauthor:\n  name: Someone Else\n---\n",
        );
        assert_eq!(name, "real-name");
    }
}
