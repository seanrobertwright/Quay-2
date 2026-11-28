//! Where the github slice's pull request commands reach `gh`: the repository and number they
//! act on, parsed at the boundary; `gh` run under a timeout off the async runtime; and reading
//! GitHub's JSON and errors.

/// How long one `gh` call may take before it is killed.
pub(super) const GH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

pub(super) fn count(value: &serde_json::Value) -> u32 {
    value.as_u64().and_then(|n| u32::try_from(n).ok()).unwrap_or(0)
}

pub(super) fn text(value: &serde_json::Value) -> String {
    value.as_str().unwrap_or_default().to_string()
}

/// The error GitHub gave in `stdout` (GraphQL `errors`, else a REST `message`), else `stderr`,
/// else `fallback`.
pub(super) fn api_error(stdout: &[u8], stderr: &str, fallback: &str) -> String {
    let json = serde_json::from_slice::<serde_json::Value>(stdout).unwrap_or(serde_json::Value::Null);
    let messages: Vec<&str> = json["errors"]
        .as_array()
        .map(|errs| errs.iter().filter_map(|e| e["message"].as_str()).collect())
        .unwrap_or_default();
    if !messages.is_empty() {
        return messages.join("; ");
    }
    if let Some(message) = json["message"].as_str() {
        return message.to_string();
    }
    if !stderr.trim().is_empty() {
        return stderr.trim().to_string();
    }
    fallback.to_string()
}

/// The repository a pull request command acts on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RepoSlug {
    /// The working folder's repository, which `gh` fills into `{owner}` and `{repo}`.
    Folder,
    /// A named repository, `owner` and `name`.
    Named(String, String),
}

impl RepoSlug {
    /// The REST path of the repository.
    pub(super) fn path(&self) -> String {
        match self {
            RepoSlug::Folder => "repos/{owner}/{repo}".to_string(),
            RepoSlug::Named(owner, name) => format!("repos/{owner}/{name}"),
        }
    }

    /// The `gh api graphql` fields that set `$owner` and `$name`. A named repository goes as raw
    /// strings (`-f`); the working folder's goes as `-F`, the only form in which `gh` fills its
    /// placeholders.
    pub(super) fn graphql_fields(&self) -> [String; 4] {
        match self {
            RepoSlug::Folder => ["-F".into(), "owner={owner}".into(), "-F".into(), "name={repo}".into()],
            RepoSlug::Named(owner, name) => ["-f".into(), format!("owner={owner}"), "-f".into(), format!("name={name}")],
        }
    }
}

/// Parses a pull request slot's repository: `owner/name`, or none for the working folder's.
pub(super) fn repo_slug(repo: Option<&str>) -> Result<RepoSlug, String> {
    let Some(repo) = repo else { return Ok(RepoSlug::Folder) };
    let part_ok = |p: &str| {
        !p.is_empty() && p != "." && p != ".." && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    match repo.split_once('/') {
        Some((owner, name)) if part_ok(owner) && part_ok(name) => Ok(RepoSlug::Named(owner.to_string(), name.to_string())),
        _ => Err(format!("Not a repository name (owner/name): {repo:?}")),
    }
}

/// Runs `gh` with `args` in `repo_path` under `GH_TIMEOUT` and returns what it printed, whether or
/// not it succeeded.
pub(super) fn run_gh(repo_path: &str, args: &[String]) -> Result<super::commands::GhOutput, String> {
    let mut cmd = super::commands::create_gh_command(repo_path);
    cmd.args(args);
    super::commands::output_within(&mut cmd, GH_TIMEOUT)
}

/// Runs `gh` with `args` in `repo_path` under `GH_TIMEOUT` and returns its stdout, or GitHub's
/// error when it fails.
pub(super) fn gh_api(repo_path: &str, args: &[String], what: &str) -> Result<Vec<u8>, String> {
    let out = run_gh(repo_path, args)?;
    if out.success {
        Ok(out.stdout)
    } else {
        Err(api_error(&out.stdout, &out.stderr, &format!("{what} failed")))
    }
}

pub(super) fn number_arg(number: u32) -> Result<u32, String> {
    if number == 0 {
        Err("Not an issue or pull request number: 0".to_string())
    } else {
        Ok(number)
    }
}

/// Runs `work` off the async runtime, where `gh` may block for up to `GH_TIMEOUT` per call.
pub(super) async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(work).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Parses a pull request command's repository and number, then runs `work` on them with
/// `blocking`.
pub(super) async fn pr_task<T: Send + 'static>(
    repo: Option<String>,
    number: u32,
    work: impl FnOnce(RepoSlug, u32) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let slug = repo_slug(repo.as_deref())?;
    let number = number_arg(number)?;
    blocking(move || work(slug, number)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_slug_takes_owner_and_name_or_falls_back_to_the_working_folder_s() {
        assert_eq!(repo_slug(None).unwrap(), RepoSlug::Folder);
        assert_eq!(repo_slug(Some("o-1/r.x_y")).unwrap(), RepoSlug::Named("o-1".into(), "r.x_y".into()));
        for bad in ["", "o", "o/r/x", "../r", "o/..", "o r/x", "/r", "o/"] {
            assert!(repo_slug(Some(bad)).is_err(), "{bad}");
        }
        assert_eq!(RepoSlug::Folder.path(), "repos/{owner}/{repo}");
        assert_eq!(RepoSlug::Named("o".into(), "r".into()).path(), "repos/o/r");
    }

    #[test]
    fn number_arg_refuses_zero() {
        assert!(number_arg(0).is_err());
        assert_eq!(number_arg(7), Ok(7));
    }
}
