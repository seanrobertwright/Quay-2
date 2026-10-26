use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubUser {
    pub login: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubLabel {
    pub name: String,
    #[serde(default)]
    pub color: String,
    pub description: Option<String>,
}

/// An issue that blocks another issue, from GitHub's native issue dependencies.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubIssueRef {
    pub number: u32,
    pub title: String,
    pub state: String,
    #[serde(default)]
    pub url: String,
    /// `owner/name` of the blocker's repository; blockers may live in another repo.
    #[serde(rename = "repoNwo", default)]
    pub repo_nwo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubIssue {
    pub number: u32,
    pub title: String,
    pub state: String,
    pub author: Option<GithubUser>,
    #[serde(default)]
    pub labels: Vec<GithubLabel>,
    #[serde(default)]
    pub assignees: Vec<GithubUser>,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: String,
    #[serde(default)]
    pub url: String,
    /// Open issues that block this one (closed blockers are dropped).
    #[serde(rename = "blockedBy", default)]
    pub blocked_by: Vec<GithubIssueRef>,
    /// Count of open blockers reported by GitHub; can exceed `blocked_by.len()`
    /// when the issue has more blockers than one query page returns.
    #[serde(rename = "openBlockerCount", default)]
    pub open_blocker_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubIssueDetail {
    pub number: u32,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub state: String,
    pub author: Option<GithubUser>,
    #[serde(default)]
    pub labels: Vec<GithubLabel>,
    #[serde(default)]
    pub assignees: Vec<GithubUser>,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: String,
    #[serde(default)]
    pub url: String,
    /// Open issues that block this one (closed blockers are dropped).
    #[serde(rename = "blockedBy", default)]
    pub blocked_by: Vec<GithubIssueRef>,
    /// Count of open blockers reported by GitHub; can exceed `blocked_by.len()`
    /// when the issue has more blockers than one query page returns.
    #[serde(rename = "openBlockerCount", default)]
    pub open_blocker_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubPullRequest {
    pub number: u32,
    pub title: String,
    pub state: String,
    #[serde(rename = "isDraft", default)]
    pub is_draft: bool,
    #[serde(rename = "headRefName", default)]
    pub head_ref_name: String,
    #[serde(rename = "baseRefName", default)]
    pub base_ref_name: String,
    #[serde(default)]
    pub labels: Vec<GithubLabel>,
    pub author: Option<GithubUser>,
    /// The head commit's check rollup, `{ "state": "SUCCESS" | "FAILURE" | ... }`.
    #[serde(rename = "statusCheckRollup", default)]
    pub status_check_rollup: Option<serde_json::Value>,
    pub mergeable: Option<String>,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubRepoInfo {
    pub owner: String,
    pub name: String,
    pub nwo: String,
    pub is_authenticated: bool,
}

/// One page of a cursor-paged GitHub list. Pass `end_cursor` back as `after` to get
/// the next page; `has_next_page` is false on the last one.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubPage<T> {
    pub items: Vec<T>,
    #[serde(rename = "endCursor")]
    pub end_cursor: Option<String>,
    #[serde(rename = "hasNextPage")]
    pub has_next_page: bool,
}
