use std::collections::HashMap;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::models::{
    GithubIssue, GithubIssueDetail, GithubIssueRef, GithubPullRequest, GithubRepoInfo,
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

#[tauri::command]
pub async fn check_gh_cli_installed() -> Result<bool, String> {
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

#[tauri::command]
pub async fn list_github_issues(
    repo_path: String,
    state: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<GithubIssue>, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = create_gh_command(&repo_path);
        let limit_str = limit.unwrap_or(30).to_string();
        let state_str = state.unwrap_or_else(|| "open".to_string());

        cmd.args([
            "issue",
            "list",
            "--limit",
            &limit_str,
            "--state",
            &state_str,
            "--json",
            "number,title,state,author,labels,assignees,updatedAt,url",
        ]);

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to execute gh issue list: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("gh issue list failed: {}", stderr.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut issues: Vec<GithubIssue> = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse issues JSON: {}", e))?;

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

        Ok(issues)
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

#[tauri::command]
pub async fn list_github_prs(
    repo_path: String,
    state: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<GithubPullRequest>, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = create_gh_command(&repo_path);
        let limit_str = limit.unwrap_or(25).to_string();
        let state_str = state.unwrap_or_else(|| "open".to_string());

        cmd.args([
            "pr",
            "list",
            "--limit",
            &limit_str,
            "--state",
            &state_str,
            "--json",
            "number,title,state,isDraft,headRefName,baseRefName,labels,author,statusCheckRollup,mergeable,url",
        ]);

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to execute gh pr list: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("gh pr list failed: {}", stderr.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let prs: Vec<GithubPullRequest> = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse PRs JSON: {}", e))?;

        Ok(prs)
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
                .block_on(list_github_issues(repo.clone(), Some("open".into()), Some(30)))
                .unwrap();
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
}
