use std::fs;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use super::models::{
    AdrItem, ArchonRun, ArchonServiceStatus, ArchonWorkflow, RepoSpecSummary, SpecTask,
};

fn get_archon_home() -> Option<PathBuf> {
    dirs_home().map(|h| h.join(".archon"))
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
}

fn get_archon_binary() -> Option<PathBuf> {
    if let Some(home) = get_archon_home() {
        let bin = home.join("bin").join("archon.exe");
        if bin.exists() {
            return Some(bin);
        }
    }
    // Check PATH environment variable for archon.exe
    if let Ok(paths) = std::env::var("PATH") {
        for p in std::env::split_paths(&paths) {
            let exe = p.join("archon.exe");
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
}

fn resolve_archon_port() -> u16 {
    if let Some(home) = get_archon_home() {
        let env_file = home.join(".env");
        if let Ok(content) = fs::read_to_string(env_file) {
            for line in content.lines() {
                let trimmed = line.trim();
                if let Some(val) = trimmed.strip_prefix("PORT=") {
                    if let Ok(port) = val.trim().parse::<u16>() {
                        return port;
                    }
                }
            }
        }
    }
    3090
}

fn is_port_listening(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    TcpStream::connect_timeout(
        &addr.parse().unwrap_or_else(|_| "127.0.0.1:3090".parse().unwrap()),
        Duration::from_millis(400),
    )
    .is_ok()
}

#[tauri::command]
pub fn archon_check_service() -> Result<ArchonServiceStatus, String> {
    let configured_port = resolve_archon_port();
    let bin_path = get_archon_binary().map(|p| p.to_string_lossy().to_string());

    let mut active_port = configured_port;
    let mut is_running = is_port_listening(configured_port);

    // Fallback to checking default 3737 if configured port not running
    if !is_running && configured_port != 3737 && is_port_listening(3737) {
        active_port = 3737;
        is_running = true;
    }

    let version = if let Some(ref path) = bin_path {
        let output = Command::new(path).arg("--version").output().ok();
        output.and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
    } else {
        None
    };

    let message = if is_running {
        format!("Archon service is active and listening on port {}.", active_port)
    } else if bin_path.is_some() {
        "Archon binary found, but background service is not currently listening. You can launch workflows directly with Archon CLI or run 'archon serve'.".to_string()
    } else {
        "Archon is not installed on this machine. (Expected ~/.archon/bin/archon.exe)".to_string()
    };

    Ok(ArchonServiceStatus {
        running: is_running,
        port: active_port,
        version,
        binary_path: bin_path,
        message,
    })
}

#[tauri::command]
pub fn archon_get_workflows() -> Result<Vec<ArchonWorkflow>, String> {
    let port = resolve_archon_port();
    let active_port = if is_port_listening(port) {
        port
    } else if is_port_listening(3737) {
        3737
    } else {
        port
    };

    // 1. Try querying Archon REST API endpoint /api/workflows via curl.exe
    if is_port_listening(active_port) {
        let url = format!("http://127.0.0.1:{}/api/workflows", active_port);
        let output = Command::new("curl.exe")
            .args(["-s", "--connect-timeout", "2", &url])
            .output();

        if let Ok(out) = output {
            if out.status.success() && !out.stdout.is_empty() {
                if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                    if let Some(list) = parsed.get("workflows").and_then(|w| w.as_array()) {
                        let mut workflows = Vec::new();
                        for item in list {
                            if let Ok(wf) = serde_json::from_value::<ArchonWorkflow>(item.clone()) {
                                workflows.push(wf);
                            }
                        }
                        if !workflows.is_empty() {
                            return Ok(workflows);
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback to CLI: archon workflow list --json
    let bin = get_archon_binary().ok_or_else(|| "Archon binary not found".to_string())?;
    let output = Command::new(bin)
        .args(["workflow", "list", "--json"])
        .output()
        .map_err(|e| format!("Failed to execute archon workflow list: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse workflow list JSON: {}", e))?;

    let mut workflows = Vec::new();
    if let Some(list) = parsed.get("workflows").and_then(|w| w.as_array()) {
        for item in list {
            let name = item["name"].as_str().unwrap_or_default().to_string();
            let desc = item["description"].as_str().map(|s| s.to_string());
            let provider = item["provider"].as_str().map(|s| s.to_string());
            let model = item["model"].as_str().map(|s| s.to_string());

            workflows.push(ArchonWorkflow {
                id: name.clone(),
                name,
                description: desc,
                plan: None,
                inputs: None,
                returns: None,
                source: Some("installed".to_string()),
                provider,
                model,
            });
        }
    }

    Ok(workflows)
}

#[tauri::command]
pub fn archon_get_runs() -> Result<Vec<ArchonRun>, String> {
    let bin = get_archon_binary().ok_or_else(|| "Archon binary not found".to_string())?;
    let output = Command::new(bin)
        .args(["workflow", "runs", "--json", "--limit", "30"])
        .output()
        .map_err(|e| format!("Failed to execute archon workflow runs: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse runs JSON: {}", e))?;

    let mut runs = Vec::new();
    if let Some(list) = parsed.get("runs").and_then(|r| r.as_array()) {
        for item in list {
            let id = item["id"].as_str().unwrap_or_default().to_string();
            let wf_name = item["workflow_name"].as_str().unwrap_or_default().to_string();
            let msg = item["user_message"].as_str().map(|s| s.to_string());
            let status = item["status"].as_str().unwrap_or("unknown").to_string();
            let path = item["working_path"].as_str().map(|s| s.to_string());
            let started = item["started_at"].as_str().map(|s| s.to_string());
            let completed = item["completed_at"].as_str().map(|s| s.to_string());
            let cost = item["metadata"]["total_cost_usd"].as_f64();
            let codebase = item["codebase_name"].as_str().map(|s| s.to_string());
            let current_step = item["current_step_name"].as_str().map(|s| s.to_string());

            runs.push(ArchonRun {
                id,
                workflow_name: wf_name,
                user_message: msg,
                status,
                working_path: path,
                started_at: started,
                completed_at: completed,
                total_cost_usd: cost,
                codebase_name: codebase,
                current_step_name: current_step,
            });
        }
    }

    Ok(runs)
}

#[tauri::command]
pub fn archon_parse_repo_specs(project_path: String) -> Result<RepoSpecSummary, String> {
    let p = Path::new(&project_path);
    if !p.exists() {
        return Err(format!("Project path '{}' does not exist", project_path));
    }

    let mut spec_files_found = Vec::new();
    let mut tasks = Vec::new();
    let mut adrs = Vec::new();

    // Check Candidate Spec Files
    let candidate_names = [
        "SPEC.md",
        "CONTEXT.md",
        "IDEAS.md",
        "TODO.md",
        "ROADMAP.md",
        "docs/SPEC.md",
        "docs/CONTEXT.md",
    ];

    for name in &candidate_names {
        let candidate_path = p.join(name);
        if candidate_path.is_file() {
            spec_files_found.push(name.to_string());
            if let Ok(content) = fs::read_to_string(&candidate_path) {
                parse_markdown_tasks(&content, name, &mut tasks);
            }
        }
    }

    // Check ADR directories: docs/adr/, doc/adr/, adr/
    let adr_candidates = ["docs/adr", "doc/adr", "adr", "docs/adrs"];
    for adr_dir_name in &adr_candidates {
        let adr_dir = p.join(adr_dir_name);
        if adr_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&adr_dir) {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if entry_path.extension().and_then(|s| s.to_str()) == Some("md") {
                        if let Ok(content) = fs::read_to_string(&entry_path) {
                            if let Some(adr) = parse_adr_file(&entry_path, &content) {
                                adrs.push(adr);
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort ADRs numerically by their prefix
    adrs.sort_by(|a, b| a.number.cmp(&b.number));

    Ok(RepoSpecSummary {
        project_path,
        tasks,
        adrs,
        spec_files_found,
    })
}

fn parse_markdown_tasks(content: &str, file_name: &str, tasks: &mut Vec<SpecTask>) {
    let mut current_section = "General".to_string();

    for (idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();

        if trimmed.starts_with("# ")
            || trimmed.starts_with("## ")
            || trimmed.starts_with("### ")
        {
            current_section = trimmed.trim_start_matches('#').trim().to_string();
            continue;
        }

        // Match markdown checklist items: - [ ] or - [x] or * [ ] or * [x]
        let is_task = (trimmed.starts_with("- [ ]")
            || trimmed.starts_with("- [x]")
            || trimmed.starts_with("- [X]")
            || trimmed.starts_with("* [ ]")
            || trimmed.starts_with("* [x]")
            || trimmed.starts_with("* [X]"))
            && trimmed.len() >= 6;

        if is_task {
            let completed = trimmed.starts_with("- [x]")
                || trimmed.starts_with("- [X]")
                || trimmed.starts_with("* [x]")
                || trimmed.starts_with("* [X]");

            let title = trimmed[5..].trim().to_string();
            let id = format!("{}:{}:{}", file_name, idx + 1, tasks.len() + 1);

            tasks.push(SpecTask {
                id,
                title,
                completed,
                line_number: idx + 1,
                section: current_section.clone(),
                file_name: file_name.to_string(),
            });
        }
    }
}

fn parse_adr_file(file_path: &Path, content: &str) -> Option<AdrItem> {
    let file_name = file_path.file_name()?.to_string_lossy().to_string();
    let id = file_name.clone();

    // Extract number prefix e.g. "0001" from "0001-one-session-stage-topology.md"
    let number = file_name
        .split('-')
        .next()
        .unwrap_or("0000")
        .to_string();

    let mut title = file_name.replace(".md", "");
    let mut status = "Accepted".to_string();
    let mut date = None;
    let mut summary = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("# ") && title == file_name.replace(".md", "") {
            title = trimmed.trim_start_matches('#').trim().to_string();
        } else if trimmed.to_lowercase().starts_with("status:") {
            status = trimmed[7..].trim().to_string();
        } else if trimmed.to_lowercase().starts_with("date:") {
            date = Some(trimmed[5..].trim().to_string());
        } else if summary.is_none()
            && !trimmed.is_empty()
            && !trimmed.starts_with('#')
            && !trimmed.starts_with("<!--")
            && !trimmed.to_lowercase().starts_with("status:")
            && !trimmed.to_lowercase().starts_with("date:")
        {
            summary = Some(trimmed.to_string());
        }
    }

    Some(AdrItem {
        id,
        number,
        title,
        status,
        file_path: file_path.to_string_lossy().to_string(),
        summary,
        date,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_markdown_tasks() {
        let md = r#"
# Specification
Some intro text

## Core Requirements
- [ ] Implement Archon DAG Graph Viewer
- [x] Create PTY multiplexer
- [ ] Add Pi agent support

## Documentation
* [x] Write README
"#;
        let mut tasks = Vec::new();
        parse_markdown_tasks(md, "SPEC.md", &mut tasks);

        assert_eq!(tasks.len(), 4);
        assert_eq!(tasks[0].title, "Implement Archon DAG Graph Viewer");
        assert!(!tasks[0].completed);
        assert_eq!(tasks[0].section, "Core Requirements");

        assert_eq!(tasks[1].title, "Create PTY multiplexer");
        assert!(tasks[1].completed);

        assert_eq!(tasks[2].title, "Add Pi agent support");
        assert!(!tasks[2].completed);

        assert_eq!(tasks[3].title, "Write README");
        assert!(tasks[3].completed);
        assert_eq!(tasks[3].section, "Documentation");
    }

    #[test]
    fn test_parse_adr_file() {
        let content = r#"# 1. Record Architecture Decisions
Date: 2026-10-15
Status: Accepted

We need to record architecture decisions in docs/adr.
"#;
        let p = Path::new("docs/adr/0001-record-architecture-decisions.md");
        let adr = parse_adr_file(p, content).unwrap();

        assert_eq!(adr.number, "0001");
        assert_eq!(adr.title, "1. Record Architecture Decisions");
        assert_eq!(adr.status, "Accepted");
        assert_eq!(adr.date, Some("2026-10-15".to_string()));
        assert!(adr.summary.unwrap().contains("record architecture decisions"));
    }
}
