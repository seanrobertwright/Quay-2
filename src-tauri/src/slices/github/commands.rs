use std::collections::HashMap;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::models::{
    GithubIssue, GithubIssueDetail, GithubIssueRef, GithubPage, GithubPullRequest,
    GithubRepoInfo,
};

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn create_gh_command(dir: &str) -> Command {
    let mut cmd = Command::new("gh");
    cmd.current_dir(dir);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Most blockers listed per issue; `issueDependenciesSummary` still reports the full count.
const BLOCKERS_PER_ISSUE: u32 = 20;

/// Open blockers for one issue, from GitHub's native "blocked by" dependencies.
#[derive(Debug, Clone, Default)]
struct BlockerInfo {
    open: Vec<GithubIssueRef>,
    open_count: u32,
}

/// Builds one GraphQL query that fetches the blockers of every issue in `numbers`,
/// one aliased `issue(number:)` field per issue.
fn build_blocked_by_query(numbers: &[u32]) -> String {
    let mut fields = String::new();
    for n in numbers {
        fields.push_str(&format!(
            "i{n}: issue(number: {n}) {{ number issueDependenciesSummary {{ blockedBy }} blockedBy(first: {BLOCKERS_PER_ISSUE}) {{ nodes {{ number title state url repository {{ nameWithOwner }} }} }} }} "
        ));
    }
    format!(
        "query($owner: String!, $name: String!) {{ repository(owner: $owner, name: $name) {{ {fields}}} }}"
    )
}

/// Parses the `gh api graphql` response from `build_blocked_by_query`. Aliases that
/// failed to resolve come back as `null` and are skipped.
fn parse_blocked_by_response(json: &serde_json::Value) -> HashMap<u32, BlockerInfo> {
    let mut out = HashMap::new();
    let Some(repo) = json["data"]["repository"].as_object() else {
        return out;
    };
    for issue in repo.values() {
        let Some(number) = issue["number"].as_u64().and_then(|n| u32::try_from(n).ok()) else {
            continue;
        };
        let open: Vec<GithubIssueRef> = issue["blockedBy"]["nodes"]
            .as_array()
            .map(|nodes| {
                nodes
                    .iter()
                    .filter(|n| n["state"].as_str() == Some("OPEN"))
                    .filter_map(|n| {
                        Some(GithubIssueRef {
                            number: n["number"].as_u64().and_then(|v| u32::try_from(v).ok())?,
                            title: n["title"].as_str().unwrap_or_default().to_string(),
                            state: "OPEN".to_string(),
                            url: n["url"].as_str().unwrap_or_default().to_string(),
                            repo_nwo: n["repository"]["nameWithOwner"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let summary_count = issue["issueDependenciesSummary"]["blockedBy"]
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .unwrap_or(0);
        let open_count = summary_count.max(open.len() as u32);
        out.insert(number, BlockerInfo { open, open_count });
    }
    out
}

/// Looks up open blockers for `numbers` in the repository at `repo_path`. Returns an
/// empty map (and logs) when the query fails, so issue lists still load on hosts
/// without issue dependencies.
fn fetch_blocked_by(repo_path: &str, numbers: &[u32]) -> HashMap<u32, BlockerInfo> {
    if numbers.is_empty() {
        return HashMap::new();
    }
    let query = build_blocked_by_query(numbers);
    let mut cmd = create_gh_command(repo_path);
    // gh fills {owner} and {repo} from the repository of the working directory.
    cmd.args([
        "api",
        "graphql",
        "-F",
        "owner={owner}",
        "-F",
        "name={repo}",
        "-f",
        &format!("query={}", query),
    ]);
    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            tracing::warn!("gh api graphql (blockedBy) failed to start: {}", e);
            return HashMap::new();
        }
    };
    // A partial error (one alias not found) exits non-zero but still prints `data`.
    match serde_json::from_slice::<serde_json::Value>(&output.stdout) {
        Ok(json) => parse_blocked_by_response(&json),
        Err(_) => {
            tracing::warn!(
                "gh api graphql (blockedBy) returned no JSON: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
            HashMap::new()
        }
    }
}

/// Items per page when the caller doesn't say. GitHub caps `first` at 100.
const DEFAULT_PAGE_SIZE: u32 = 50;
const MAX_PAGE_SIZE: u32 = 100;

/// GraphQL `states:` argument for an issue state filter; `None` means every state.
fn issue_states(state: &str) -> Result<Option<&'static str>, String> {
    match state {
        "open" => Ok(Some("[OPEN]")),
        "closed" => Ok(Some("[CLOSED]")),
        "all" => Ok(None),
        other => Err(format!("Unknown issue state filter: {}", other)),
    }
}

/// GraphQL `states:` argument for a pull request state filter. "closed" includes
/// merged pull requests, as `gh pr list --state closed` does.
fn pr_states(state: &str) -> Result<Option<&'static str>, String> {
    match state {
        "open" => Ok(Some("[OPEN]")),
        "closed" => Ok(Some("[CLOSED, MERGED]")),
        "merged" => Ok(Some("[MERGED]")),
        "all" => Ok(None),
        other => Err(format!("Unknown pull request state filter: {}", other)),
    }
}

const AUTHOR_FIELDS: &str = "author { login ... on User { name } }";
const LABEL_FIELDS: &str = "labels(first: 20) { nodes { name color description } }";

/// Builds the query for one page of issues, newest first (the `gh issue list` order).
fn build_issues_page_query(states: Option<&str>) -> String {
    let states_arg = states.map(|s| format!(", states: {s}")).unwrap_or_default();
    format!(
        "query($owner: String!, $name: String!, $first: Int!, $after: String) {{ repository(owner: $owner, name: $name) {{ \
         issues(first: $first, after: $after{states_arg}, orderBy: {{ field: CREATED_AT, direction: DESC }}) {{ \
         pageInfo {{ endCursor hasNextPage }} \
         nodes {{ number title state url updatedAt {AUTHOR_FIELDS} {LABEL_FIELDS} assignees(first: 10) {{ nodes {{ login name }} }} }} }} }} }}"
    )
}

/// Builds the query for one page of pull requests, newest first (the `gh pr list` order).
fn build_prs_page_query(states: Option<&str>) -> String {
    let states_arg = states.map(|s| format!(", states: {s}")).unwrap_or_default();
    format!(
        "query($owner: String!, $name: String!, $first: Int!, $after: String) {{ repository(owner: $owner, name: $name) {{ \
         pullRequests(first: $first, after: $after{states_arg}, orderBy: {{ field: CREATED_AT, direction: DESC }}) {{ \
         pageInfo {{ endCursor hasNextPage }} \
         nodes {{ number title state isDraft headRefName baseRefName url mergeable {AUTHOR_FIELDS} {LABEL_FIELDS} \
         commits(last: 1) {{ nodes {{ commit {{ statusCheckRollup {{ state }} }} }} }} }} }} }} }}"
    )
}

/// Runs a page query against the repository at `repo_path` and returns the parsed JSON.
fn run_page_query(
    repo_path: &str,
    query: &str,
    page_size: u32,
    after: Option<&str>,
) -> Result<serde_json::Value, String> {
    let mut cmd = create_gh_command(repo_path);
    // gh fills {owner} and {repo} from the repository of the working directory.
    cmd.args([
        "api",
        "graphql",
        "-F",
        "owner={owner}",
        "-F",
        "name={repo}",
        "-F",
        &format!("first={}", page_size.clamp(1, MAX_PAGE_SIZE)),
        "-f",
        &format!("query={}", query),
    ]);
    if let Some(cursor) = after {
        cmd.args(["-f", &format!("after={}", cursor)]);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute gh api graphql: {}", e))?;
    serde_json::from_slice::<serde_json::Value>(&output.stdout).map_err(|_| {
        format!(
            "gh api graphql failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
    })
}

/// Turns a GraphQL connection's `{ nodes: [...] }` into a plain array.
fn flatten_nodes(node: &mut serde_json::Value, field: &str) {
    let nodes = node[field]["nodes"].take();
    node[field] = if nodes.is_array() {
        nodes
    } else {
        serde_json::Value::Array(vec![])
    };
}

/// Parses one page of the connection at `data.repository.<connection>`. `shape` reshapes
/// each GraphQL node into the JSON `gh ... list --json` prints, so the existing models
/// deserialize it. GraphQL errors with no data come back as `Err`.
fn parse_page<T: serde::de::DeserializeOwned>(
    json: &serde_json::Value,
    connection: &str,
    shape: impl Fn(&mut serde_json::Value),
) -> Result<GithubPage<T>, String> {
    let conn = &json["data"]["repository"][connection];
    if !conn.is_object() {
        let messages: Vec<&str> = json["errors"]
            .as_array()
            .map(|errs| errs.iter().filter_map(|e| e["message"].as_str()).collect())
            .unwrap_or_default();
        return Err(if messages.is_empty() {
            format!("GitHub returned no {} for this repository", connection)
        } else {
            messages.join("; ")
        });
    }
    let mut items = Vec::new();
    for node in conn["nodes"].as_array().into_iter().flatten() {
        if node.is_null() {
            continue;
        }
        let mut node = node.clone();
        shape(&mut node);
        let item = serde_json::from_value(node)
            .map_err(|e| format!("Failed to parse {} page: {}", connection, e))?;
        items.push(item);
    }
    Ok(GithubPage {
        items,
        end_cursor: conn["pageInfo"]["endCursor"].as_str().map(str::to_string),
        has_next_page: conn["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false),
    })
}

fn parse_issues_page(json: &serde_json::Value) -> Result<GithubPage<GithubIssue>, String> {
    parse_page(json, "issues", |node| {
        flatten_nodes(node, "labels");
        flatten_nodes(node, "assignees");
    })
}

fn parse_prs_page(json: &serde_json::Value) -> Result<GithubPage<GithubPullRequest>, String> {
    parse_page(json, "pullRequests", |node| {
        flatten_nodes(node, "labels");
        node["statusCheckRollup"] = node["commits"]["nodes"][0]["commit"]["statusCheckRollup"].take();
        if let Some(obj) = node.as_object_mut() {
            obj.remove("commits");
        }
    })
}

#[tauri::command]
pub async fn check_gh_cli_installed()-> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        let mut cmd = Command::new("gh");
        cmd.arg("--version");
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        match cmd.output() {
            Ok(output) => Ok(output.status.success()),
            Err(_) => Ok(false),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn get_github_repo_info(repo_path: String) -> Result<Option<GithubRepoInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = create_gh_command(&repo_path);
        cmd.args(["repo", "view", "--json", "owner,name"]);
        let output = match cmd.output() {
            Ok(o) => o,
            Err(_) => return Ok(None),
        };

        if !output.status.success() {
            return Ok(None);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value = match serde_json::from_str(&stdout) {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };

        let owner = parsed["owner"]["login"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let name = parsed["name"].as_str().unwrap_or("").to_string();

        if owner.is_empty() || name.is_empty() {
            return Ok(None);
        }

        let nwo = format!("{}/{}", owner, name);
        Ok(Some(GithubRepoInfo {
            owner,
            name,
            nwo,
            is_authenticated: true,
        }))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// One page of issues. `after` is the previous page's `endCursor`; omit it for the
/// first page. Blockers are looked up in one batched query per page.
#[tauri::command]
pub async fn list_github_issues(
    repo_path: String,
    state: Option<String>,
    after: Option<String>,
    page_size: Option<u32>,
) -> Result<GithubPage<GithubIssue>, String> {
    tokio::task::spawn_blocking(move || {
        let states = issue_states(state.as_deref().unwrap_or("open"))?;
        let json = run_page_query(
            &repo_path,
            &build_issues_page_query(states),
            page_size.unwrap_or(DEFAULT_PAGE_SIZE),
            after.as_deref(),
        )?;
        let mut page = parse_issues_page(&json)?;
        let issues = &mut page.items;

        let open_numbers: Vec<u32> = issues
            .iter()
            .filter(|i| i.state.eq_ignore_ascii_case("open"))
            .map(|i| i.number)
            .collect();
        let mut blockers = fetch_blocked_by(&repo_path, &open_numbers);
        for issue in issues.iter_mut() {
            if let Some(info) = blockers.remove(&issue.number) {
                issue.blocked_by = info.open;
                issue.open_blocker_count = info.open_count;
            }
        }

        Ok(page)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn get_github_issue(
    repo_path: String,
    issue_number: u32,
) -> Result<GithubIssueDetail, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = create_gh_command(&repo_path);
        let num_str = issue_number.to_string();

        cmd.args([
            "issue",
            "view",
            &num_str,
            "--json",
            "number,title,body,state,author,labels,assignees,updatedAt,url",
        ]);

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to execute gh issue view: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("gh issue view failed: {}", stderr.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut issue: GithubIssueDetail = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse issue detail JSON: {}", e))?;

        if issue.state.eq_ignore_ascii_case("open")
            && let Some(info) = fetch_blocked_by(&repo_path, &[issue.number]).remove(&issue.number)
        {
            issue.blocked_by = info.open;
            issue.open_blocker_count = info.open_count;
        }

        Ok(issue)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// One page of pull requests. `after` is the previous page's `endCursor`; omit it for
/// the first page.
#[tauri::command]
pub async fn list_github_prs(
    repo_path: String,
    state: Option<String>,
    after: Option<String>,
    page_size: Option<u32>,
) -> Result<GithubPage<GithubPullRequest>, String> {
    tokio::task::spawn_blocking(move || {
        let states = pr_states(state.as_deref().unwrap_or("open"))?;
        let json = run_page_query(
            &repo_path,
            &build_prs_page_query(states),
            page_size.unwrap_or(DEFAULT_PAGE_SIZE),
            after.as_deref(),
        )?;
        parse_prs_page(&json)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_aliases_every_issue() {
        let q = build_blocked_by_query(&[12, 7]);
        assert!(q.contains("i12: issue(number: 12)"));
        assert!(q.contains("i7: issue(number: 7)"));
        assert!(q.starts_with("query($owner: String!, $name: String!)"));
    }

    #[test]
    fn parse_keeps_only_open_blockers_and_skips_null_aliases() {
        let json = serde_json::json!({
            "data": { "repository": {
                "i216": {
                    "number": 216,
                    "issueDependenciesSummary": { "blockedBy": 1 },
                    "blockedBy": { "nodes": [
                        { "number": 215, "title": "hold triage", "state": "OPEN",
                          "url": "https://github.com/o/r/issues/215",
                          "repository": { "nameWithOwner": "o/r" } },
                        { "number": 169, "title": "parity pass", "state": "CLOSED",
                          "url": "https://github.com/o/r/issues/169",
                          "repository": { "nameWithOwner": "o/r" } }
                    ]}
                },
                "i219": {
                    "number": 219,
                    "issueDependenciesSummary": { "blockedBy": 0 },
                    "blockedBy": { "nodes": [] }
                },
                "i999": null
            }}
        });
        let map = parse_blocked_by_response(&json);
        let b = &map[&216];
        assert_eq!(b.open_count, 1);
        assert_eq!(b.open.len(), 1);
        assert_eq!(b.open[0].number, 215);
        assert_eq!(b.open[0].repo_nwo, "o/r");
        assert_eq!(map[&219].open_count, 0);
        assert!(!map.contains_key(&999));
    }

    /// Live check against a real clone: `QUAY_GH_TEST_REPO=<path> QUAY_GH_TEST_ISSUES=216,217
    /// cargo test --lib live_blocked_by -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_blocked_by() {
        let repo = std::env::var("QUAY_GH_TEST_REPO").expect("set QUAY_GH_TEST_REPO");
        let numbers: Vec<u32> = std::env::var("QUAY_GH_TEST_ISSUES")
            .expect("set QUAY_GH_TEST_ISSUES")
            .split(',')
            .map(|n| n.trim().parse().expect("issue numbers must be integers"))
            .collect();
        let map = fetch_blocked_by(&repo, &numbers);
        if let Ok(dir) = std::env::var("QUAY_DUMP_DIR") {
            let rt = tokio::runtime::Runtime::new().unwrap();
            let issues = rt
                .block_on(list_github_issues(repo.clone(), Some("open".into()), None, Some(30)))
                .unwrap()
                .items;
            std::fs::write(
                std::path::Path::new(&dir).join("list_github_issues.json"),
                serde_json::to_string_pretty(&issues).unwrap(),
            )
            .unwrap();
        }
        for n in &numbers {
            println!("#{n}: {:?}", map.get(n));
        }
        assert!(!map.is_empty(), "no blocker data came back");
    }

    #[test]
    fn open_count_uses_summary_when_more_than_one_page() {
        let json = serde_json::json!({
            "data": { "repository": { "i1": {
                "number": 1,
                "issueDependenciesSummary": { "blockedBy": 30 },
                "blockedBy": { "nodes": [
                    { "number": 2, "title": "a", "state": "OPEN", "url": "",
                      "repository": { "nameWithOwner": "o/r" } }
                ]}
            }}}
        });
        let map = parse_blocked_by_response(&json);
        assert_eq!(map[&1].open_count, 30);
        assert_eq!(map[&1].open.len(), 1);
    }

    #[test]
    fn state_filters_map_to_graphql_states() {
        assert_eq!(issue_states("open").unwrap(), Some("[OPEN]"));
        assert_eq!(issue_states("closed").unwrap(), Some("[CLOSED]"));
        assert_eq!(issue_states("all").unwrap(), None);
        assert!(issue_states("merged").is_err());
        assert_eq!(pr_states("closed").unwrap(), Some("[CLOSED, MERGED]"));
        assert_eq!(pr_states("all").unwrap(), None);
    }

    #[test]
    fn page_queries_take_a_cursor_and_omit_states_for_all() {
        let open = build_issues_page_query(Some("[OPEN]"));
        assert!(open.contains("$after: String"));
        assert!(open.contains("issues(first: $first, after: $after, states: [OPEN],"));
        assert!(open.contains("pageInfo { endCursor hasNextPage }"));
        let all = build_prs_page_query(None);
        assert!(all.contains("pullRequests(first: $first, after: $after, orderBy:"));
        assert!(!all.contains("states:"));
    }

    #[test]
    fn parse_issues_page_flattens_connections() {
        let json = serde_json::json!({
            "data": { "repository": { "issues": {
                "pageInfo": { "endCursor": "Y3Vy", "hasNextPage": true },
                "nodes": [{
                    "number": 286, "title": "Open Project dialog", "state": "OPEN",
                    "url": "https://github.com/o/r/issues/286",
                    "updatedAt": "2026-10-26T15:01:35Z",
                    "author": { "login": "sean", "name": "Sean" },
                    "labels": { "nodes": [
                        { "name": "wayfinder:task", "color": "c5def5", "description": null }
                    ]},
                    "assignees": { "nodes": [{ "login": "sean", "name": "Sean" }] }
                }, {
                    "number": 1, "title": "ghost author", "state": "CLOSED",
                    "url": "", "updatedAt": "2026-01-01T00:00:00Z",
                    "author": null,
                    "labels": { "nodes": [] }, "assignees": { "nodes": [] }
                }]
            }}}
        });
        let page = parse_issues_page(&json).unwrap();
        assert_eq!(page.end_cursor.as_deref(), Some("Y3Vy"));
        assert!(page.has_next_page);
        assert_eq!(page.items.len(), 2);
        let first = &page.items[0];
        assert_eq!(first.number, 286);
        assert_eq!(first.labels[0].name, "wayfinder:task");
        assert_eq!(first.labels[0].color, "c5def5");
        assert_eq!(first.assignees[0].login, "sean");
        assert_eq!(first.author.as_ref().unwrap().login, "sean");
        assert!(first.blocked_by.is_empty());
        assert!(page.items[1].author.is_none());
    }

    #[test]
    fn parse_prs_page_lifts_the_head_commit_rollup() {
        let json = serde_json::json!({
            "data": { "repository": { "pullRequests": {
                "pageInfo": { "endCursor": null, "hasNextPage": false },
                "nodes": [{
                    "number": 276, "title": "Validation problems", "state": "MERGED",
                    "isDraft": false, "headRefName": "ticket-257", "baseRefName": "master",
                    "url": "https://github.com/o/r/pull/276", "mergeable": "UNKNOWN",
                    "author": { "login": "app/dependabot" },
                    "labels": { "nodes": [] },
                    "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "state": "SUCCESS" } } }] }
                }, {
                    "number": 277, "title": "No checks", "state": "OPEN",
                    "isDraft": true, "headRefName": "x", "baseRefName": "master",
                    "url": "", "mergeable": "CONFLICTING", "author": { "login": "sean" },
                    "labels": { "nodes": [] },
                    "commits": { "nodes": [{ "commit": { "statusCheckRollup": null } }] }
                }]
            }}}
        });
        let page = parse_prs_page(&json).unwrap();
        assert!(!page.has_next_page);
        assert_eq!(page.end_cursor, None);
        let pr = &page.items[0];
        assert_eq!(pr.head_ref_name, "ticket-257");
        assert_eq!(pr.status_check_rollup.as_ref().unwrap()["state"], "SUCCESS");
        assert!(pr.author.as_ref().unwrap().name.is_none());
        assert!(page.items[1].status_check_rollup.is_none());
        assert!(page.items[1].is_draft);
        assert_eq!(page.items[1].mergeable.as_deref(), Some("CONFLICTING"));
    }

    #[test]
    fn parse_page_reports_graphql_errors() {
        let json = serde_json::json!({
            "data": { "repository": null },
            "errors": [{ "message": "Could not resolve to a Repository" }]
        });
        let err = parse_issues_page(&json).unwrap_err();
        assert!(err.contains("Could not resolve"));
    }
}
