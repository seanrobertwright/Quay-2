use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::models::{GithubIssue, GithubIssueDetail, GithubPullRequest, GithubRepoInfo};

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn create_gh_command(dir: &str) -> Command {
    let mut cmd = Command::new("gh");
    cmd.current_dir(dir);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
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
        let issues: Vec<GithubIssue> = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse issues JSON: {}", e))?;

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
        let issue: GithubIssueDetail = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse issue detail JSON: {}", e))?;

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
