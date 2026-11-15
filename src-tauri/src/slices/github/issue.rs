//! The companion's Ticket view: one ticket's status, and commenting on it, closing it with a
//! reason, reopening it, and editing its assignees, labels and type, all through `gh api`.

use serde::Serialize;

use super::gh::{api_error, blocking, count, gh_api, pr_task, repo_slug, run_gh, text, RepoSlug};
use super::models::GithubLabel;
use super::pull_request_detail::{comment_args, comment_body};

/// Assignees read per ticket; GitHub allows ten, so this reads them all.
const ASSIGNEES_READ: u32 = 20;
/// Labels read per ticket.
const LABELS_READ: u32 = 50;
/// Blockers read per ticket; `issueDependenciesSummary` still counts every open one.
const BLOCKERS_READ: u32 = 20;
/// Pull requests read from the ticket's Development section.
const PULL_REQUESTS_READ: u32 = 10;
/// The most recent conversation comments read per ticket; `commentCount` counts them all.
const COMMENTS_READ: u32 = 50;
/// Assignable users and labels offered by the Edit pickers.
const CHOICES_READ: u32 = 100;
/// Issue types offered by the Type picker.
const TYPES_READ: u32 = 25;

/// Another ticket the Ticket view names: a blocker or the parent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IssueRef {
    pub repo: String,
    pub number: u32,
    pub title: String,
    pub state: String,
    pub url: String,
}

/// A pull request that will close the ticket, with its head commit's check rollup state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuePullRequest {
    pub repo: String,
    pub number: u32,
    pub title: String,
    pub state: String,
    pub url: String,
    pub check_state: Option<String>,
}

/// One conversation comment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueComment {
    pub id: String,
    pub author: String,
    pub created_at: String,
    pub body: String,
    pub url: String,
}

/// A milestone's title and page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IssueMilestone {
    pub title: String,
    pub url: String,
}

/// What the companion's Ticket view reads about one ticket. Mirrors `IssueStatus` in the frontend.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueStatus {
    pub repo: String,
    pub number: u32,
    pub title: String,
    pub body: String,
    pub url: String,
    pub state: String,
    pub state_reason: Option<String>,
    pub issue_type: Option<String>,
    pub author: String,
    pub created_at: String,
    pub viewer: String,
    pub assignees: Vec<String>,
    pub labels: Vec<GithubLabel>,
    pub milestone: Option<IssueMilestone>,
    pub parent: Option<IssueRef>,
    pub blocked_by: Vec<IssueRef>,
    pub open_blocker_count: u32,
    pub pull_requests: Vec<IssuePullRequest>,
    pub comments: Vec<IssueComment>,
    pub comment_count: u32,
}

/// The query for one ticket's status. `$owner` and `$name` name its repository.
fn status_query() -> String {
    format!(
        "query($owner: String!, $name: String!, $number: Int!) {{ viewer {{ login }} repository(owner: $owner, name: $name) {{ nameWithOwner issue(number: $number) {{ \
number title body url state stateReason createdAt author {{ login }} issueType {{ name }} \
assignees(first: {ASSIGNEES_READ}) {{ nodes {{ login }} }} labels(first: {LABELS_READ}) {{ nodes {{ name color description }} }} \
milestone {{ title url }} parent {{ number title state url repository {{ nameWithOwner }} }} \
issueDependenciesSummary {{ blockedBy }} blockedBy(first: {BLOCKERS_READ}) {{ nodes {{ number title state url repository {{ nameWithOwner }} }} }} \
closedByPullRequestsReferences(first: {PULL_REQUESTS_READ}, includeClosedPrs: true) {{ nodes {{ number title state url repository {{ nameWithOwner }} \
commits(last: 1) {{ nodes {{ commit {{ statusCheckRollup {{ state }} }} }} }} }} }} \
comments(last: {COMMENTS_READ}) {{ totalCount nodes {{ id author {{ login }} body createdAt url }} }} }} }} }}"
    )
}

fn nodes(value: &serde_json::Value) -> &[serde_json::Value] {
    value["nodes"].as_array().map(Vec::as_slice).unwrap_or_default()
}

fn issue_ref(node: &serde_json::Value) -> IssueRef {
    IssueRef {
        repo: text(&node["repository"]["nameWithOwner"]),
        number: count(&node["number"]),
        title: text(&node["title"]),
        state: text(&node["state"]),
        url: text(&node["url"]),
    }
}

fn parse_label(node: &serde_json::Value) -> GithubLabel {
    GithubLabel {
        name: text(&node["name"]),
        color: text(&node["color"]),
        description: node["description"].as_str().map(str::to_string),
    }
}

/// A login, or `ghost` for a deleted account, as GitHub shows it.
fn login(user: &serde_json::Value) -> String {
    user["login"].as_str().unwrap_or("ghost").to_string()
}

/// Reads the status query's output.
fn parse_status(stdout: &[u8], stderr: &str) -> Result<IssueStatus, String> {
    let json = serde_json::from_slice::<serde_json::Value>(stdout).unwrap_or(serde_json::Value::Null);
    let repo = &json["data"]["repository"];
    let issue = &repo["issue"];
    if !issue.is_object() {
        return Err(api_error(stdout, stderr, "GitHub returned no issue"));
    }
    let blocked_by: Vec<IssueRef> = nodes(&issue["blockedBy"]).iter().map(issue_ref).collect();
    let open_listed = blocked_by.iter().filter(|b| b.state == "OPEN").count() as u32;
    Ok(IssueStatus {
        repo: text(&repo["nameWithOwner"]),
        number: count(&issue["number"]),
        title: text(&issue["title"]),
        body: text(&issue["body"]),
        url: text(&issue["url"]),
        state: text(&issue["state"]),
        state_reason: issue["stateReason"].as_str().map(str::to_string),
        issue_type: issue["issueType"]["name"].as_str().map(str::to_string),
        author: login(&issue["author"]),
        created_at: text(&issue["createdAt"]),
        viewer: text(&json["data"]["viewer"]["login"]),
        assignees: nodes(&issue["assignees"]).iter().map(login).collect(),
        labels: nodes(&issue["labels"])
            .iter()
            .map(parse_label)
            .collect(),
        milestone: issue["milestone"]
            .is_object()
            .then(|| IssueMilestone { title: text(&issue["milestone"]["title"]), url: text(&issue["milestone"]["url"]) }),
        parent: issue["parent"].is_object().then(|| issue_ref(&issue["parent"])),
        open_blocker_count: count(&issue["issueDependenciesSummary"]["blockedBy"]).max(open_listed),
        blocked_by,
        pull_requests: nodes(&issue["closedByPullRequestsReferences"])
            .iter()
            .map(|pr| IssuePullRequest {
                repo: text(&pr["repository"]["nameWithOwner"]),
                number: count(&pr["number"]),
                title: text(&pr["title"]),
                state: text(&pr["state"]),
                url: text(&pr["url"]),
                check_state: pr["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"].as_str().map(str::to_string),
            })
            .collect(),
        comments: nodes(&issue["comments"])
            .iter()
            .map(|c| IssueComment {
                id: text(&c["id"]),
                author: login(&c["author"]),
                created_at: text(&c["createdAt"]),
                body: text(&c["body"]),
                url: text(&c["url"]),
            })
            .collect(),
        comment_count: count(&issue["comments"]["totalCount"]),
    })
}

/// What the Edit pickers offer in a ticket's repository. Mirrors `IssueChoices` in the frontend.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IssueChoices {
    pub assignees: Vec<String>,
    pub labels: Vec<GithubLabel>,
    pub types: Vec<String>,
}

fn choices_query() -> String {
    format!(
        "query($owner: String!, $name: String!) {{ repository(owner: $owner, name: $name) {{ \
assignableUsers(first: {CHOICES_READ}) {{ nodes {{ login }} }} labels(first: {CHOICES_READ}) {{ nodes {{ name color description }} }} }} }}"
    )
}

fn types_query() -> String {
    format!("query($owner: String!, $name: String!) {{ repository(owner: $owner, name: $name) {{ issueTypes(first: {TYPES_READ}) {{ nodes {{ name }} }} }} }}")
}

/// Reads the choices query's output.
fn parse_choices(stdout: &[u8], stderr: &str) -> Result<IssueChoices, String> {
    let json = serde_json::from_slice::<serde_json::Value>(stdout).unwrap_or(serde_json::Value::Null);
    let repo = &json["data"]["repository"];
    if !repo.is_object() {
        return Err(api_error(stdout, stderr, "GitHub returned no repository"));
    }
    Ok(IssueChoices {
        assignees: nodes(&repo["assignableUsers"]).iter().map(login).collect(),
        labels: nodes(&repo["labels"])
            .iter()
            .map(parse_label)
            .collect(),
        types: Vec::new(),
    })
}

/// The issue type names in the types query's output; none where the repository has no issue types.
fn parse_types(stdout: &[u8]) -> Vec<String> {
    let json = serde_json::from_slice::<serde_json::Value>(stdout).unwrap_or(serde_json::Value::Null);
    nodes(&json["data"]["repository"]["issueTypes"]).iter().map(|t| text(&t["name"])).filter(|n| !n.is_empty()).collect()
}

/// A reason GitHub's REST API takes for closing an issue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CloseReason {
    Completed,
    NotPlanned,
    Duplicate,
}

impl CloseReason {
    /// Parses the reason the frontend sent, GitHub's GraphQL `stateReason` spelling.
    fn parse(reason: &str) -> Result<Self, String> {
        match reason {
            "COMPLETED" => Ok(CloseReason::Completed),
            "NOT_PLANNED" => Ok(CloseReason::NotPlanned),
            "DUPLICATE" => Ok(CloseReason::Duplicate),
            other => Err(format!("Not a close reason (COMPLETED, NOT_PLANNED or DUPLICATE): {other:?}")),
        }
    }

    /// The `state_reason` value the REST API takes.
    fn as_rest(self) -> &'static str {
        match self {
            CloseReason::Completed => "completed",
            CloseReason::NotPlanned => "not_planned",
            CloseReason::Duplicate => "duplicate",
        }
    }
}

/// `gh api --method <method> <path>`, then each `(flag, field, value)` as `<flag> field=value`.
fn api_args<'a>(method: &str, path: String, fields: impl IntoIterator<Item = (&'a str, &'a str, String)>) -> Vec<String> {
    let mut args: Vec<String> = vec!["api".into(), "--method".into(), method.into(), path];
    for (flag, field, value) in fields {
        args.push(flag.to_string());
        args.push(format!("{field}={value}"));
    }
    args
}

fn patch_issue_args(slug: &RepoSlug, number: u32, fields: &[(&str, &str, String)]) -> Vec<String> {
    api_args("PATCH", format!("{}/issues/{number}", slug.path()), fields.iter().map(|(f, k, v)| (*f, *k, v.clone())))
}

fn close_args(slug: &RepoSlug, number: u32, reason: CloseReason) -> Vec<String> {
    patch_issue_args(slug, number, &[("-f", "state", "closed".into()), ("-f", "state_reason", reason.as_rest().into())])
}

fn reopen_args(slug: &RepoSlug, number: u32) -> Vec<String> {
    patch_issue_args(slug, number, &[("-f", "state", "open".into()), ("-f", "state_reason", "reopened".into())])
}

/// Sets the ticket's type to `name`, or clears it with a JSON null (`-F` reads `null` as one).
fn type_args(slug: &RepoSlug, number: u32, name: Option<&str>) -> Vec<String> {
    match name {
        Some(name) => patch_issue_args(slug, number, &[("-f", "type", name.to_string())]),
        None => patch_issue_args(slug, number, &[("-F", "type", "null".into())]),
    }
}

/// Checks `login` is a GitHub login: letters, digits and single inner hyphens, at most 39 long.
fn check_login(login: &str) -> Result<(), String> {
    let ok = !login.is_empty()
        && login.len() <= 39
        && login.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !login.starts_with('-')
        && !login.ends_with('-')
        && !login.contains("--");
    if ok { Ok(()) } else { Err(format!("Not a GitHub login: {login:?}")) }
}

/// Checks `name` is a label or type name GitHub could hold: not blank, no control characters, at
/// most 100 characters.
fn check_name(name: &str, what: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) {
        Err(format!("Not a {what} name: {name:?}"))
    } else {
        Ok(())
    }
}

/// Adds (`POST`) or removes (`DELETE`) `logins` as the ticket's assignees.
fn assignee_args(slug: &RepoSlug, number: u32, method: &str, logins: &[String]) -> Vec<String> {
    let path = format!("{}/issues/{number}/assignees", slug.path());
    api_args(method, path, logins.iter().map(|login| ("-f", "assignees[]", login.clone())))
}

fn add_labels_args(slug: &RepoSlug, number: u32, labels: &[String]) -> Vec<String> {
    let path = format!("{}/issues/{number}/labels", slug.path());
    api_args("POST", path, labels.iter().map(|label| ("-f", "labels[]", label.clone())))
}

/// `text` percent-encoded for one URL path segment: everything but unreserved characters.
fn path_segment(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn remove_label_args(slug: &RepoSlug, number: u32, label: &str) -> Vec<String> {
    api_args("DELETE", format!("{}/issues/{number}/labels/{}", slug.path(), path_segment(label)), [])
}

/// One ticket's status, for the companion's Ticket view. `repo` is the ticket slot's `owner/name`,
/// or none for the repository at `repo_path`.
#[tauri::command]
pub async fn get_github_issue_status(repo_path: String, repo: Option<String>, number: u32) -> Result<IssueStatus, String> {
    pr_task(repo, number, move |slug, number| {
        let mut args: Vec<String> = vec!["api".into(), "graphql".into()];
        args.extend(slug.graphql_fields());
        args.extend(["-F".to_string(), format!("number={number}"), "-f".to_string(), format!("query={}", status_query())]);
        // A GraphQL error exits non-zero but still prints `errors`, which the parser reports.
        let out = run_gh(&repo_path, &args)?;
        parse_status(&out.stdout, &out.stderr)
    })
    .await
}

/// What the Ticket view's Edit pickers offer: the repository's assignable users, labels and issue
/// types. A repository without issue types offers none, rather than failing.
#[tauri::command]
pub async fn get_github_issue_choices(repo_path: String, repo: Option<String>) -> Result<IssueChoices, String> {
    let slug = repo_slug(repo.as_deref())?;
    blocking(move || {
        let query = |q: String| {
            let mut args: Vec<String> = vec!["api".into(), "graphql".into()];
            args.extend(slug.graphql_fields());
            args.extend(["-f".to_string(), format!("query={q}")]);
            run_gh(&repo_path, &args)
        };
        let out = query(choices_query())?;
        let mut choices = parse_choices(&out.stdout, &out.stderr)?;
        match query(types_query()) {
            Ok(types) => choices.types = parse_types(&types.stdout),
            Err(e) => tracing::warn!("gh api graphql (issueTypes) failed: {}", e),
        }
        Ok(choices)
    })
    .await
}

/// Adds a conversation comment to a ticket.
#[tauri::command]
pub async fn comment_on_github_issue(repo_path: String, repo: Option<String>, number: u32, body: String) -> Result<(), String> {
    comment_body(&body)?;
    pr_task(repo, number, move |slug, number| gh_api(&repo_path, &comment_args(&slug, number, &body), "Comment").map(|_| ()))
        .await
}

/// Closes a ticket as completed, not planned or duplicate, posting `comment` first when it has text.
#[tauri::command]
pub async fn close_github_issue(
    repo_path: String,
    repo: Option<String>,
    number: u32,
    reason: String,
    comment: Option<String>,
) -> Result<(), String> {
    let reason = CloseReason::parse(&reason)?;
    let comment = comment.filter(|c| !c.trim().is_empty());
    if let Some(body) = &comment {
        comment_body(body)?;
    }
    pr_task(repo, number, move |slug, number| {
        if let Some(body) = &comment {
            gh_api(&repo_path, &comment_args(&slug, number, body), "Comment")?;
        }
        gh_api(&repo_path, &close_args(&slug, number, reason), "Close").map(|_| ())
    })
    .await
}

/// Reopens a closed ticket.
#[tauri::command]
pub async fn reopen_github_issue(repo_path: String, repo: Option<String>, number: u32) -> Result<(), String> {
    pr_task(repo, number, move |slug, number| gh_api(&repo_path, &reopen_args(&slug, number), "Reopen").map(|_| ())).await
}

/// Adds the `add` logins to the ticket's assignees and removes the `remove` ones.
#[tauri::command]
pub async fn edit_github_issue_assignees(
    repo_path: String,
    repo: Option<String>,
    number: u32,
    add: Vec<String>,
    remove: Vec<String>,
) -> Result<(), String> {
    for login in add.iter().chain(&remove) {
        check_login(login)?;
    }
    pr_task(repo, number, move |slug, number| {
        if !add.is_empty() {
            gh_api(&repo_path, &assignee_args(&slug, number, "POST", &add), "Assign")?;
        }
        if !remove.is_empty() {
            gh_api(&repo_path, &assignee_args(&slug, number, "DELETE", &remove), "Unassign")?;
        }
        Ok(())
    })
    .await
}

/// Adds the `add` labels to the ticket and removes the `remove` ones.
#[tauri::command]
pub async fn edit_github_issue_labels(
    repo_path: String,
    repo: Option<String>,
    number: u32,
    add: Vec<String>,
    remove: Vec<String>,
) -> Result<(), String> {
    for name in add.iter().chain(&remove) {
        check_name(name, "label")?;
    }
    pr_task(repo, number, move |slug, number| {
        if !add.is_empty() {
            gh_api(&repo_path, &add_labels_args(&slug, number, &add), "Add labels")?;
        }
        for label in &remove {
            gh_api(&repo_path, &remove_label_args(&slug, number, label), "Remove label")?;
        }
        Ok(())
    })
    .await
}

/// Sets the ticket's issue type, or clears it when `issue_type` is none.
#[tauri::command]
pub async fn set_github_issue_type(repo_path: String, repo: Option<String>, number: u32, issue_type: Option<String>) -> Result<(), String> {
    if let Some(name) = &issue_type {
        check_name(name, "type")?;
    }
    pr_task(repo, number, move |slug, number| gh_api(&repo_path, &type_args(&slug, number, issue_type.as_deref()), "Set type").map(|_| ()))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_status_reads_the_header_card_and_details() {
        let out = br#"{ "data": { "viewer": { "login": "you" }, "repository": { "nameWithOwner": "o/r", "issue": {
            "number": 571, "title": "Run canvas: node phases", "body": "What to build", "url": "https://github.com/o/r/issues/571",
            "state": "OPEN", "stateReason": null, "createdAt": "2026-11-13T10:00:00Z",
            "author": { "login": "you" }, "issueType": { "name": "Feature" },
            "assignees": { "nodes": [{ "login": "claude" }] },
            "labels": { "nodes": [{ "name": "enhancement", "color": "a2eeef", "description": null }] },
            "milestone": { "title": "v1", "url": "https://github.com/o/r/milestone/1" },
            "parent": { "number": 560, "title": "Graph runs", "state": "OPEN", "url": "https://github.com/o/r/issues/560", "repository": { "nameWithOwner": "o/r" } },
            "issueDependenciesSummary": { "blockedBy": 3 },
            "blockedBy": { "nodes": [
                { "number": 569, "title": "Events", "state": "OPEN", "url": "https://github.com/o/r/issues/569", "repository": { "nameWithOwner": "o/r" } },
                { "number": 568, "title": "Old", "state": "CLOSED", "url": "https://github.com/o/r/issues/568", "repository": { "nameWithOwner": "o/s" } }
            ]},
            "closedByPullRequestsReferences": { "nodes": [
                { "number": 574, "title": "Node phases", "state": "OPEN", "url": "https://github.com/o/r/pull/574", "repository": { "nameWithOwner": "o/r" },
                  "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "state": "FAILURE" } } }] } },
                { "number": 570, "title": "Draft", "state": "CLOSED", "url": "https://github.com/o/r/pull/570", "repository": { "nameWithOwner": "o/r" },
                  "commits": { "nodes": [{ "commit": { "statusCheckRollup": null } }] } }
            ]},
            "comments": { "totalCount": 51, "nodes": [
                { "id": "IC_1", "author": null, "body": "Claimed.", "createdAt": "2026-11-14T10:00:00Z", "url": "https://github.com/o/r/issues/571#issuecomment-1" }
            ]}
        }}}}"#;
        let issue = parse_status(out, "").unwrap();
        assert_eq!((issue.repo.as_str(), issue.number, issue.state.as_str()), ("o/r", 571, "OPEN"));
        assert_eq!(issue.state_reason, None);
        assert_eq!(issue.issue_type.as_deref(), Some("Feature"));
        assert_eq!((issue.author.as_str(), issue.viewer.as_str()), ("you", "you"));
        assert_eq!(issue.assignees, ["claude"]);
        assert_eq!(issue.labels[0].name, "enhancement");
        assert_eq!(issue.milestone, Some(IssueMilestone { title: "v1".into(), url: "https://github.com/o/r/milestone/1".into() }));
        assert_eq!(issue.parent.as_ref().map(|p| p.number), Some(560));
        assert_eq!(issue.blocked_by.len(), 2);
        assert_eq!(issue.blocked_by[1].repo, "o/s");
        assert_eq!(issue.open_blocker_count, 3);
        assert_eq!(issue.pull_requests[0].check_state.as_deref(), Some("FAILURE"));
        assert_eq!(issue.pull_requests[1].check_state, None);
        assert_eq!(issue.comment_count, 51);
        assert_eq!(issue.comments[0].author, "ghost");
    }

    #[test]
    fn parse_status_counts_listed_open_blockers_when_the_summary_is_missing() {
        let out = serde_json::json!({ "data": { "viewer": { "login": "you" }, "repository": { "nameWithOwner": "o/r", "issue": {
            "number": 5, "state": "CLOSED", "stateReason": "NOT_PLANNED", "issueType": null, "milestone": null, "parent": null,
            "blockedBy": { "nodes": [{ "number": 4, "state": "OPEN" }] }
        }}}});
        let issue = parse_status(out.to_string().as_bytes(), "").unwrap();
        assert_eq!(issue.open_blocker_count, 1);
        assert_eq!(issue.state_reason.as_deref(), Some("NOT_PLANNED"));
        assert_eq!((issue.issue_type, issue.milestone, issue.parent), (None, None, None));
        assert!(issue.pull_requests.is_empty() && issue.comments.is_empty());
    }

    #[test]
    fn parse_status_returns_github_s_error() {
        let out = br#"{ "data": { "repository": { "issue": null } }, "errors": [{ "message": "Could not resolve to an Issue with the number of 99." }] }"#;
        assert_eq!(parse_status(out, "").unwrap_err(), "Could not resolve to an Issue with the number of 99.");
        assert_eq!(parse_status(b"", "HTTP 401: Bad credentials").unwrap_err(), "HTTP 401: Bad credentials");
    }

    #[test]
    fn parse_choices_reads_assignable_users_labels_and_types() {
        let out = br#"{ "data": { "repository": {
            "assignableUsers": { "nodes": [{ "login": "you" }, { "login": "claude" }] },
            "labels": { "nodes": [{ "name": "bug", "color": "f85149", "description": "Broken" }] }
        }}}"#;
        let choices = parse_choices(out, "").unwrap();
        assert_eq!(choices.assignees, ["you", "claude"]);
        assert_eq!(choices.labels[0].description.as_deref(), Some("Broken"));
        assert_eq!(parse_types(br#"{ "data": { "repository": { "issueTypes": { "nodes": [{ "name": "Bug" }, { "name": "Task" }] } } } }"#), ["Bug", "Task"]);
        assert!(parse_types(br#"{ "data": { "repository": { "issueTypes": null } } }"#).is_empty());
        assert_eq!(parse_choices(br#"{ "message": "Not Found" }"#, "").unwrap_err(), "Not Found");
    }

    #[test]
    fn close_reasons_are_completed_not_planned_and_duplicate_only() {
        for (sent, rest) in [("COMPLETED", "completed"), ("NOT_PLANNED", "not_planned"), ("DUPLICATE", "duplicate")] {
            assert_eq!(CloseReason::parse(sent).unwrap().as_rest(), rest);
        }
        assert!(CloseReason::parse("REOPENED").is_err());
        assert!(CloseReason::parse("completed").is_err());
    }

    #[test]
    fn close_and_reopen_patch_the_state_and_its_reason() {
        assert_eq!(
            close_args(&RepoSlug::Folder, 571, CloseReason::NotPlanned),
            ["api", "--method", "PATCH", "repos/{owner}/{repo}/issues/571", "-f", "state=closed", "-f", "state_reason=not_planned"]
        );
        assert_eq!(
            reopen_args(&RepoSlug::Named("o".into(), "r".into()), 5),
            ["api", "--method", "PATCH", "repos/o/r/issues/5", "-f", "state=open", "-f", "state_reason=reopened"]
        );
    }

    #[test]
    fn type_args_set_a_name_or_clear_it_with_null() {
        assert_eq!(type_args(&RepoSlug::Folder, 5, Some("Bug"))[4..], ["-f", "type=Bug"]);
        assert_eq!(type_args(&RepoSlug::Folder, 5, None)[4..], ["-F", "type=null"]);
    }

    #[test]
    fn assignee_and_label_args_send_arrays_and_escape_a_removed_label() {
        assert_eq!(
            assignee_args(&RepoSlug::Folder, 5, "POST", &["you".into(), "claude".into()]),
            ["api", "--method", "POST", "repos/{owner}/{repo}/issues/5/assignees", "-f", "assignees[]=you", "-f", "assignees[]=claude"]
        );
        assert_eq!(add_labels_args(&RepoSlug::Folder, 5, &["needs info".into()])[4..], ["-f", "labels[]=needs info"]);
        assert_eq!(remove_label_args(&RepoSlug::Folder, 5, "wayfinder:prototype/x y")[3], "repos/{owner}/{repo}/issues/5/labels/wayfinder%3Aprototype%2Fx%20y");
    }

    #[test]
    fn logins_and_names_are_checked() {
        for good in ["you", "claude-bot", "A1"] {
            assert!(check_login(good).is_ok(), "{good}");
        }
        for bad in ["", "-x", "x-", "a--b", "a b", "a/b", &"x".repeat(40)] {
            assert!(check_login(bad).is_err(), "{bad}");
        }
        assert!(check_name("ready-for-agent", "label").is_ok());
        for bad in ["", "  ", "a\nb", &"x".repeat(101)] {
            assert!(check_name(bad, "label").is_err(), "{bad:?}");
        }
    }
}
