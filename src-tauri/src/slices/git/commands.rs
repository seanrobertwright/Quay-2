use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::models::{CreateWorktreeRequest, GitWorktree};

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn create_git_command(dir: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

pub fn parse_worktree_porcelain(output: &str) -> Vec<GitWorktree> {
    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_head = String::new();
    let mut current_branch = String::new();
    let mut current_bare = false;
    let mut current_locked = false;

    let flush = |worktrees: &mut Vec<GitWorktree>,
                 path: &mut Option<String>,
                 head: &mut String,
                 branch: &mut String,
                 bare: &mut bool,
                 locked: &mut bool| {
        if let Some(p) = path.take() {
            let normalized_path = p.replace('\\', "/");
            let is_main = worktrees.is_empty();
            let branch_name = if branch.is_empty() {
                "detached".to_string()
            } else {
                branch
                    .strip_prefix("refs/heads/")
                    .unwrap_or(branch)
                    .to_string()
            };

            worktrees.push(GitWorktree {
                path: normalized_path,
                head: std::mem::take(head),
                branch: branch_name,
                is_main,
                is_bare: *bare,
                is_locked: *locked,
            });

            *branch = String::new();
            *bare = false;
            *locked = false;
        }
    };

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            flush(
                &mut worktrees,
                &mut current_path,
                &mut current_head,
                &mut current_branch,
                &mut current_bare,
                &mut current_locked,
            );
            continue;
        }

        if let Some(p) = line.strip_prefix("worktree ") {
            flush(
                &mut worktrees,
                &mut current_path,
                &mut current_head,
                &mut current_branch,
                &mut current_bare,
                &mut current_locked,
            );
            current_path = Some(p.trim().to_string());
        } else if let Some(h) = line.strip_prefix("HEAD ") {
            current_head = h.trim().to_string();
        } else if let Some(b) = line.strip_prefix("branch ") {
            current_branch = b.trim().to_string();
        } else if line == "bare" {
            current_bare = true;
        } else if line == "locked" || line.starts_with("locked ") {
            current_locked = true;
        }
    }

    flush(
        &mut worktrees,
        &mut current_path,
        &mut current_head,
        &mut current_branch,
        &mut current_bare,
        &mut current_locked,
    );

    worktrees
}

#[tauri::command]
pub async fn is_git_repo(project_path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = create_git_command(&project_path);
        cmd.args(["rev-parse", "--is-inside-work-tree"]);
        match cmd.output() {
            Ok(output) => Ok(output.status.success()),
            Err(_) => Ok(false),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn list_git_worktrees(project_path: String) -> Result<Vec<GitWorktree>, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = create_git_command(&project_path);
        cmd.args(["worktree", "list", "--porcelain"]);
        let output = match cmd.output() {
            Ok(o) => o,
            Err(e) => return Err(format!("Failed to execute git worktree: {}", e)),
        };

        if !output.status.success() {
            // Not a git repository or worktree not supported
            return Ok(Vec::new());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(parse_worktree_porcelain(&stdout))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn create_git_worktree(
    request: CreateWorktreeRequest,
) -> Result<GitWorktree, String> {
    tokio::task::spawn_blocking(move || {
        let repo_path = Path::new(&request.repo_path);
        if !repo_path.exists() {
            return Err(format!("Repository path does not exist: {}", request.repo_path));
        }

        let branch_name = request.branch.trim();
        if branch_name.is_empty() {
            return Err("Branch name cannot be empty".to_string());
        }

        // Determine destination folder
        let worktree_dir: PathBuf = if let Some(custom) = request.custom_path {
            PathBuf::from(custom)
        } else {
            // Sanitize branch name for folder name (e.g. feat/issue-86 -> feat-issue-86)
            let folder_name = branch_name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-");
            repo_path.join(".worktrees").join(&folder_name)
        };

        // Create parent directory if needed
        if let Some(parent) = worktree_dir.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut cmd = create_git_command(&request.repo_path);
        let mut args: Vec<String> = vec!["worktree".to_string(), "add".to_string()];

        let target_str = worktree_dir.to_string_lossy().to_string();
        args.push(target_str.clone());

        if request.new_branch {
            args.push("-b".to_string());
            args.push(branch_name.to_string());
            if let Some(base) = request.base_branch {
                if !base.trim().is_empty() {
                    args.push(base.trim().to_string());
                }
            }
        } else {
            args.push(branch_name.to_string());
        }

        cmd.args(&args);
        let output = cmd
            .output()
            .map_err(|e| format!("Failed to run git worktree add: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Git worktree add failed: {}", stderr.trim()));
        }

        // Fetch new list of worktrees to find the created one
        let mut list_cmd = create_git_command(&request.repo_path);
        list_cmd.args(["worktree", "list", "--porcelain"]);
        let list_output = list_cmd
            .output()
            .map_err(|e| format!("Failed to verify new worktree: {}", e))?;

        let list_stdout = String::from_utf8_lossy(&list_output.stdout);
        let parsed = parse_worktree_porcelain(&list_stdout);

        let normalized_target = target_str.replace('\\', "/").to_lowercase();
        if let Some(created) = parsed
            .into_iter()
            .find(|w| w.path.to_lowercase() == normalized_target || w.branch == branch_name)
        {
            Ok(created)
        } else {
            Ok(GitWorktree {
                path: target_str.replace('\\', "/"),
                head: String::new(),
                branch: branch_name.to_string(),
                is_main: false,
                is_bare: false,
                is_locked: false,
            })
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn remove_git_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = create_git_command(&repo_path);
        let mut args = vec!["worktree", "remove", &worktree_path];
        if force {
            args.push("--force");
        }
        cmd.args(args);

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to remove git worktree: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Git worktree remove failed: {}", stderr.trim()));
        }

        // Run prune to clean up worktree state
        let mut prune_cmd = create_git_command(&repo_path);
        prune_cmd.args(["worktree", "prune"]);
        let _ = prune_cmd.output();

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_worktree_porcelain() {
        let raw = r#"worktree E:/Projects/quay
HEAD b6c6204629d5722fc298a47ead7e620ad0f0ba3f
branch refs/heads/main

worktree C:/Users/seanr/.archon/workspaces/seanrobertwright/quay/worktrees/feat/issue-86
HEAD cf6637c14bfa3b64201206c59a518117e5522666
branch refs/heads/feat/issue-86

worktree C:/Users/seanr/AppData/Local/Temp/scratchpad/wt-48
HEAD 0f47b3fd5ac346b31c18bdf5f05b46dd3d3334aa
detached
"#;

        let worktrees = parse_worktree_porcelain(raw);
        assert_eq!(worktrees.len(), 3);

        assert_eq!(worktrees[0].branch, "main");
        assert!(worktrees[0].is_main);
        assert_eq!(worktrees[0].head, "b6c6204629d5722fc298a47ead7e620ad0f0ba3f");

        assert_eq!(worktrees[1].branch, "feat/issue-86");
        assert!(!worktrees[1].is_main);
        assert_eq!(worktrees[1].head, "cf6637c14bfa3b64201206c59a518117e5522666");

        assert_eq!(worktrees[2].branch, "detached");
        assert!(!worktrees[2].is_main);
    }
}
