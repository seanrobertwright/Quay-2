//! The companion's pull request view: one pull request's readiness, and merging, deleting and
//! restoring its branch, and reopening it, all through `gh api`.

use serde::Serialize;

/// Check runs and status contexts read per pull request; more than this are not counted.
const CHECKS_READ: u32 = 100;
/// Review threads read per pull request for the unresolved count; more than this are not counted.
const THREADS_READ: u32 = 100;

/// How a pull request's head commit checks stand, counted by outcome.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct PullRequestCheckCounts {
    pub failing: u32,
    pub pending: u32,
    pub skipped: u32,
    pub passing: u32,
}

/// Conversation comments and review threads; `unresolved` counts review threads only.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct PullRequestCommentCounts {
    pub total: u32,
    pub unresolved: u32,
}

/// What the companion's pull request view reads about one pull request. Mirrors
/// `PullRequestReadiness` in the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReadiness {
    pub repo: String,
    pub number: u32,
    pub title: String,
    pub body: String,
    pub url: String,
    pub state: String,
    pub is_draft: bool,
    pub base_ref_name: String,
    pub head_ref_name: String,
    pub head_ref_oid: String,
    pub head_branch_exists: bool,
    pub is_cross_repository: bool,
    pub additions: u32,
    pub deletions: u32,
    pub changed_files: u32,
    pub mergeable: String,
    pub merge_state_status: String,
    pub review_decision: Option<String>,
    pub checks: PullRequestCheckCounts,
    pub comments: PullRequestCommentCounts,
    pub commits: u32,
}

/// The query for one pull request's readiness. `$owner` and `$name` name its repository.
fn readiness_query() -> String {
    format!(
        "query($owner: String!, $name: String!, $number: Int!) {{ repository(owner: $owner, name: $name) {{ nameWithOwner pullRequest(number: $number) {{ \
number title body url state isDraft baseRefName headRefName headRefOid isCrossRepository headRef {{ id }} \
additions deletions changedFiles mergeable mergeStateStatus reviewDecision comments {{ totalCount }} \
reviewThreads(first: {THREADS_READ}) {{ totalCount nodes {{ isResolved }} }} \
commits(last: 1) {{ totalCount nodes {{ commit {{ statusCheckRollup {{ contexts(first: {CHECKS_READ}) {{ nodes {{ \
__typename ... on CheckRun {{ status conclusion }} ... on StatusContext {{ state }} }} }} }} }} }} }} }} }} }}"
    )
}

/// Counts check runs and status contexts by outcome, as GitHub's merge box groups them.
fn count_checks(nodes: &[serde_json::Value]) -> PullRequestCheckCounts {
    let mut counts = PullRequestCheckCounts::default();
    for node in nodes {
        let bucket = if node["__typename"] == "StatusContext" {
            match node["state"].as_str().unwrap_or_default() {
                "SUCCESS" => &mut counts.passing,
                "FAILURE" | "ERROR" => &mut counts.failing,
                _ => &mut counts.pending,
            }
        } else if node["status"].as_str() != Some("COMPLETED") {
            &mut counts.pending
        } else {
            match node["conclusion"].as_str().unwrap_or_default() {
                "SUCCESS" => &mut counts.passing,
                "SKIPPED" | "NEUTRAL" | "STALE" => &mut counts.skipped,
                _ => &mut counts.failing,
            }
        };
        *bucket += 1;
    }
    counts
}

fn count(value: &serde_json::Value) -> u32 {
    value.as_u64().and_then(|n| u32::try_from(n).ok()).unwrap_or(0)
}

fn text(value: &serde_json::Value) -> String {
    value.as_str().unwrap_or_default().to_string()
}

/// The error GitHub gave in `stdout` (GraphQL `errors`, else a REST `message`), else `stderr`,
/// else `fallback`.
fn api_error(stdout: &[u8], stderr: &str, fallback: &str) -> String {
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

/// Reads the readiness query's output.
fn parse_readiness(stdout: &[u8], stderr: &str) -> Result<PullRequestReadiness, String> {
    let json = serde_json::from_slice::<serde_json::Value>(stdout).unwrap_or(serde_json::Value::Null);
    let repo = &json["data"]["repository"];
    let pr = &repo["pullRequest"];
    if !pr.is_object() {
        return Err(api_error(stdout, stderr, "GitHub returned no pull request"));
    }
    let threads = pr["reviewThreads"]["nodes"].as_array().map(Vec::as_slice).unwrap_or_default();
    let head = &pr["commits"]["nodes"][0]["commit"];
    let contexts = head["statusCheckRollup"]["contexts"]["nodes"].as_array().map(Vec::as_slice).unwrap_or_default();
    Ok(PullRequestReadiness {
        repo: text(&repo["nameWithOwner"]),
        number: count(&pr["number"]),
        title: text(&pr["title"]),
        body: text(&pr["body"]),
        url: text(&pr["url"]),
        state: text(&pr["state"]),
        is_draft: pr["isDraft"].as_bool().unwrap_or(false),
        base_ref_name: text(&pr["baseRefName"]),
        head_ref_name: text(&pr["headRefName"]),
        head_ref_oid: text(&pr["headRefOid"]),
        head_branch_exists: pr["headRef"].is_object(),
        is_cross_repository: pr["isCrossRepository"].as_bool().unwrap_or(false),
        additions: count(&pr["additions"]),
        deletions: count(&pr["deletions"]),
        changed_files: count(&pr["changedFiles"]),
        mergeable: pr["mergeable"].as_str().unwrap_or("UNKNOWN").to_string(),
        merge_state_status: pr["mergeStateStatus"].as_str().unwrap_or("UNKNOWN").to_string(),
        review_decision: pr["reviewDecision"].as_str().map(str::to_string),
        checks: count_checks(contexts),
        comments: PullRequestCommentCounts {
            total: count(&pr["comments"]["totalCount"]) + count(&pr["reviewThreads"]["totalCount"]),
            unresolved: threads.iter().filter(|t| t["isResolved"] == false).count() as u32,
        },
        commits: count(&pr["commits"]["totalCount"]),
    })
}

/// The repository a pull request command acts on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RepoSlug {
    /// The working folder's repository, which `gh` fills into `{owner}` and `{repo}`.
    Folder,
    /// A named repository, `owner` and `name`.
    Named(String, String),
}

impl RepoSlug {
    /// The REST path of the repository.
    fn path(&self) -> String {
        match self {
            RepoSlug::Folder => "repos/{owner}/{repo}".to_string(),
            RepoSlug::Named(owner, name) => format!("repos/{owner}/{name}"),
        }
    }

    /// The `gh api graphql` fields that set `$owner` and `$name`. A named repository goes as raw
    /// strings (`-f`); the working folder's goes as `-F`, the only form in which `gh` fills its
    /// placeholders.
    fn graphql_fields(&self) -> [String; 4] {
        match self {
            RepoSlug::Folder => ["-F".into(), "owner={owner}".into(), "-F".into(), "name={repo}".into()],
            RepoSlug::Named(owner, name) => ["-f".into(), format!("owner={owner}"), "-f".into(), format!("name={name}")],
        }
    }
}

/// Parses a pull request slot's repository: `owner/name`, or none for the working folder's.
fn repo_slug(repo: Option<&str>) -> Result<RepoSlug, String> {
    let Some(repo) = repo else { return Ok(RepoSlug::Folder) };
    let part_ok = |p: &str| {
        !p.is_empty() && p != "." && p != ".." && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    match repo.split_once('/') {
        Some((owner, name)) if part_ok(owner) && part_ok(name) => Ok(RepoSlug::Named(owner.to_string(), name.to_string())),
        _ => Err(format!("Not a repository name (owner/name): {repo:?}")),
    }
}

/// Parses a merge method GitHub's merge API takes.
fn merge_method(method: &str) -> Result<&'static str, String> {
    match method {
        "merge" => Ok("merge"),
        "squash" => Ok("squash"),
        "rebase" => Ok("rebase"),
        other => Err(format!("Not a merge method (merge, squash or rebase): {other:?}")),
    }
}

/// Checks `branch` is a name git takes for a branch and returns it escaped for a `git/refs/heads/`
/// path, with each `#` and `%` percent-encoded.
fn branch_ref_path(branch: &str) -> Result<String, String> {
    let bad = branch.is_empty()
        || branch.starts_with(['-', '/'])
        || branch.ends_with('/')
        || branch.ends_with(".lock")
        || branch.contains("..")
        || branch.chars().any(|c| c.is_control() || matches!(c, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\'));
    if bad {
        return Err(format!("Not a branch name: {branch:?}"));
    }
    Ok(branch.replace('%', "%25").replace('#', "%23"))
}

/// Checks `sha` is a hex object id (SHA-1 or SHA-256).
fn check_sha(sha: &str) -> Result<(), String> {
    if matches!(sha.len(), 40 | 64) && sha.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(format!("Not a commit SHA: {sha:?}"))
    }
}

/// The `gh` arguments for GitHub's async merge API. `sha` makes GitHub refuse the merge if the head
/// moved since the operator looked. Rebase writes no new commit, so it sends no message, and a
/// blank title or message is left for GitHub to fill.
fn merge_async_args(
    repo: &RepoSlug,
    number: u32,
    method: &str,
    title: Option<&str>,
    message: Option<&str>,
    sha: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "api".into(),
        "--method".into(),
        "PUT".into(),
        format!("{}/pulls/{number}/merge-async", repo.path()),
        "-f".into(),
        format!("merge_method={method}"),
        "-f".into(),
        format!("sha={sha}"),
    ];
    if method != "rebase" {
        for (field, value) in [("commit_title", title), ("commit_message", message)] {
            if let Some(value) = value.filter(|v| !v.trim().is_empty()) {
                args.push("-f".into());
                args.push(format!("{field}={value}"));
            }
        }
    }
    args
}

/// Where a pull request stands, as the REST pull request reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PullState {
    Open,
    Merged,
    Closed,
}

/// Reads `merged` and `state` from `gh api repos/{owner}/{repo}/pulls/N`.
fn parse_pull_state(stdout: &[u8], stderr: &str) -> Result<PullState, String> {
    let json = serde_json::from_slice::<serde_json::Value>(stdout).unwrap_or(serde_json::Value::Null);
    match (json["merged"].as_bool(), json["state"].as_str()) {
        (Some(true), _) => Ok(PullState::Merged),
        (Some(false), Some("closed")) => Ok(PullState::Closed),
        (Some(false), Some("open")) => Ok(PullState::Open),
        _ => Err(api_error(stdout, stderr, "GitHub returned no pull request state")),
    }
}

/// How long the merge-async API is given between polls of the pull request.
const MERGE_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);
/// How many times the pull request is polled before the merge counts as timed out.
const MERGE_POLL_ATTEMPTS: u32 = 30;
/// How long one `gh` call may take before it is killed.
const GH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Polls `fetch` until the pull request has merged, sleeping `MERGE_POLL_INTERVAL` between polls,
/// at most `attempts` times. Fails on a fetch error, on the pull request closing unmerged, and
/// once the attempts run out.
fn wait_for_merge(
    mut fetch: impl FnMut() -> Result<PullState, String>,
    mut sleep: impl FnMut(std::time::Duration),
    attempts: u32,
) -> Result<(), String> {
    for attempt in 0..attempts {
        if attempt > 0 {
            sleep(MERGE_POLL_INTERVAL);
        }
        match fetch()? {
            PullState::Merged => return Ok(()),
            PullState::Closed => return Err("The pull request was closed before it merged.".to_string()),
            PullState::Open => {}
        }
    }
    Err(format!(
        "GitHub did not finish the merge within {} s. It may still merge; check the pull request on GitHub.",
        MERGE_POLL_INTERVAL.as_secs() * u64::from(attempts.saturating_sub(1))
    ))
}

/// Runs `gh` with `args` in `repo_path` under `GH_TIMEOUT` and returns its stdout, or GitHub's
/// error when it fails.
fn gh_api(repo_path: &str, args: &[String], what: &str) -> Result<Vec<u8>, String> {
    let mut cmd = super::commands::create_gh_command(repo_path);
    cmd.args(args);
    let out = super::commands::output_within(&mut cmd, GH_TIMEOUT)?;
    if out.success {
        Ok(out.stdout)
    } else {
        Err(api_error(&out.stdout, &out.stderr, &format!("{what} failed")))
    }
}

fn number_arg(number: u32) -> Result<u32, String> {
    if number == 0 {
        Err("Not a pull request number: 0".to_string())
    } else {
        Ok(number)
    }
}

/// One pull request's header and readiness, for the companion's pull request view. `repo` is the
/// pull request slot's `owner/name`, or none for the repository at `repo_path`.
#[tauri::command]
pub async fn get_github_pr_readiness(
    repo_path: String,
    repo: Option<String>,
    number: u32,
) -> Result<PullRequestReadiness, String> {
    let slug = repo_slug(repo.as_deref())?;
    let number = number_arg(number)?;
    tokio::task::spawn_blocking(move || {
        let mut cmd = super::commands::create_gh_command(&repo_path);
        cmd.args(["api", "graphql"]);
        cmd.args(slug.graphql_fields());
        cmd.args(["-F".to_string(), format!("number={number}"), "-f".to_string(), format!("query={}", readiness_query())]);
        // A GraphQL error exits non-zero but still prints `errors`, which the parser reports.
        let out = super::commands::output_within(&mut cmd, GH_TIMEOUT)?;
        parse_readiness(&out.stdout, &out.stderr)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// What came of a merge: the merge itself succeeded, and the branch was deleted or why not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeOutcome {
    pub branch_deleted: bool,
    /// Why Delete branch after merge failed, when it was asked for and failed.
    pub branch_error: Option<String>,
}

/// Merges a pull request through GitHub's async merge API, waits for GitHub to report it merged,
/// then deletes the head branch when `delete_branch` is set. Each `gh` call is killed after
/// 20 s, and the wait gives up after 58 s with an error that says the merge may still land.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn merge_github_pr(
    repo_path: String,
    repo: Option<String>,
    number: u32,
    method: String,
    commit_title: Option<String>,
    commit_message: Option<String>,
    head_sha: String,
    head_branch: String,
    delete_branch: bool,
) -> Result<MergeOutcome, String> {
    let slug = repo_slug(repo.as_deref())?;
    let number = number_arg(number)?;
    let method = merge_method(&method)?;
    check_sha(&head_sha)?;
    let branch_path = if delete_branch { Some(branch_ref_path(&head_branch)?) } else { None };
    tokio::task::spawn_blocking(move || {
        let args = merge_async_args(&slug, number, method, commit_title.as_deref(), commit_message.as_deref(), &head_sha);
        gh_api(&repo_path, &args, "Merge")?;
        let pull = [String::from("api"), format!("{}/pulls/{number}", slug.path())];
        wait_for_merge(
            || {
                let mut cmd = super::commands::create_gh_command(&repo_path);
                cmd.args(&pull);
                let out = super::commands::output_within(&mut cmd, GH_TIMEOUT)?;
                parse_pull_state(&out.stdout, &out.stderr)
            },
            std::thread::sleep,
            MERGE_POLL_ATTEMPTS,
        )?;
        let Some(branch_path) = branch_path else {
            return Ok(MergeOutcome { branch_deleted: false, branch_error: None });
        };
        let delete = delete_args(&slug, &branch_path);
        Ok(match gh_api(&repo_path, &delete, "Delete branch") {
            Ok(_) => MergeOutcome { branch_deleted: true, branch_error: None },
            Err(e) => MergeOutcome { branch_deleted: false, branch_error: Some(e) },
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

fn delete_args(slug: &RepoSlug, branch_path: &str) -> Vec<String> {
    vec!["api".into(), "--method".into(), "DELETE".into(), format!("{}/git/refs/heads/{branch_path}", slug.path())]
}

/// Deletes a pull request's head branch on GitHub.
#[tauri::command]
pub async fn delete_github_branch(repo_path: String, repo: Option<String>, branch: String) -> Result<(), String> {
    let slug = repo_slug(repo.as_deref())?;
    let branch_path = branch_ref_path(&branch)?;
    tokio::task::spawn_blocking(move || gh_api(&repo_path, &delete_args(&slug, &branch_path), "Delete branch").map(|_| ()))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// Puts a deleted head branch back on GitHub at `sha`, the pull request's last head commit.
#[tauri::command]
pub async fn restore_github_branch(repo_path: String, repo: Option<String>, branch: String, sha: String) -> Result<(), String> {
    let slug = repo_slug(repo.as_deref())?;
    branch_ref_path(&branch)?;
    check_sha(&sha)?;
    tokio::task::spawn_blocking(move || {
        let args: Vec<String> = vec![
            "api".into(),
            "--method".into(),
            "POST".into(),
            format!("{}/git/refs", slug.path()),
            "-f".into(),
            format!("ref=refs/heads/{branch}"),
            "-f".into(),
            format!("sha={sha}"),
        ];
        gh_api(&repo_path, &args, "Restore branch").map(|_| ())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Reopens a closed pull request.
#[tauri::command]
pub async fn reopen_github_pr(repo_path: String, repo: Option<String>, number: u32) -> Result<(), String> {
    let slug = repo_slug(repo.as_deref())?;
    let number = number_arg(number)?;
    tokio::task::spawn_blocking(move || {
        let args: Vec<String> = vec![
            "api".into(),
            "--method".into(),
            "PATCH".into(),
            format!("{}/pulls/{number}", slug.path()),
            "-f".into(),
            "state=open".into(),
        ];
        gh_api(&repo_path, &args, "Reopen").map(|_| ())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_readiness_reads_the_header_and_counts() {
        let out = br#"{ "data": { "repository": {
            "nameWithOwner": "o/r",
            "pullRequest": {
                "number": 12, "title": "Add the thing", "body": "Closes #5", "url": "https://github.com/o/r/pull/12",
                "state": "OPEN", "isDraft": false, "baseRefName": "master", "headRefName": "ticket-5",
                "headRefOid": "abc", "isCrossRepository": false, "headRef": { "id": "R1" },
                "additions": 120, "deletions": 30, "changedFiles": 3,
                "mergeable": "MERGEABLE", "mergeStateStatus": "BLOCKED", "reviewDecision": null,
                "comments": { "totalCount": 4 },
                "reviewThreads": { "totalCount": 3, "nodes": [
                    { "isResolved": false }, { "isResolved": true }, { "isResolved": false }
                ]},
                "commits": { "totalCount": 7, "nodes": [{ "commit": { "statusCheckRollup": { "contexts": { "nodes": [
                    { "__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SUCCESS" },
                    { "__typename": "CheckRun", "status": "COMPLETED", "conclusion": "FAILURE" },
                    { "__typename": "CheckRun", "status": "COMPLETED", "conclusion": "TIMED_OUT" },
                    { "__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SKIPPED" },
                    { "__typename": "CheckRun", "status": "IN_PROGRESS", "conclusion": null },
                    { "__typename": "StatusContext", "state": "SUCCESS" },
                    { "__typename": "StatusContext", "state": "ERROR" },
                    { "__typename": "StatusContext", "state": "PENDING" }
                ]}}}}]}
            }
        }}}"#;
        let pr = parse_readiness(out, "").unwrap();
        assert_eq!(pr.repo, "o/r");
        assert_eq!(pr.number, 12);
        assert_eq!(pr.head_ref_name, "ticket-5");
        assert!(pr.head_branch_exists);
        assert_eq!((pr.additions, pr.deletions, pr.changed_files, pr.commits), (120, 30, 3, 7));
        assert_eq!(pr.merge_state_status, "BLOCKED");
        assert_eq!(pr.review_decision, None);
        assert_eq!(pr.checks, PullRequestCheckCounts { failing: 3, pending: 2, skipped: 1, passing: 2 });
        assert_eq!(pr.comments, PullRequestCommentCounts { total: 7, unresolved: 2 });
    }

    #[test]
    fn parse_readiness_sees_a_deleted_branch_and_no_checks() {
        let out = serde_json::json!({ "data": { "repository": { "nameWithOwner": "o/r", "pullRequest": {
            "number": 3, "state": "MERGED", "headRef": null,
            "commits": { "totalCount": 1, "nodes": [{ "commit": { "statusCheckRollup": null } }] }
        }}}});
        let pr = parse_readiness(out.to_string().as_bytes(), "").unwrap();
        assert!(!pr.head_branch_exists);
        assert_eq!(pr.checks, PullRequestCheckCounts::default());
        assert_eq!(pr.mergeable, "UNKNOWN");
    }

    #[test]
    fn parse_readiness_returns_github_s_error() {
        let out = br#"{ "data": { "repository": { "pullRequest": null } }, "errors": [{ "message": "Could not resolve to a PullRequest with the number of 99." }] }"#;
        assert_eq!(parse_readiness(out, "").unwrap_err(), "Could not resolve to a PullRequest with the number of 99.");
        assert_eq!(parse_readiness(b"", "HTTP 401: Bad credentials").unwrap_err(), "HTTP 401: Bad credentials");
    }
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
    fn merge_methods_are_merge_squash_and_rebase_only() {
        assert_eq!(merge_method("merge"), Ok("merge"));
        assert_eq!(merge_method("squash"), Ok("squash"));
        assert_eq!(merge_method("rebase"), Ok("rebase"));
        assert!(merge_method("fast-forward").is_err());
    }

    #[test]
    fn branch_names_are_checked_and_escaped_for_the_refs_path() {
        assert_eq!(branch_ref_path("feat/issue-5").unwrap(), "feat/issue-5");
        assert_eq!(branch_ref_path("fix#1%").unwrap(), "fix%231%25");
        for bad in ["", "-x", "/x", "x/", "a..b", "a b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b", "x.lock", "a\u{7}b"] {
            assert!(branch_ref_path(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn head_shas_are_hex_object_ids() {
        assert!(check_sha("0123456789abcdef0123456789abcdef01234567").is_ok());
        assert!(check_sha("0123456789ABCDEF0123456789abcdef01234567").is_ok());
        assert!(check_sha("abc").is_err());
        assert!(check_sha("0123456789abcdef0123456789abcdef0123456g").is_err());
    }

    #[test]
    fn merge_async_args_name_the_method_the_head_and_the_message() {
        let sha = "0123456789abcdef0123456789abcdef01234567";
        let args = merge_async_args(&RepoSlug::Folder, 12, "squash", Some("Add it (#12)"), Some("Closes #5"), sha);
        assert_eq!(
            args,
            [
                "api", "--method", "PUT", "repos/{owner}/{repo}/pulls/12/merge-async",
                "-f", "merge_method=squash", "-f", &format!("sha={sha}"),
                "-f", "commit_title=Add it (#12)", "-f", "commit_message=Closes #5",
            ]
        );
        let rebase = merge_async_args(&RepoSlug::Named("o".into(), "r".into()), 3, "rebase", Some("ignored"), Some("ignored"), sha);
        assert_eq!(rebase[3], "repos/o/r/pulls/3/merge-async");
        assert!(!rebase.iter().any(|a| a.starts_with("commit_")));
        let blank = merge_async_args(&RepoSlug::Folder, 3, "merge", Some("  "), None, sha);
        assert!(!blank.iter().any(|a| a.starts_with("commit_")));
    }

    #[test]
    fn waiting_for_the_merge_polls_until_github_reports_it_merged() {
        let mut answers = vec![Ok(PullState::Open), Ok(PullState::Open), Ok(PullState::Merged)].into_iter();
        let mut slept = Vec::new();
        let result = wait_for_merge(|| answers.next().unwrap(), |d| slept.push(d), 10);
        assert_eq!(result, Ok(()));
        assert_eq!(slept.len(), 2);
    }

    #[test]
    fn waiting_for_the_merge_fails_clearly_on_timeout_on_close_and_on_error() {
        let timeout = wait_for_merge(|| Ok(PullState::Open), |_| {}, 3).unwrap_err();
        assert!(timeout.contains("did not finish the merge"), "{timeout}");
        let closed = wait_for_merge(|| Ok(PullState::Closed), |_| {}, 3).unwrap_err();
        assert_eq!(closed, "The pull request was closed before it merged.");
        let error = wait_for_merge(|| Err("Bad credentials".to_string()), |_| {}, 3).unwrap_err();
        assert_eq!(error, "Bad credentials");
    }

    #[test]
    fn parse_pull_state_reads_merged_and_state() {
        assert_eq!(parse_pull_state(br#"{"state":"closed","merged":true}"#, ""), Ok(PullState::Merged));
        assert_eq!(parse_pull_state(br#"{"state":"closed","merged":false}"#, ""), Ok(PullState::Closed));
        assert_eq!(parse_pull_state(br#"{"state":"open","merged":false}"#, ""), Ok(PullState::Open));
        assert_eq!(parse_pull_state(br#"{"message":"Not Found"}"#, ""), Err("Not Found".to_string()));
    }
}
