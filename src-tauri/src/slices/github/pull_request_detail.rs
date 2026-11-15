//! What the pull request view's cells open: the head commit's checks and a failing check's log,
//! the comment timeline, the changed files and the commits; and commenting on and closing the
//! pull request. All through `gh api`, each call through `gh.rs` under its timeout.

use serde::Serialize;

use super::gh::{api_error, blocking, count, gh_api, pr_task, repo_slug, run_gh, text, RepoSlug};
use super::pull_request::{check_outcome, CheckOutcome};

/// Check runs and status contexts listed per pull request; more are left out.
const CHECKS_READ: u32 = 100;
/// Lines of a failing check's log kept, counted from its end, where the failure is.
const LOG_LINES: usize = 200;
/// Conversation comments and reviews read, the newest; older ones are left out.
const COMMENTS_READ: u32 = 100;
/// Review threads read, and comments read in each.
const THREADS_READ: u32 = 100;
const THREAD_COMMENTS_READ: u32 = 50;
/// Changed files and commits read, one page of GitHub's REST API.
const FILES_READ: u32 = 100;
const COMMITS_READ: u32 = 100;
/// The longest comment GitHub takes.
const COMMENT_MAX_CHARS: usize = 65_536;

fn opt_text(value: &serde_json::Value) -> Option<String> {
    value.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

fn author(value: &serde_json::Value) -> String {
    // GitHub reports a deleted account's comments with no author; its own page calls it ghost.
    opt_text(&value["login"]).unwrap_or_else(|| "ghost".to_string())
}

/// The pull request object in a GraphQL answer, or GitHub's error.
fn graphql_pull_request<'a>(json: &'a serde_json::Value, stdout: &[u8], stderr: &str) -> Result<&'a serde_json::Value, String> {
    let pr = &json["data"]["repository"]["pullRequest"];
    if pr.is_object() {
        Ok(pr)
    } else {
        Err(api_error(stdout, stderr, "GitHub returned no pull request"))
    }
}

fn graphql_args(slug: &RepoSlug, number: u32, query: String) -> Vec<String> {
    let mut args: Vec<String> = vec!["api".into(), "graphql".into()];
    args.extend(slug.graphql_fields());
    args.extend(["-F".to_string(), format!("number={number}"), "-f".to_string(), format!("query={query}")]);
    args
}

// ---------------------------------------------------------------------------------------------
// Checks

/// One check on the pull request's head commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCheck {
    /// The check run's id, which its log is read by; none for a commit status.
    pub check_run_id: Option<u64>,
    pub name: String,
    /// The Actions workflow that ran it, when one did.
    pub workflow: Option<String>,
    pub outcome: CheckOutcome,
    /// The check run's title or the status's description.
    pub description: Option<String>,
    pub url: Option<String>,
}

fn checks_query() -> String {
    format!(
        "query($owner: String!, $name: String!, $number: Int!) {{ repository(owner: $owner, name: $name) {{ pullRequest(number: $number) {{ \
commits(last: 1) {{ nodes {{ commit {{ statusCheckRollup {{ contexts(first: {CHECKS_READ}) {{ nodes {{ __typename \
... on CheckRun {{ databaseId name status conclusion title detailsUrl checkSuite {{ workflowRun {{ workflow {{ name }} }} }} }} \
... on StatusContext {{ context state description targetUrl }} }} }} }} }} }} }} }} }} }}"
    )
}

/// Reads the checks query's output.
fn parse_checks(stdout: &[u8], stderr: &str) -> Result<Vec<PullRequestCheck>, String> {
    let json = serde_json::from_slice::<serde_json::Value>(stdout).unwrap_or(serde_json::Value::Null);
    let pr = graphql_pull_request(&json, stdout, stderr)?;
    let nodes = pr["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["contexts"]["nodes"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    Ok(nodes
        .iter()
        .map(|node| {
            let status = node["__typename"] == "StatusContext";
            PullRequestCheck {
                check_run_id: if status { None } else { node["databaseId"].as_u64() },
                name: text(if status { &node["context"] } else { &node["name"] }),
                workflow: opt_text(&node["checkSuite"]["workflowRun"]["workflow"]["name"]),
                outcome: check_outcome(node),
                description: opt_text(if status { &node["description"] } else { &node["title"] }),
                url: opt_text(if status { &node["targetUrl"] } else { &node["detailsUrl"] }),
            }
        })
        .collect())
}

/// The checks on a pull request's head commit, for the Checks cell.
#[tauri::command]
pub async fn get_github_pr_checks(repo_path: String, repo: Option<String>, number: u32) -> Result<Vec<PullRequestCheck>, String> {
    pr_task(repo, number, move |slug, number| {
        let out = run_gh(&repo_path, &graphql_args(&slug, number, checks_query()))?;
        parse_checks(&out.stdout, &out.stderr)
    })
    .await
}

/// The end of a check's log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckLog {
    pub text: String,
    /// Whether lines before `text` were left out.
    pub truncated: bool,
}

/// The length of the timestamp GitHub Actions puts at the start of each log line, with the space
/// after it, or 0 when `line` has none.
fn timestamp_len(line: &str) -> usize {
    let bytes = line.as_bytes();
    let digits = |range: std::ops::Range<usize>| bytes.get(range).is_some_and(|b| b.iter().all(u8::is_ascii_digit));
    if !(digits(0..4) && bytes.get(4) == Some(&b'-') && digits(5..7) && bytes.get(7) == Some(&b'-') && digits(8..10) && bytes.get(10) == Some(&b'T')) {
        return 0;
    }
    match line.find("Z ") {
        Some(end) if end < 40 => end + 2,
        _ => 0,
    }
}

/// Drops terminal escape sequences (`ESC [ ... letter`), which a log viewer cannot draw.
fn strip_escapes(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// The last `LOG_LINES` lines of an Actions log, without each line's timestamp or escape codes.
fn clean_log(raw: &str) -> CheckLog {
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(LOG_LINES);
    let text = lines[start..]
        .iter()
        .map(|line| strip_escapes(&line[timestamp_len(line)..]))
        .collect::<Vec<_>>()
        .join("\n");
    CheckLog { text, truncated: start > 0 }
}

/// A check run's own output (title, summary and text), for a check that is not an Actions job.
fn parse_check_run_output(stdout: &[u8]) -> Option<String> {
    let json = serde_json::from_slice::<serde_json::Value>(stdout).ok()?;
    let output = &json["output"];
    let parts: Vec<String> = ["title", "summary", "text"].iter().filter_map(|k| opt_text(&output[*k])).collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

/// The end of a failing check's log: its Actions job log when it is one, else the check run's
/// own output.
#[tauri::command]
pub async fn get_github_check_log(repo_path: String, repo: Option<String>, check_run_id: u64) -> Result<CheckLog, String> {
    let slug = repo_slug(repo.as_deref())?;
    if check_run_id == 0 {
        return Err("Not a check run id: 0".to_string());
    }
    blocking(move || {
        // An Actions job's id is its check run's id. GitHub answers with a redirect to the log.
        let job = run_gh(&repo_path, &["api".into(), format!("{}/actions/jobs/{check_run_id}/logs", slug.path())])?;
        if job.success {
            return Ok(clean_log(&String::from_utf8_lossy(&job.stdout)));
        }
        let run = gh_api(&repo_path, &["api".into(), format!("{}/check-runs/{check_run_id}", slug.path())], "Reading the check")?;
        parse_check_run_output(&run)
            .map(|text| clean_log(&text))
            .ok_or_else(|| "GitHub keeps no log for this check.".to_string())
    })
    .await
}

// ---------------------------------------------------------------------------------------------
// Comments

/// What kind of timeline item a comment is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TimelineKind {
    /// A conversation comment.
    Comment,
    /// A review's summary: its verdict and its body.
    Review,
    /// A review thread on a line of a file.
    Thread,
}

/// A reply in a review thread.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineReply {
    pub id: String,
    pub author: String,
    pub created_at: String,
    pub body: String,
}

/// One item in the pull request's comment timeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineItem {
    pub id: String,
    pub kind: TimelineKind,
    pub author: String,
    /// GitHub's ISO 8601 UTC timestamp.
    pub created_at: String,
    pub body: String,
    pub url: Option<String>,
    /// A review's verdict: APPROVED, CHANGES_REQUESTED, COMMENTED or DISMISSED.
    pub review_state: Option<String>,
    /// A thread's file.
    pub path: Option<String>,
    /// Whether a thread is resolved; none for other items.
    pub resolved: Option<bool>,
    /// A thread's replies after its first comment, oldest first.
    pub replies: Vec<TimelineReply>,
}

/// The pull request's comment timeline, oldest first, and who is looking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestTimeline {
    /// The signed-in GitHub login, which the Mine filter matches.
    pub viewer: String,
    pub items: Vec<TimelineItem>,
    /// Whether GitHub holds more comments, reviews or threads than were read.
    pub truncated: bool,
}

fn timeline_query() -> String {
    format!(
        "query($owner: String!, $name: String!, $number: Int!) {{ viewer {{ login }} repository(owner: $owner, name: $name) {{ pullRequest(number: $number) {{ \
comments(last: {COMMENTS_READ}) {{ totalCount nodes {{ id author {{ login }} createdAt body url }} }} \
reviews(last: {COMMENTS_READ}) {{ totalCount nodes {{ id author {{ login }} createdAt submittedAt body state url }} }} \
reviewThreads(first: {THREADS_READ}) {{ totalCount nodes {{ id isResolved path comments(first: {THREAD_COMMENTS_READ}) {{ totalCount nodes {{ id author {{ login }} createdAt body url }} }} }} }} \
}} }} }}"
    )
}

fn nodes(value: &serde_json::Value) -> &[serde_json::Value] {
    value["nodes"].as_array().map(Vec::as_slice).unwrap_or_default()
}

fn more_than_read(value: &serde_json::Value) -> bool {
    count(&value["totalCount"]) as usize > nodes(value).len()
}

/// Reads the timeline query's output. A review shows when it has a body or a verdict; a review
/// that only carries line comments shows through its threads, and the viewer's own pending
/// review is left out.
fn parse_timeline(stdout: &[u8], stderr: &str) -> Result<PullRequestTimeline, String> {
    let json = serde_json::from_slice::<serde_json::Value>(stdout).unwrap_or(serde_json::Value::Null);
    let pr = graphql_pull_request(&json, stdout, stderr)?;
    let mut items = Vec::new();
    for c in nodes(&pr["comments"]) {
        items.push(TimelineItem {
            id: text(&c["id"]),
            kind: TimelineKind::Comment,
            author: author(&c["author"]),
            created_at: text(&c["createdAt"]),
            body: text(&c["body"]),
            url: opt_text(&c["url"]),
            review_state: None,
            path: None,
            resolved: None,
            replies: Vec::new(),
        });
    }
    for r in nodes(&pr["reviews"]) {
        let state = text(&r["state"]);
        let body = text(&r["body"]);
        let verdict = matches!(state.as_str(), "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED");
        if state == "PENDING" || (!verdict && body.trim().is_empty()) {
            continue;
        }
        items.push(TimelineItem {
            id: text(&r["id"]),
            kind: TimelineKind::Review,
            author: author(&r["author"]),
            created_at: opt_text(&r["submittedAt"]).unwrap_or_else(|| text(&r["createdAt"])),
            body,
            url: opt_text(&r["url"]),
            review_state: Some(state),
            path: None,
            resolved: None,
            replies: Vec::new(),
        });
    }
    let mut threads_truncated = false;
    for t in nodes(&pr["reviewThreads"]) {
        threads_truncated |= more_than_read(&t["comments"]);
        let comments = nodes(&t["comments"]);
        let Some((first, rest)) = comments.split_first() else { continue };
        items.push(TimelineItem {
            id: text(&t["id"]),
            kind: TimelineKind::Thread,
            author: author(&first["author"]),
            created_at: text(&first["createdAt"]),
            body: text(&first["body"]),
            url: opt_text(&first["url"]),
            review_state: None,
            path: opt_text(&t["path"]),
            resolved: Some(t["isResolved"].as_bool().unwrap_or(false)),
            replies: rest
                .iter()
                .map(|c| TimelineReply {
                    id: text(&c["id"]),
                    author: author(&c["author"]),
                    created_at: text(&c["createdAt"]),
                    body: text(&c["body"]),
                })
                .collect(),
        });
    }
    // GitHub's timestamps are all UTC in one fixed format, so they sort as text.
    items.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(PullRequestTimeline {
        viewer: text(&json["data"]["viewer"]["login"]),
        items,
        truncated: threads_truncated || more_than_read(&pr["comments"]) || more_than_read(&pr["reviews"]) || more_than_read(&pr["reviewThreads"]),
    })
}

/// The pull request's comment timeline, for the Comments cell and the Files picker's marks.
#[tauri::command]
pub async fn get_github_pr_timeline(repo_path: String, repo: Option<String>, number: u32) -> Result<PullRequestTimeline, String> {
    pr_task(repo, number, move |slug, number| {
        let out = run_gh(&repo_path, &graphql_args(&slug, number, timeline_query()))?;
        parse_timeline(&out.stdout, &out.stderr)
    })
    .await
}

/// Checks a comment is something GitHub takes: not blank, and no longer than its limit.
fn comment_body(body: &str) -> Result<&str, String> {
    if body.trim().is_empty() {
        Err("A comment needs some text.".to_string())
    } else if body.chars().count() > COMMENT_MAX_CHARS {
        Err(format!("A comment can be at most {COMMENT_MAX_CHARS} characters."))
    } else {
        Ok(body)
    }
}

fn comment_args(slug: &RepoSlug, number: u32, body: &str) -> Vec<String> {
    // `-f` sends the body as a raw string, so a leading `@` is never read as a file name.
    vec![
        "api".into(),
        "--method".into(),
        "POST".into(),
        format!("{}/issues/{number}/comments", slug.path()),
        "-f".into(),
        format!("body={body}"),
    ]
}

/// Adds a conversation comment to a pull request.
#[tauri::command]
pub async fn comment_on_github_pr(repo_path: String, repo: Option<String>, number: u32, body: String) -> Result<(), String> {
    comment_body(&body)?;
    pr_task(repo, number, move |slug, number| gh_api(&repo_path, &comment_args(&slug, number, &body), "Comment").map(|_| ()))
        .await
}

/// Closes a pull request without merging it.
#[tauri::command]
pub async fn close_github_pr(repo_path: String, repo: Option<String>, number: u32) -> Result<(), String> {
    pr_task(repo, number, move |slug, number| {
        let args: Vec<String> = vec![
            "api".into(),
            "--method".into(),
            "PATCH".into(),
            format!("{}/pulls/{number}", slug.path()),
            "-f".into(),
            "state=closed".into(),
        ];
        gh_api(&repo_path, &args, "Close").map(|_| ())
    })
    .await
}

// ---------------------------------------------------------------------------------------------
// Files and commits

/// One file the pull request changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestFile {
    pub path: String,
    /// The path before a rename.
    pub previous_path: Option<String>,
    /// GitHub's file status: added, removed, modified, renamed, copied, changed or unchanged.
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    /// The unified diff hunks; none for a binary file or one too large for GitHub to show.
    pub patch: Option<String>,
}

fn rest_array<'a>(json: &'a serde_json::Value, stdout: &[u8], stderr: &str, what: &str) -> Result<&'a [serde_json::Value], String> {
    json.as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| api_error(stdout, stderr, &format!("GitHub returned no {what}")))
}

fn parse_files(stdout: &[u8], stderr: &str) -> Result<Vec<PullRequestFile>, String> {
    let json = serde_json::from_slice::<serde_json::Value>(stdout).unwrap_or(serde_json::Value::Null);
    Ok(rest_array(&json, stdout, stderr, "files")?
        .iter()
        .map(|f| PullRequestFile {
            path: text(&f["filename"]),
            previous_path: opt_text(&f["previous_filename"]),
            status: text(&f["status"]),
            additions: count(&f["additions"]),
            deletions: count(&f["deletions"]),
            patch: opt_text(&f["patch"]),
        })
        .collect())
}

/// The first page of files a pull request changes, for the Files cell.
#[tauri::command]
pub async fn get_github_pr_files(repo_path: String, repo: Option<String>, number: u32) -> Result<Vec<PullRequestFile>, String> {
    pr_task(repo, number, move |slug, number| {
        let out = run_gh(&repo_path, &["api".into(), format!("{}/pulls/{number}/files?per_page={FILES_READ}", slug.path())])?;
        parse_files(&out.stdout, &out.stderr)
    })
    .await
}

/// One commit on the pull request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCommit {
    pub sha: String,
    /// The first line of the commit message.
    pub headline: String,
    /// The GitHub login of the author, else the name in the commit.
    pub author: String,
    /// GitHub's ISO 8601 UTC timestamp of the authoring.
    pub authored_at: String,
    pub url: Option<String>,
}

fn parse_commits(stdout: &[u8], stderr: &str) -> Result<Vec<PullRequestCommit>, String> {
    let json = serde_json::from_slice::<serde_json::Value>(stdout).unwrap_or(serde_json::Value::Null);
    Ok(rest_array(&json, stdout, stderr, "commits")?
        .iter()
        .map(|c| PullRequestCommit {
            sha: text(&c["sha"]),
            headline: c["commit"]["message"].as_str().unwrap_or_default().lines().next().unwrap_or_default().to_string(),
            author: opt_text(&c["author"]["login"]).unwrap_or_else(|| text(&c["commit"]["author"]["name"])),
            authored_at: text(&c["commit"]["author"]["date"]),
            url: opt_text(&c["html_url"]),
        })
        .collect())
}

/// The first page of a pull request's commits, oldest first, for the Commits cell.
#[tauri::command]
pub async fn get_github_pr_commits(repo_path: String, repo: Option<String>, number: u32) -> Result<Vec<PullRequestCommit>, String> {
    pr_task(repo, number, move |slug, number| {
        let out = run_gh(&repo_path, &["api".into(), format!("{}/pulls/{number}/commits?per_page={COMMITS_READ}", slug.path())])?;
        parse_commits(&out.stdout, &out.stderr)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_checks_lists_check_runs_and_statuses_with_their_outcome() {
        let out = br#"{ "data": { "repository": { "pullRequest": { "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "contexts": { "nodes": [
            { "__typename": "CheckRun", "databaseId": 991, "name": "test", "status": "COMPLETED", "conclusion": "FAILURE",
              "title": "2 tests failed", "detailsUrl": "https://github.com/o/r/actions/runs/1/job/991",
              "checkSuite": { "workflowRun": { "workflow": { "name": "CI" } } } },
            { "__typename": "CheckRun", "databaseId": 992, "name": "lint", "status": "IN_PROGRESS", "conclusion": null,
              "title": null, "detailsUrl": null, "checkSuite": { "workflowRun": null } },
            { "__typename": "StatusContext", "context": "deploy/preview", "state": "SUCCESS",
              "description": "Preview ready", "targetUrl": "https://example.com/p" }
        ]}}}}]}}}}}"#;
        let checks = parse_checks(out, "").unwrap();
        assert_eq!(
            checks,
            vec![
                PullRequestCheck {
                    check_run_id: Some(991),
                    name: "test".into(),
                    workflow: Some("CI".into()),
                    outcome: CheckOutcome::Failing,
                    description: Some("2 tests failed".into()),
                    url: Some("https://github.com/o/r/actions/runs/1/job/991".into()),
                },
                PullRequestCheck {
                    check_run_id: Some(992),
                    name: "lint".into(),
                    workflow: None,
                    outcome: CheckOutcome::Pending,
                    description: None,
                    url: None,
                },
                PullRequestCheck {
                    check_run_id: None,
                    name: "deploy/preview".into(),
                    workflow: None,
                    outcome: CheckOutcome::Passing,
                    description: Some("Preview ready".into()),
                    url: Some("https://example.com/p".into()),
                },
            ]
        );
        assert_eq!(serde_json::to_value(CheckOutcome::Failing).unwrap(), "failing");
    }

    #[test]
    fn parse_checks_reads_no_checks_and_returns_github_s_error() {
        let none = br#"{ "data": { "repository": { "pullRequest": { "commits": { "nodes": [{ "commit": { "statusCheckRollup": null } }] } } } } }"#;
        assert_eq!(parse_checks(none, "").unwrap(), vec![]);
        let err = br#"{ "data": { "repository": { "pullRequest": null } }, "errors": [{ "message": "Not found" }] }"#;
        assert_eq!(parse_checks(err, "").unwrap_err(), "Not found");
    }

    #[test]
    fn clean_log_keeps_the_end_without_timestamps_or_escape_codes() {
        let raw = "\u{feff}2026-11-15T10:00:00.1234567Z ##[group]Run tests\n2026-11-15T10:00:01.0000000Z \u{1b}[31merror\u{1b}[0m: 2 failed\nplain line";
        assert_eq!(clean_log(raw), CheckLog { text: "##[group]Run tests\nerror: 2 failed\nplain line".into(), truncated: false });
        let long: String = (0..LOG_LINES + 5).map(|i| format!("line {i}\n")).collect();
        let log = clean_log(&long);
        assert!(log.truncated);
        assert_eq!(log.text.lines().count(), LOG_LINES);
        assert_eq!(log.text.lines().next(), Some("line 5"));
        assert_eq!(log.text.lines().last(), Some(format!("line {}", LOG_LINES + 4).as_str()));
    }

    #[test]
    fn a_check_run_s_own_output_stands_in_for_a_log() {
        let out = br#"{ "output": { "title": "Lint failed", "summary": "3 problems", "text": null } }"#;
        assert_eq!(parse_check_run_output(out), Some("Lint failed\n\n3 problems".into()));
        assert_eq!(parse_check_run_output(br#"{ "output": { "title": null } }"#), None);
    }

    #[test]
    fn parse_timeline_merges_comments_reviews_and_threads_oldest_first() {
        let out = br#"{ "data": { "viewer": { "login": "me" }, "repository": { "pullRequest": {
            "comments": { "totalCount": 2, "nodes": [
                { "id": "C1", "author": { "login": "ann" }, "createdAt": "2026-11-01T10:00:00Z", "body": "First", "url": "u1" },
                { "id": "C2", "author": null, "createdAt": "2026-11-03T10:00:00Z", "body": "Gone", "url": "u2" }
            ]},
            "reviews": { "totalCount": 4, "nodes": [
                { "id": "R1", "author": { "login": "bob" }, "createdAt": "2026-11-02T09:00:00Z", "submittedAt": "2026-11-02T10:00:00Z", "body": "", "state": "CHANGES_REQUESTED", "url": "r1" },
                { "id": "R2", "author": { "login": "bob" }, "createdAt": "2026-11-02T11:00:00Z", "submittedAt": "2026-11-02T11:00:00Z", "body": "", "state": "COMMENTED", "url": "r2" },
                { "id": "R3", "author": { "login": "me" }, "createdAt": "2026-11-04T11:00:00Z", "submittedAt": null, "body": "draft", "state": "PENDING", "url": "r3" },
                { "id": "R4", "author": { "login": "me" }, "createdAt": "2026-11-05T11:00:00Z", "submittedAt": "2026-11-05T11:00:00Z", "body": "Looks fine", "state": "COMMENTED", "url": "r4" }
            ]},
            "reviewThreads": { "totalCount": 2, "nodes": [
                { "id": "T1", "isResolved": false, "path": "src/a.ts", "comments": { "totalCount": 2, "nodes": [
                    { "id": "TC1", "author": { "login": "bob" }, "createdAt": "2026-11-02T10:30:00Z", "body": "Why?", "url": "t1" },
                    { "id": "TC2", "author": { "login": "me" }, "createdAt": "2026-11-02T12:00:00Z", "body": "Because", "url": "t2" }
                ]}},
                { "id": "T2", "isResolved": true, "path": "src/b.ts", "comments": { "totalCount": 0, "nodes": [] } }
            ]}
        }}}}"#;
        let timeline = parse_timeline(out, "").unwrap();
        assert_eq!(timeline.viewer, "me");
        assert!(!timeline.truncated);
        let summary: Vec<(&str, TimelineKind, &str)> =
            timeline.items.iter().map(|i| (i.id.as_str(), i.kind, i.author.as_str())).collect();
        assert_eq!(
            summary,
            vec![
                ("C1", TimelineKind::Comment, "ann"),
                ("R1", TimelineKind::Review, "bob"),
                ("T1", TimelineKind::Thread, "bob"),
                ("C2", TimelineKind::Comment, "ghost"),
                ("R4", TimelineKind::Review, "me"),
            ]
        );
        let thread = &timeline.items[2];
        assert_eq!(thread.path.as_deref(), Some("src/a.ts"));
        assert_eq!(thread.resolved, Some(false));
        assert_eq!(thread.body, "Why?");
        assert_eq!(thread.replies, vec![TimelineReply { id: "TC2".into(), author: "me".into(), created_at: "2026-11-02T12:00:00Z".into(), body: "Because".into() }]);
        assert_eq!(timeline.items[1].review_state.as_deref(), Some("CHANGES_REQUESTED"));
        assert_eq!(timeline.items[1].created_at, "2026-11-02T10:00:00Z");
    }

    #[test]
    fn parse_timeline_says_when_github_holds_more_than_was_read() {
        let out = br#"{ "data": { "viewer": { "login": "me" }, "repository": { "pullRequest": {
            "comments": { "totalCount": 250, "nodes": [] }, "reviews": { "totalCount": 0, "nodes": [] }, "reviewThreads": { "totalCount": 0, "nodes": [] }
        }}}}"#;
        assert!(parse_timeline(out, "").unwrap().truncated);
    }

    #[test]
    fn a_comment_is_sent_as_a_raw_body_and_must_have_text() {
        assert_eq!(
            comment_args(&RepoSlug::Named("o".into(), "r".into()), 12, "@file looks good"),
            ["api", "--method", "POST", "repos/o/r/issues/12/comments", "-f", "body=@file looks good"]
        );
        assert!(comment_body("  \n").is_err());
        assert!(comment_body(&"x".repeat(COMMENT_MAX_CHARS + 1)).is_err());
        assert_eq!(comment_body("Thanks"), Ok("Thanks"));
    }

    #[test]
    fn parse_files_reads_each_file_s_change_and_patch() {
        let out = br#"[
            { "filename": "src/a.ts", "status": "modified", "additions": 3, "deletions": 1, "patch": "@@ -1 +1,3 @@\n-a\n+b" },
            { "filename": "img/new.png", "previous_filename": "img/old.png", "status": "renamed", "additions": 0, "deletions": 0 }
        ]"#;
        let files = parse_files(out, "").unwrap();
        assert_eq!(files[0], PullRequestFile { path: "src/a.ts".into(), previous_path: None, status: "modified".into(), additions: 3, deletions: 1, patch: Some("@@ -1 +1,3 @@\n-a\n+b".into()) });
        assert_eq!(files[1].previous_path.as_deref(), Some("img/old.png"));
        assert_eq!(files[1].patch, None);
        assert_eq!(parse_files(br#"{ "message": "Not Found" }"#, "").unwrap_err(), "Not Found");
    }

    #[test]
    fn parse_commits_reads_headline_author_and_date() {
        let out = br#"[
            { "sha": "abc123", "html_url": "https://github.com/o/r/commit/abc123", "author": { "login": "ann" },
              "commit": { "message": "Add the thing\n\nLonger body", "author": { "name": "Ann A", "date": "2026-11-01T10:00:00Z" } } },
            { "sha": "def456", "html_url": null, "author": null,
              "commit": { "message": "Fix it", "author": { "name": "Someone", "date": "2026-11-02T10:00:00Z" } } }
        ]"#;
        let commits = parse_commits(out, "").unwrap();
        assert_eq!(commits[0], PullRequestCommit { sha: "abc123".into(), headline: "Add the thing".into(), author: "ann".into(), authored_at: "2026-11-01T10:00:00Z".into(), url: Some("https://github.com/o/r/commit/abc123".into()) });
        assert_eq!((commits[1].author.as_str(), commits[1].url.as_deref()), ("Someone", None));
    }
}
