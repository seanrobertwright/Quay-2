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

/// Runs the uncommitted-changes check `git worktree remove` makes, without `--force`,
/// before it deletes anything: `git status --porcelain --ignore-submodules=none`.
/// Returns git's refusal followed by up to `MAX_STATUS_LINES` status lines when there are modified or
/// untracked files, `None` when the worktree is clean, and `Err` when git status fails.
pub fn uncommitted_changes(worktree_path: &str) -> Result<Option<String>, String> {
    let mut cmd = create_git_command(worktree_path);
    cmd.args(["status", "--porcelain", "--ignore-submodules=none"]);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git status failed in '{}': {}", worktree_path, stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        return Ok(None);
    }

    let mut status = lines
        .iter()
        .take(MAX_STATUS_LINES)
        .copied()
        .collect::<Vec<_>>()
        .join("\n");
    if lines.len() > MAX_STATUS_LINES {
        status.push_str(&format!("\n...and {} more", lines.len() - MAX_STATUS_LINES));
    }

    Ok(Some(format!(
        "fatal: '{}' contains modified or untracked files, use --force to delete it\n\n{}",
        worktree_path, status
    )))
}

/// Status lines quoted in the refusal; the rest are counted, not listed.
const MAX_STATUS_LINES: usize = 20;

#[tauri::command]
pub async fn check_git_worktree_clean(worktree_path: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || uncommitted_changes(&worktree_path))
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

    fn sh_git(dir: &Path, args: &[&str]) {
        let output = create_git_command(&dir.to_string_lossy())
            .args(args)
            .output()
            .expect("git runs");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    /// A throwaway repository on `main` with one commit and a linked worktree on
    /// branch `feat` at `<root>/wt`. Returns (root, repo, worktree).
    fn repo_with_worktree() -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("quay-wt-{}", uuid::Uuid::new_v4().simple()));
        let repo = root.join("repo");
        let worktree = root.join("wt");
        std::fs::create_dir_all(&repo).unwrap();
        sh_git(&repo, &["init", "-q", "-b", "main"]);
        for (k, v) in [
            ("user.name", "Quay Test"),
            ("user.email", "quay@example.invalid"),
            ("core.hooksPath", ".git/no-hooks"),
            ("core.autocrlf", "false"),
        ] {
            sh_git(&repo, &["config", k, v]);
        }
        std::fs::write(repo.join("README.md"), "readme\n").unwrap();
        sh_git(&repo, &["add", "-A"]);
        sh_git(&repo, &["commit", "-q", "-m", "init"]);
        sh_git(&repo, &["worktree", "add", "-q", "-b", "feat", &worktree.to_string_lossy()]);
        (root, repo, worktree)
    }

    #[test]
    fn a_worktree_with_a_modified_file_reports_gits_refusal() {
        let (root, _repo, worktree) = repo_with_worktree();
        std::fs::write(worktree.join("README.md"), "changed\n").unwrap();

        let refusal = uncommitted_changes(&worktree.to_string_lossy()).unwrap();

        let message = refusal.expect("a dirty worktree is refused");
        assert!(message.contains("contains modified or untracked files, use --force to delete it"), "{}", message);
        assert!(message.contains("M README.md"), "{}", message);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_clean_worktree_has_nothing_to_report() {
        let (root, _repo, worktree) = repo_with_worktree();

        assert_eq!(uncommitted_changes(&worktree.to_string_lossy()), Ok(None));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_worktree_with_an_untracked_file_reports_gits_refusal() {
        let (root, _repo, worktree) = repo_with_worktree();
        std::fs::write(worktree.join("notes.txt"), "draft\n").unwrap();

        let message = uncommitted_changes(&worktree.to_string_lossy())
            .unwrap()
            .expect("an untracked file is refused");
        assert!(message.contains("?? notes.txt"), "{}", message);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_long_status_lists_the_first_twenty_files_and_counts_the_rest() {
        let (root, _repo, worktree) = repo_with_worktree();
        for i in 0..25 {
            std::fs::write(worktree.join(format!("draft-{:02}.txt", i)), "draft\n").unwrap();
        }

        let message = uncommitted_changes(&worktree.to_string_lossy())
            .unwrap()
            .expect("untracked files are refused");
        assert!(message.contains("?? draft-19.txt"), "{}", message);
        assert!(!message.contains("draft-20.txt"), "{}", message);
        assert!(message.ends_with("...and 5 more"), "{}", message);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn remove_refuses_a_dirty_worktree_and_the_forced_remove_deletes_it() {
        let (root, repo, worktree) = repo_with_worktree();
        std::fs::write(worktree.join("notes.txt"), "draft\n").unwrap();
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_path = worktree.to_string_lossy().to_string();

        let refused = remove_git_worktree(repo_path.clone(), worktree_path.clone(), false).await;
        let error = refused.expect_err("git refuses without --force");
        assert!(error.contains("contains modified or untracked files"), "{}", error);
        assert!(worktree.join("notes.txt").exists());

        remove_git_worktree(repo_path, worktree_path, true).await.unwrap();
        assert!(!worktree.exists());
        let _ = std::fs::remove_dir_all(root);
    }

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
