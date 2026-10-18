//! Agent spend per work order. Claude Code is the only agent whose transcripts Quay
//! can price; every other agent is reported as unmeasured rather than guessed.

use std::fs;

use super::models::SpendSnapshot;
use crate::slices::sessions::commands::get_claude_dir;
use crate::slices::sessions::usage::transcript_dir_spend;

/// The directory name Claude Code gives a working directory under `projects/`:
/// every character other than an ASCII letter or digit becomes `-`.
pub fn claude_project_dir_name(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn unmeasured(note: String) -> SpendSnapshot {
    SpendSnapshot {
        measured: false,
        usd: 0.0,
        responses: 0,
        note,
    }
}

/// Spend of the Claude Code sessions started in `worktree`.
pub fn measure(author_agent: &str, worktree: &str) -> SpendSnapshot {
    if author_agent != "claude" {
        return unmeasured(format!(
            "Spend is not measured for {}: only Claude Code transcripts can be priced.",
            author_agent
        ));
    }
    let projects = match get_claude_dir() {
        Ok(dir) => dir.join("projects"),
        Err(e) => return unmeasured(e),
    };
    let want = claude_project_dir_name(worktree).to_lowercase();
    let found = fs::read_dir(&projects).ok().and_then(|entries| {
        entries
            .flatten()
            .find(|e| e.file_name().to_string_lossy().to_lowercase() == want)
            .map(|e| e.path())
    });
    match found {
        None => SpendSnapshot {
            measured: true,
            usd: 0.0,
            responses: 0,
            note: "No Claude Code transcripts for this worktree yet.".to_string(),
        },
        Some(dir) => {
            let s = transcript_dir_spend(&dir);
            SpendSnapshot {
                measured: true,
                usd: s.usd,
                responses: s.responses,
                note: format!(
                    "Priced from {} Claude Code transcript file(s) for this worktree.",
                    s.files
                ),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_like_claude_code() {
        assert_eq!(claude_project_dir_name(r"E:\Projects\Quay2"), "E--Projects-Quay2");
        assert_eq!(
            claude_project_dir_name(r"E:\Projects\Quay2\.machina\worktrees\WO-1"),
            "E--Projects-Quay2--machina-worktrees-WO-1"
        );
    }

    #[test]
    fn other_agents_are_unmeasured() {
        let s = measure("codex", r"E:\x");
        assert!(!s.measured);
        assert_eq!(s.usd, 0.0);
    }
}
