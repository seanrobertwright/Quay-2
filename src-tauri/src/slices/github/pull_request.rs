//! The companion's pull request view: one pull request's readiness, and merging, deleting and
//! restoring its branch, and reopening it, all through `gh api`.

use serde::Serialize;

use super::gh::{api_error, blocking, count, gh_api, pr_task, repo_slug, run_gh, text, RepoSlug};

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

/// How one check run or status context turned out, as GitHub's pull request page groups them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckOutcome {
    /// Failed, timed out, cancelled, or waiting on an action.
    Failing,
    /// Queued or running.
    Pending,
    /// Skipped, neutral or stale.
    Skipped,
    Passing,
}

/// The outcome of one `statusCheckRollup` context: a `CheckRun` or a `StatusContext`.
pub(super) fn check_outcome(node: &serde_json::Value) -> CheckOutcome {
    if node["__typename"] == "StatusContext" {
        match node["state"].as_str().unwrap_or_default() {
            "SUCCESS" => CheckOutcome::Passing,
            "FAILURE" | "ERROR" => CheckOutcome::Failing,
            _ => CheckOutcome::Pending,
        }
    } else if node["status"].as_str() != Some("COMPLETED") {
        CheckOutcome::Pending
    } else {
        match node["conclusion"].as_str().unwrap_or_default() {
            "SUCCESS" => CheckOutcome::Passing,
            "SKIPPED" | "NEUTRAL" | "STALE" => CheckOutcome::Skipped,
            _ => CheckOutcome::Failing,
        }
    }
}

/// Counts check runs and status contexts by outcome.
fn count_checks(nodes: &[serde_json::Value]) -> PullRequestCheckCounts {
    let mut counts = PullRequestCheckCounts::default();
    for node in nodes {
        let bucket = match check_outcome(node) {
            CheckOutcome::Failing => &mut counts.failing,
            CheckOutcome::Pending => &mut counts.pending,
            CheckOutcome::Skipped => &mut counts.skipped,
            CheckOutcome::Passing => &mut counts.passing,
        };
        *bucket += 1;
    }
    counts
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

/// A merge method GitHub's merge API takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MergeMethod {
    Merge,
    Squash,
    Rebase,
}

impl MergeMethod {
    /// Parses the method the frontend sent.
    fn parse(method: &str) -> Result<Self, String> {
        match method {
            "merge" => Ok(MergeMethod::Merge),
            "squash" => Ok(MergeMethod::Squash),
            "rebase" => Ok(MergeMethod::Rebase),
            other => Err(format!("Not a merge method (merge, squash or rebase): {other:?}")),
        }
    }

    /// The `merge_method` value GitHub's merge API takes.
    fn as_str(self) -> &'static str {
        match self {
            MergeMethod::Merge => "merge",
            MergeMethod::Squash => "squash",
            MergeMethod::Rebase => "rebase",
        }
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
    method: MergeMethod,
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
        format!("merge_method={}", method.as_str()),
        "-f".into(),
        format!("sha={sha}"),
    ];
    if method != MergeMethod::Rebase {
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

/// One pull request's header and readiness, for the companion's pull request view. `repo` is the
/// pull request slot's `owner/name`, or none for the repository at `repo_path`.
#[tauri::command]
pub async fn get_github_pr_readiness(
    repo_path: String,
    repo: Option<String>,
    number: u32,
) -> Result<PullRequestReadiness, String> {
    pr_task(repo, number, move |slug, number| {
        let mut args: Vec<String> = vec!["api".into(), "graphql".into()];
        args.extend(slug.graphql_fields());
        args.extend(["-F".to_string(), format!("number={number}"), "-f".to_string(), format!("query={}", readiness_query())]);
        // A GraphQL error exits non-zero but still prints `errors`, which the parser reports.
        let out = run_gh(&repo_path, &args)?;
        parse_readiness(&out.stdout, &out.stderr)
    })
    .await
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
/// `GH_TIMEOUT`, and the wait gives up after `MERGE_POLL_ATTEMPTS` polls `MERGE_POLL_INTERVAL` apart with
/// an error that says the merge may still land.
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
    let method = MergeMethod::parse(&method)?;
    check_sha(&head_sha)?;
    let branch_path = if delete_branch { Some(branch_ref_path(&head_branch)?) } else { None };
    pr_task(repo, number, move |slug, number| {
        let args = merge_async_args(&slug, number, method, commit_title.as_deref(), commit_message.as_deref(), &head_sha);
        gh_api(&repo_path, &args, "Merge")?;
        let pull = [String::from("api"), format!("{}/pulls/{number}", slug.path())];
        wait_for_merge(
            || {
                let out = run_gh(&repo_path, &pull)?;
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
}

fn delete_args(slug: &RepoSlug, branch_path: &str) -> Vec<String> {
    vec!["api".into(), "--method".into(), "DELETE".into(), format!("{}/git/refs/heads/{branch_path}", slug.path())]
}

/// Deletes a pull request's head branch on GitHub.
#[tauri::command]
pub async fn delete_github_branch(repo_path: String, repo: Option<String>, branch: String) -> Result<(), String> {
    let slug = repo_slug(repo.as_deref())?;
    let branch_path = branch_ref_path(&branch)?;
    blocking(move || gh_api(&repo_path, &delete_args(&slug, &branch_path), "Delete branch").map(|_| ()))
        .await
}

/// Puts a deleted head branch back on GitHub at `sha`, the pull request's last head commit.
#[tauri::command]
pub async fn restore_github_branch(repo_path: String, repo: Option<String>, branch: String, sha: String) -> Result<(), String> {
    let slug = repo_slug(repo.as_deref())?;
    branch_ref_path(&branch)?;
    check_sha(&sha)?;
    blocking(move || {
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
}

/// Reopens a closed pull request.
#[tauri::command]
pub async fn reopen_github_pr(repo_path: String, repo: Option<String>, number: u32) -> Result<(), String> {
    pr_task(repo, number, move |slug, number| {
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
    fn merge_methods_are_merge_squash_and_rebase_only() {
        for (sent, method) in [("merge", MergeMethod::Merge), ("squash", MergeMethod::Squash), ("rebase", MergeMethod::Rebase)] {
            assert_eq!(MergeMethod::parse(sent), Ok(method));
            assert_eq!(method.as_str(), sent);
        }
        assert!(MergeMethod::parse("fast-forward").is_err());
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
        let args = merge_async_args(&RepoSlug::Folder, 12, MergeMethod::Squash, Some("Add it (#12)"), Some("Closes #5"), sha);
        assert_eq!(
            args,
            [
                "api", "--method", "PUT", "repos/{owner}/{repo}/pulls/12/merge-async",
                "-f", "merge_method=squash", "-f", &format!("sha={sha}"),
                "-f", "commit_title=Add it (#12)", "-f", "commit_message=Closes #5",
            ]
        );
        let rebase = merge_async_args(&RepoSlug::Named("o".into(), "r".into()), 3, MergeMethod::Rebase, Some("ignored"), Some("ignored"), sha);
        assert_eq!(rebase[3], "repos/o/r/pulls/3/merge-async");
        assert!(!rebase.iter().any(|a| a.starts_with("commit_")));
        let blank = merge_async_args(&RepoSlug::Folder, 3, MergeMethod::Merge, Some("  "), None, sha);
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
