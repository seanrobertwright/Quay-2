//! Thin wrappers over the `git` CLI for the factory. Every call runs without a console
//! window, without a terminal prompt, with paths printed unquoted, and without the optional
//! index lock that `status` and `diff` take, so a read never blocks an agent's git.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub struct GitOut {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl GitOut {
    pub fn ok(&self) -> bool {
        self.code == Some(0)
    }

    fn message(&self) -> String {
        let err = self.stderr.trim();
        if err.is_empty() {
            self.stdout.trim().to_string()
        } else {
            err.to_string()
        }
    }
}

fn git_cmd(dir: &Path) -> Command {
    let mut cmd = crate::spawn::hidden_command("git");
    cmd.current_dir(dir)
        .args(["-c", "core.quotepath=false"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null());
    cmd
}

/// Runs git; `Err` only when git itself cannot be started.
pub fn run(dir: &Path, args: &[&str]) -> Result<GitOut, String> {
    let out = git_cmd(dir)
        .args(args)
        .output()
        .map_err(|e| format!("cannot run git: {}", e))?;
    Ok(GitOut {
        code: out.status.code(),
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
    })
}

/// Runs git and returns stdout, or an error naming the command and git's message.
pub fn run_ok(dir: &Path, args: &[&str]) -> Result<String, String> {
    run_ok_with(dir, args, &[0])
}

/// `run_ok` for a command whose success is any of the exit codes `ok`, such as
/// `diff --no-index`, which exits 1 when the files differ.
pub fn run_ok_with(dir: &Path, args: &[&str], ok: &[i32]) -> Result<String, String> {
    let out = run(dir, args)?;
    if out.code.is_some_and(|c| ok.contains(&c)) {
        Ok(out.stdout)
    } else {
        Err(format!("git {} failed: {}", args.join(" "), out.message()))
    }
}

/// Converts git's forward-slash output to the platform's separator.
pub fn native_path(s: &str) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(s.trim().replace('/', "\\"))
    } else {
        PathBuf::from(s.trim())
    }
}

/// Lowercased, forward-slash form for comparing paths.
pub fn path_key(p: &Path) -> String {
    p.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

pub fn repo_root(path: &Path) -> Result<PathBuf, String> {
    if !path.is_dir() {
        return Err(format!("{} is not a directory", path.display()));
    }
    let out = run_ok(path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| format!("{} is not inside a git repository", path.display()))?;
    Ok(native_path(&out))
}

/// Current branch name, or `None` on a detached HEAD.
pub fn current_branch(repo: &Path) -> Option<String> {
    let out = run(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok()?;
    let name = out.stdout.trim();
    (out.ok() && !name.is_empty()).then(|| name.to_string())
}

/// Checks a branch name the way git does, and refuses names that look like options.
pub fn validate_branch_name(repo: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.starts_with('-') {
        return Err(format!("'{}' is not a valid branch name", name));
    }
    let out = run(repo, &["check-ref-format", "--branch", name])?;
    if out.ok() {
        Ok(out.stdout.trim().to_string())
    } else {
        Err(format!("'{}' is not a valid branch name", name))
    }
}

pub fn resolve_commit(repo: &Path, rev: &str) -> Result<String, String> {
    if rev.starts_with('-') {
        return Err(format!("'{}' is not a revision", rev));
    }
    let spec = format!("{}^{{commit}}", rev);
    let out = run(repo, &["rev-parse", "--verify", "--quiet", &spec])?;
    if out.ok() {
        Ok(out.stdout.trim().to_string())
    } else {
        Err(format!("'{}' does not name a commit in {}", rev, repo.display()))
    }
}

pub fn branch_exists(repo: &Path, name: &str) -> bool {
    let r = format!("refs/heads/{}", name);
    run(repo, &["show-ref", "--verify", "--quiet", &r]).is_ok_and(|o| o.ok())
}

pub fn head_sha(dir: &Path) -> Result<String, String> {
    Ok(run_ok(dir, &["rev-parse", "HEAD"])?.trim().to_string())
}

/// Paths of the worktrees registered with the repository, as `path_key`s.
pub fn worktree_keys(repo: &Path) -> Result<Vec<String>, String> {
    let out = run_ok(repo, &["worktree", "list", "--porcelain"])?;
    Ok(out
        .lines()
        .filter_map(|l| l.strip_prefix("worktree "))
        .map(|p| path_key(&native_path(p)))
        .collect())
}

pub fn is_registered_worktree(repo: &Path, wt: &Path) -> bool {
    worktree_keys(repo).is_ok_and(|keys| keys.contains(&path_key(wt)))
}

/// `git worktree add`, creating `branch` at `start` when `create` is set.
pub fn add_worktree(
    repo: &Path,
    wt: &Path,
    branch: &str,
    start: &str,
    create: bool,
) -> Result<(), String> {
    let wt_s = wt.to_string_lossy().to_string();
    if create {
        run_ok(repo, &["worktree", "add", "-b", branch, &wt_s, start])?;
    } else {
        run_ok(repo, &["worktree", "add", &wt_s, branch])?;
    }
    Ok(())
}

pub fn remove_worktree(repo: &Path, wt: &Path, force: bool) -> Result<(), String> {
    let wt_s = wt.to_string_lossy().to_string();
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&wt_s);
    run_ok(repo, &args)?;
    let _ = run(repo, &["worktree", "prune"]);
    Ok(())
}

/// Adds `line` to the repository's `info/exclude` (local to this clone, never
/// committed) unless it is already there.
pub fn ensure_excluded(repo: &Path, line: &str) -> Result<(), String> {
    let common = run_ok(repo, &["rev-parse", "--git-common-dir"])?;
    let mut dir = native_path(&common);
    if dir.is_relative() {
        dir = repo.join(dir);
    }
    let info = dir.join("info");
    fs::create_dir_all(&info).map_err(|e| format!("cannot create {}: {}", info.display(), e))?;
    let path = info.join("exclude");
    let current = fs::read_to_string(&path).unwrap_or_default();
    if current.lines().any(|l| l.trim() == line) {
        return Ok(());
    }
    let mut next = current;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(line);
    next.push('\n');
    fs::write(&path, next).map_err(|e| format!("cannot write {}: {}", path.display(), e))
}

fn split_nul(s: &str) -> Vec<String> {
    s.split('\0').filter(|x| !x.is_empty()).map(str::to_string).collect()
}

/// Tracked files under `rel` (repo-relative, forward slashes).
pub fn ls_files(repo: &Path, rel: &str) -> Result<Vec<String>, String> {
    Ok(split_nul(&run_ok(repo, &["ls-files", "-z", "--", rel])?))
}

/// Hides tracked files from a worktree: sets skip-worktree so git treats them as
/// unchanged, then deletes them from disk.
pub fn hide_tracked(wt: &Path, files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["update-index", "--skip-worktree", "--"];
    args.extend(files.iter().map(String::as_str));
    run_ok(wt, &args)?;
    for f in files {
        let p = wt.join(native_path(f));
        if p.exists() {
            fs::remove_file(&p).map_err(|e| format!("cannot remove {}: {}", p.display(), e))?;
        }
    }
    Ok(())
}

fn exclude_specs(rels: &[&str]) -> Vec<String> {
    rels.iter().map(|r| format!(":(exclude){}", r)).collect()
}

/// Paths with uncommitted changes (tracked or untracked), leaving out `excludes`.
pub fn dirty_paths(dir: &Path, excludes: &[&str]) -> Result<Vec<String>, String> {
    let specs = exclude_specs(excludes);
    let mut args = vec!["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."];
    args.extend(specs.iter().map(String::as_str));
    let out = run_ok(dir, &args)?;
    let mut paths = Vec::new();
    let mut entries = out.split('\0').filter(|x| !x.is_empty());
    while let Some(entry) = entries.next() {
        if entry.len() < 4 {
            continue;
        }
        let (xy, path) = entry.split_at(3);
        paths.push(path.to_string());
        // A rename or copy is followed by its source path.
        if (xy.starts_with('R') || xy.starts_with('C'))
            && let Some(src) = entries.next()
        {
            paths.push(src.to_string());
        }
    }
    Ok(paths)
}

/// Stages everything except `excludes` and commits it. Returns false when there was
/// nothing to commit. Hooks run as usual.
pub fn commit_all(dir: &Path, message: &str, excludes: &[&str]) -> Result<bool, String> {
    let specs = exclude_specs(excludes);
    let mut args = vec!["add", "-A", "--", "."];
    args.extend(specs.iter().map(String::as_str));
    run_ok(dir, &args)?;
    let staged = run(dir, &["diff", "--cached", "--quiet"])?;
    match staged.code {
        Some(0) => Ok(false),
        Some(1) => {
            run_ok(dir, &["commit", "-q", "-m", message])?;
            Ok(true)
        }
        _ => Err(format!("git diff --cached failed: {}", staged.message())),
    }
}

/// Files changed between the merge base of `base` and `head`, and `head`. Renames are
/// reported as a delete plus an add so both paths are checked.
pub fn changed_files(dir: &Path, base: &str, head: &str) -> Result<Vec<String>, String> {
    let mb = run_ok(dir, &["merge-base", base, head])?;
    let mb = mb.trim();
    Ok(split_nul(&run_ok(
        dir,
        &["diff", "--name-only", "--no-renames", "-z", mb, head],
    )?))
}

/// Squash-merges `branch` into the main checkout, which must be on `base_branch` with
/// no uncommitted tracked changes. Returns the new commit. Leaves the checkout as it
/// was on any failure.
pub fn squash_merge(
    repo: &Path,
    base_branch: &str,
    branch: &str,
    message: &str,
) -> Result<String, String> {
    match current_branch(repo) {
        Some(b) if b == base_branch => {}
        Some(b) => {
            return Err(format!(
                "the main checkout is on '{}'; switch it to '{}' to merge",
                b, base_branch
            ))
        }
        None => {
            return Err(format!(
                "the main checkout has a detached HEAD; switch it to '{}' to merge",
                base_branch
            ))
        }
    }
    let dirty = run_ok(repo, &["status", "--porcelain", "--untracked-files=no"])?;
    if !dirty.trim().is_empty() {
        return Err(
            "the main checkout has uncommitted changes to tracked files; commit or stash them first"
                .to_string(),
        );
    }
    let abort = || {
        let _ = run(repo, &["reset", "--merge"]);
    };
    if let Err(e) = run_ok(repo, &["merge", "--squash", branch]) {
        abort();
        return Err(e);
    }
    match run(repo, &["diff", "--cached", "--quiet"])?.code {
        Some(1) => {}
        Some(0) => {
            abort();
            return Err(format!("'{}' has no changes relative to '{}'", branch, base_branch));
        }
        _ => {
            abort();
            return Err("git diff --cached failed after the squash merge".to_string());
        }
    }
    if let Err(e) = run_ok(repo, &["commit", "-q", "-m", message]) {
        abort();
        return Err(e);
    }
    head_sha(repo)
}
