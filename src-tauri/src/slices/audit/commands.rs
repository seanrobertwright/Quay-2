use super::models::{AuditReport, AuditViolation};
use std::collections::HashSet;
use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub async fn run_pre_pr_audit(
    project_path: String,
    base_branch: Option<String>,
) -> Result<AuditReport, String> {
    tokio::task::spawn_blocking(move || run_pre_pr_audit_sync(&project_path, base_branch.as_deref()))
        .await
        .map_err(|e| format!("Audit task panicked: {}", e))?
}

pub(crate) fn run_pre_pr_audit_sync(project_path: &str, base_branch: Option<&str>) -> Result<AuditReport, String> {
    let mut violations = Vec::new();
    let mut files_scanned_set = HashSet::new();

    // 1. Check git status for suspicious uncommitted or untracked files
    let mut status_cmd = Command::new("git");
    status_cmd.args(["status", "--porcelain"]).current_dir(project_path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        status_cmd.creation_flags(CREATE_NO_WINDOW);
    }

    if let Ok(output) = status_cmd.output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.len() < 3 {
                    continue;
                }
                let file_part = &trimmed[3..].trim();
                let lower_file = file_part.to_lowercase();

                if lower_file.contains(".env") && !lower_file.contains(".env.example") {
                    violations.push(AuditViolation {
                        severity: "blocker".to_string(),
                        category: "untracked_artifact".to_string(),
                        file_path: file_part.to_string(),
                        line_number: None,
                        message: "Sensitive environment file (.env) detected in working tree".to_string(),
                        snippet: Some(line.to_string()),
                    });
                } else if lower_file.ends_with(".pem")
                    || lower_file.ends_with(".key")
                    || lower_file.contains("id_rsa")
                {
                    violations.push(AuditViolation {
                        severity: "blocker".to_string(),
                        category: "untracked_artifact".to_string(),
                        file_path: file_part.to_string(),
                        line_number: None,
                        message: "Cryptographic private key file detected in working tree".to_string(),
                        snippet: Some(line.to_string()),
                    });
                } else if lower_file.contains(".gemini") || lower_file.contains("scratch/") {
                    violations.push(AuditViolation {
                        severity: "warning".to_string(),
                        category: "untracked_artifact".to_string(),
                        file_path: file_part.to_string(),
                        line_number: None,
                        message: "Temporary agent artifact or scratch directory present".to_string(),
                        snippet: Some(line.to_string()),
                    });
                }
            }
        }
    }

    // 2. Run git diff
    // Determine diff args: if base_branch is supplied, diff against that;
    // otherwise check HEAD (working tree vs HEAD). If that's empty, try HEAD~1.
    let diff_output = get_git_diff_output(project_path, base_branch)?;
    scan_diff_content(&diff_output, &mut violations, &mut files_scanned_set);

    let blocker_count = violations.iter().filter(|v| v.severity == "blocker").count();
    let warning_count = violations.iter().filter(|v| v.severity == "warning").count();
    let info_count = violations.iter().filter(|v| v.severity == "info").count();

    Ok(AuditReport {
        passed: blocker_count == 0,
        blocker_count,
        warning_count,
        info_count,
        files_scanned: files_scanned_set.len(),
        violations,
        generated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_default(),
    })
}

fn get_git_diff_output(project_path: &str, base_branch: Option<&str>) -> Result<String, String> {
    let mut args = vec!["diff"];

    let target_ref;
    if let Some(base) = base_branch {
        target_ref = format!("{}...HEAD", base);
        args.push(&target_ref);
    } else {
        args.push("HEAD");
    }

    let mut cmd = Command::new("git");
    cmd.args(&args).current_dir(project_path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().map_err(|e| format!("Failed to execute git diff: {}", e))?;
    let mut diff_str = String::from_utf8_lossy(&output.stdout).to_string();

    // If working tree vs HEAD diff is completely empty and no base branch was specified,
    // also check HEAD~1 to audit the most recent commit on the branch
    if diff_str.trim().is_empty() && base_branch.is_none() {
        let mut head_cmd = Command::new("git");
        head_cmd.args(["diff", "HEAD~1"]).current_dir(project_path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            head_cmd.creation_flags(CREATE_NO_WINDOW);
        }
        if let Ok(head_output) = head_cmd.output() {
            diff_str = String::from_utf8_lossy(&head_output.stdout).to_string();
        }
    }

    Ok(diff_str)
}

pub fn scan_diff_content(
    diff_text: &str,
    violations: &mut Vec<AuditViolation>,
    files_scanned: &mut HashSet<String>,
) {
    let mut current_file = String::new();
    let mut current_line_num: usize = 0;

    for raw_line in diff_text.lines() {
        if raw_line.starts_with("+++ b/") {
            current_file = raw_line.trim_start_matches("+++ b/").to_string();
            files_scanned.insert(current_file.clone());
            continue;
        }

        if raw_line.starts_with("@@ ") {
            // Parse @@ -x,y +start,len @@
            if let Some(plus_idx) = raw_line.find('+') {
                let rest = &raw_line[plus_idx + 1..];
                let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if let Ok(n) = num_str.parse::<usize>() {
                    current_line_num = n;
                }
            }
            continue;
        }

        // Only scan newly added lines
        if raw_line.starts_with('+') && !raw_line.starts_with("+++") {
            let line_content = &raw_line[1..];
            let lower_line = line_content.to_lowercase();

            // 1. Personal Path Leak (e.g. seanr username or C:\Users\ paths)
            if contains_word(&lower_line, "seanr") {
                violations.push(AuditViolation {
                    severity: "blocker".to_string(),
                    category: "leak_user_path".to_string(),
                    file_path: current_file.clone(),
                    line_number: Some(current_line_num),
                    message: "Personal username/path 'seanr' detected in code diff".to_string(),
                    snippet: Some(line_content.trim().to_string()),
                });
            } else if line_content.contains("C:\\Users\\")
                || line_content.contains("C:/Users/")
                || lower_line.contains("/users/seanr")
            {
                violations.push(AuditViolation {
                    severity: "blocker".to_string(),
                    category: "leak_user_path".to_string(),
                    file_path: current_file.clone(),
                    line_number: Some(current_line_num),
                    message: "Hardcoded absolute Windows user path detected".to_string(),
                    snippet: Some(line_content.trim().to_string()),
                });
            } else if line_content.contains("file:///C:") || line_content.contains("file:///E:") {
                violations.push(AuditViolation {
                    severity: "warning".to_string(),
                    category: "leak_user_path".to_string(),
                    file_path: current_file.clone(),
                    line_number: Some(current_line_num),
                    message: "Absolute local file:/// URI detected".to_string(),
                    snippet: Some(line_content.trim().to_string()),
                });
            }

            if contains_personal_email(&lower_line) {
                violations.push(AuditViolation {
                    severity: "blocker".to_string(),
                    category: "leak_user_path".to_string(),
                    file_path: current_file.clone(),
                    line_number: Some(current_line_num),
                    message: "Personal email address detected in code diff".to_string(),
                    snippet: Some(line_content.trim().to_string()),
                });
            }

            // 2. Secret & Token Leaks
            if line_content.contains("ghp_") || line_content.contains("github_pat_") {
                violations.push(AuditViolation {
                    severity: "blocker".to_string(),
                    category: "leak_secret".to_string(),
                    file_path: current_file.clone(),
                    line_number: Some(current_line_num),
                    message: "Potential GitHub Personal Access Token leaked in code".to_string(),
                    snippet: Some(mask_snippet(line_content.trim())),
                });
            } else if line_content.contains("sk-ant-") {
                violations.push(AuditViolation {
                    severity: "blocker".to_string(),
                    category: "leak_secret".to_string(),
                    file_path: current_file.clone(),
                    line_number: Some(current_line_num),
                    message: "Anthropic API key leaked in code".to_string(),
                    snippet: Some(mask_snippet(line_content.trim())),
                });
            } else if line_content.contains("BEGIN OPENSSH PRIVATE KEY")
                || line_content.contains("BEGIN RSA PRIVATE KEY")
                || line_content.contains("BEGIN PRIVATE KEY")
            {
                violations.push(AuditViolation {
                    severity: "blocker".to_string(),
                    category: "leak_secret".to_string(),
                    file_path: current_file.clone(),
                    line_number: Some(current_line_num),
                    message: "Private cryptographic key header detected".to_string(),
                    snippet: Some("[PRIVATE KEY DATA REDACTED]".to_string()),
                });
            }

            // 3. Excessively long line warning (potential minified asset or accidental binary paste)
            if line_content.len() > 2500 {
                violations.push(AuditViolation {
                    severity: "warning".to_string(),
                    category: "file_size".to_string(),
                    file_path: current_file.clone(),
                    line_number: Some(current_line_num),
                    message: format!("Suspiciously long line ({} chars) added; check for accidental bundle or base64 commit", line_content.len()),
                    snippet: Some(format!("{}...", &line_content[..80])),
                });
            }

            current_line_num += 1;
        } else if !raw_line.starts_with('-') {
            current_line_num += 1;
        }
    }
}

/// Whether `word` appears in `text` with no letter, digit or `_` on either side, so a username
/// matches as a path segment or token but not inside a longer name such as a GitHub handle.
fn contains_word(text: &str, word: &str) -> bool {
    let is_word_byte = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let bytes = text.as_bytes();
    text.match_indices(word).any(|(start, _)| {
        let end = start + word.len();
        (start == 0 || !is_word_byte(bytes[start - 1])) && (end == bytes.len() || !is_word_byte(bytes[end]))
    })
}

/// Mail domains that hold people's own addresses, as opposed to a project's or a no-reply one.
const PERSONAL_MAIL_DOMAINS: [&str; 10] = [
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "yahoo.com",
    "icloud.com",
    "proton.me",
    "protonmail.com",
    "aol.com",
];

/// Whether lower-cased `text` holds an address at one of `PERSONAL_MAIL_DOMAINS`.
fn contains_personal_email(text: &str) -> bool {
    PERSONAL_MAIL_DOMAINS.iter().any(|domain| {
        let at_domain = format!("@{domain}");
        text.match_indices(&at_domain).any(|(start, _)| {
            let end = start + at_domain.len();
            let has_local_part = start > 0 && text.as_bytes()[start - 1].is_ascii_alphanumeric();
            let domain_ends = end == text.len() || !text.as_bytes()[end].is_ascii_alphanumeric();
            has_local_part && domain_ends
        })
    })
}

fn mask_snippet(snippet: &str) -> String {
    if snippet.len() <= 12 {
        return "********".to_string();
    }
    format!("{}...****", &snippet[..8])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_diff_for_seanr_leak() {
        let diff = r#"
diff --git a/src/config.ts b/src/config.ts
index abc..def 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
 const fallback = "production";
+const localPath = "C:\\Users\\seanr\\AppData\\secrets.json";
"#;
        let mut violations = Vec::new();
        let mut files = HashSet::new();
        scan_diff_content(diff, &mut violations, &mut files);

        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].severity, "blocker");
        assert_eq!(violations[0].file_path, "src/config.ts");
        assert!(violations[0].message.contains("seanr"));
    }

    fn scan_added_lines(lines: &[&str]) -> Vec<AuditViolation> {
        let mut diff = String::from("--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,9 @@\n");
        for line in lines {
            diff.push('+');
            diff.push_str(line);
            diff.push('\n');
        }
        let mut violations = Vec::new();
        let mut files = HashSet::new();
        scan_diff_content(&diff, &mut violations, &mut files);
        violations
    }

    #[test]
    fn test_scan_diff_allows_the_maintainers_github_handle() {
        let violations = scan_added_lines(&[
            "| 2 | [TDD Swarm kata](https://seanrobertwright.github.io/Quay-2/tutorials/swarm/tdd-swarm-kata/) | Build it. |",
            "git clone https://github.com/seanrobertwright/Quay-2.git",
        ]);
        assert!(violations.is_empty(), "unexpected violations: {:?}", violations.iter().map(|v| &v.message).collect::<Vec<_>>());
    }

    #[test]
    fn test_scan_diff_flags_the_username_as_a_path_segment() {
        let violations = scan_added_lines(&[
            "cd /c/Users/seanr/projects",
            "export HOME=/home/seanr",
            "owner: seanr",
        ]);
        assert_eq!(violations.len(), 3);
        assert!(violations.iter().all(|v| v.category == "leak_user_path" && v.severity == "blocker"));
    }

    #[test]
    fn test_scan_diff_flags_a_personal_email_address() {
        let violations = scan_added_lines(&["Contact: someone.else@gmail.com", "author = \"A Person <a.person@outlook.com>\""]);
        assert_eq!(violations.len(), 2);
        assert!(violations.iter().all(|v| v.category == "leak_user_path" && v.severity == "blocker"));
        assert!(violations[0].message.contains("email"));
    }

    #[test]
    fn test_scan_diff_allows_noreply_and_project_addresses() {
        let violations = scan_added_lines(&[
            "Co-Authored-By: Claude <noreply@anthropic.com>",
            "Report security issues to security@example.org",
        ]);
        assert!(violations.is_empty());
    }

    #[test]
    fn test_scan_diff_for_api_key_leak() {
        let diff = r#"
diff --git a/src/client.ts b/src/client.ts
--- a/src/client.ts
+++ b/src/client.ts
@@ -1,2 +1,3 @@
+const key = "sk-ant-api03-live-abcdef1234567890";
"#;
        let mut violations = Vec::new();
        let mut files = HashSet::new();
        scan_diff_content(diff, &mut violations, &mut files);

        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].severity, "blocker");
        assert_eq!(violations[0].category, "leak_secret");
    }
}
