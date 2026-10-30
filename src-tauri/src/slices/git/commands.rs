use std::path::{Path, PathBuf};
use std::process::Command;

use super::models::{CreateWorktreeRequest, GitWorktree};

fn create_git_command(dir: &str) -> Command {
    let mut cmd = crate::spawn::hidden_command("git");
    cmd.current_dir(dir);
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
        let repo_path = Path::new(&project_path);
        if !repo_path.exists() || !repo_path.join(".git").exists() {
            return Ok(Vec::new());
        }
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

        let normalized_target = comparable_path(&target_str);
        if let Some(created) = parsed
            .into_iter()
            .find(|w| comparable_path(&w.path) == normalized_target || w.branch == branch_name)
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
/// Returns the refusal `git worktree remove` would print, in git's wording, followed by up to
/// `MAX_STATUS_LINES` status lines when there are modified or untracked files, `None` when the
/// worktree is clean, and `Err` when git status fails.
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

/// Whether git lists `worktree_path` among `repo_path`'s worktrees, comparing paths as
/// `comparable_path` does.
fn is_registered_worktree(repo_path: &str, worktree_path: &str) -> Result<bool, String> {
    let output = create_git_command(repo_path)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| format!("Failed to list git worktrees: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git worktree list failed: {}", stderr.trim()));
    }
    let wanted = comparable_path(worktree_path);
    Ok(parse_worktree_porcelain(&String::from_utf8_lossy(&output.stdout))
        .iter()
        .any(|w| comparable_path(&w.path) == wanted))
}

/// A path in a form two spellings of the same folder share: resolved through links,
/// short names and `..` when it exists, with forward slashes and no trailing slash, and
/// in lower case where the file system ignores case (Windows and macOS).
pub(crate) fn comparable_path(path: &str) -> String {
    let resolved = std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string());
    let resolved = match resolved.strip_prefix(r"\\?\UNC\") {
        Some(share) => format!(r"\\{}", share),
        None => resolved.strip_prefix(r"\\?\").unwrap_or(&resolved).to_string(),
    };
    let slashed = resolved.replace('\\', "/");
    let trimmed = slashed.trim_end_matches('/');
    if cfg!(any(windows, target_os = "macos")) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
pub async fn remove_git_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || remove_worktree_blocking(&repo_path, &worktree_path, force))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// Waits between tries while a just-closed terminal's processes still hold its worktree
/// folder, as they do on Windows for a moment after they are killed: about 6 s in all.
const LOCK_RETRY_DELAYS_MS: [u64; 6] = [100, 250, 500, 1000, 2000, 2000];

/// Removes a worktree, then whatever git left of its folder.
///
/// `git worktree remove` runs once. If git still lists the worktree afterwards, its error
/// is returned: uncommitted changes without `force`, for one. If git has unregistered it
/// but could not delete the folder, because a closing process still holds it, the rest
/// of the folder is deleted, retrying for about 6 s. A folder git didn't list as a
/// worktree of `repo_path` to begin with is only deleted when it is empty, which is what
/// an interrupted remove leaves behind.
fn remove_worktree_blocking(repo_path: &str, worktree_path: &str, force: bool) -> Result<(), String> {
    if !Path::new(worktree_path).is_absolute() {
        return Err(format!("Worktree path must be absolute, got '{}'", worktree_path));
    }
    let was_registered = is_registered_worktree(repo_path, worktree_path)?;
    if was_registered {
        let mut args = vec!["worktree", "remove", worktree_path];
        if force {
            args.push("--force");
        }
        let output = create_git_command(repo_path)
            .args(args)
            .output()
            .map_err(|e| format!("Failed to remove git worktree: {}", e))?;
        if !output.status.success() && is_registered_worktree(repo_path, worktree_path)? {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Git worktree remove failed: {}", stderr.trim()));
        }
    }

    remove_leftover_folder(Path::new(worktree_path), was_registered)?;

    let _ = create_git_command(repo_path).args(["worktree", "prune"]).output();
    Ok(())
}

/// Deletes what is left of an unregistered worktree's folder: all of it when git listed
/// the worktree at the start of this removal, otherwise only an empty folder.
fn remove_leftover_folder(folder: &Path, was_registered: bool) -> Result<(), String> {
    if !folder.exists() {
        return Ok(());
    }
    if !was_registered {
        let is_empty = std::fs::read_dir(folder)
            .map_err(|e| format!("Failed to read '{}': {}", folder.display(), e))?
            .next()
            .is_none();
        if !is_empty {
            return Err(format!(
                "'{}' is not a worktree of this project and isn't empty, so Quay left it in place",
                folder.display()
            ));
        }
    }
    let mut delays = LOCK_RETRY_DELAYS_MS.iter();
    loop {
        let removed = if was_registered {
            std::fs::remove_dir_all(folder)
        } else {
            std::fs::remove_dir(folder)
        };
        match removed {
            Ok(()) => return Ok(()),
            Err(_) if !folder.exists() => return Ok(()),
            Err(e) => match delays.next() {
                Some(ms) => std::thread::sleep(std::time::Duration::from_millis(*ms)),
                None => {
                    return Err(format!(
                        "Git no longer lists the worktree, but its folder '{}' could not be deleted: {}",
                        folder.display(),
                        e
                    ))
                }
            },
        }
    }
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

    /// Holds `folder` open without delete sharing, as a just-killed terminal's process
    /// holds its working directory on Windows, and lets go after `hold`.
    #[cfg(windows)]
    fn hold_open(folder: PathBuf, hold: std::time::Duration) -> std::thread::JoinHandle<()> {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ_WRITE: u32 = 0x1 | 0x2;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        let handle = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(folder)
            .unwrap();
        std::thread::spawn(move || {
            std::thread::sleep(hold);
            drop(handle);
        })
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn remove_waits_for_a_file_a_closing_process_still_holds() {
        let (root, repo, worktree) = repo_with_worktree();
        let release = hold_open(worktree.clone(), std::time::Duration::from_millis(800));

        remove_git_worktree(
            repo.to_string_lossy().to_string(),
            worktree.to_string_lossy().to_string(),
            false,
        )
        .await
        .unwrap();

        release.join().unwrap();
        assert!(!worktree.exists());
        assert!(!is_registered_worktree(&repo.to_string_lossy(), &worktree.to_string_lossy()).unwrap());
        let _ = std::fs::remove_dir_all(root);
    }

    /// A worktree git has unregistered but whose emptied folder it could not delete: what
    /// an interrupted `git worktree remove` leaves behind.
    fn half_removed_worktree() -> (PathBuf, PathBuf, PathBuf) {
        let (root, repo, worktree) = repo_with_worktree();
        std::fs::remove_dir_all(&worktree).unwrap();
        sh_git(&repo, &["worktree", "prune"]);
        std::fs::create_dir(&worktree).unwrap();
        (root, repo, worktree)
    }

    #[tokio::test]
    async fn removing_a_half_removed_worktree_deletes_its_empty_folder() {
        let (root, repo, worktree) = half_removed_worktree();

        remove_git_worktree(
            repo.to_string_lossy().to_string(),
            worktree.to_string_lossy().to_string(),
            true,
        )
        .await
        .unwrap();

        assert!(!worktree.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn a_folder_that_is_not_a_worktree_and_holds_files_is_left_alone() {
        let (root, repo, worktree) = half_removed_worktree();
        std::fs::write(worktree.join("keep.txt"), "mine\n").unwrap();

        let error = remove_git_worktree(
            repo.to_string_lossy().to_string(),
            worktree.to_string_lossy().to_string(),
            true,
        )
        .await
        .expect_err("a non-empty folder git doesn't know is never deleted");

        assert!(error.contains("is not a worktree of this project"), "{}", error);
        assert!(worktree.join("keep.txt").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn a_worktree_path_spelled_another_way_is_still_removed() {
        let (root, repo, worktree) = repo_with_worktree();
        let spelled = repo.join("..").join("wt");

        remove_git_worktree(
            repo.to_string_lossy().to_string(),
            spelled.to_string_lossy().to_string(),
            false,
        )
        .await
        .unwrap();

        assert!(!worktree.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn a_relative_worktree_path_is_refused() {
        let (root, repo, worktree) = repo_with_worktree();

        let error = remove_git_worktree(repo.to_string_lossy().to_string(), "wt".to_string(), true)
            .await
            .expect_err("a relative path is refused");

        assert!(error.contains("must be absolute"), "{}", error);
        assert!(worktree.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn removing_a_worktree_that_is_already_gone_succeeds() {
        let (root, repo, worktree) = half_removed_worktree();
        std::fs::remove_dir(&worktree).unwrap();

        remove_git_worktree(
            repo.to_string_lossy().to_string(),
            worktree.to_string_lossy().to_string(),
            false,
        )
        .await
        .unwrap();
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

    #[tokio::test]
    async fn non_git_folder_returns_empty_worktree_list() {
        let root = std::env::temp_dir().join(format!("quay-nogit-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&root).unwrap();
        let res = list_git_worktrees(root.to_string_lossy().to_string()).await.unwrap();
        assert!(res.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}
