//! The gate: commits the candidate, checks which files changed, runs the pre-PR audit,
//! then the configured Tier 1 and Tier 2 commands, and reaches a verdict.
//!
//! Verdicts: PASS when every step passed; FAIL when the candidate itself is wrong (a
//! check failed, a file is out of scope or protected, the audit found blockers, or
//! nothing changed); INCONCLUSIVE when the gate could not judge (no Tier 1 checks,
//! timeouts, cancelled, or a git, config or audit error). A FAIL outranks an
//! INCONCLUSIVE, because the author can act on it.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use super::config::{
    load_config_pinned, unapproved_reason, FactoryConfig, GateCommand, FACTORY_MANAGED,
};
use super::git;
use super::models::{AuditSummary, CheckOutcome, CheckResult, GateReport, GateVerdict};
use super::paths::matches_any;
use super::runner::{run_shell, tail};
use super::vault;
use crate::dates::now_ms;
use crate::slices::audit::commands::run_pre_pr_audit_sync;

const OUTPUT_TAIL_CHARS: usize = 8_000;
const MAX_AUDIT_FINDINGS: usize = 50;

pub struct GateInput {
    pub wo_id: String,
    pub attempt: u32,
    pub repo_root: PathBuf,
    pub worktree: PathBuf,
    pub base_sha: String,
    pub allowed: Vec<String>,
    pub vault_root: PathBuf,
    pub vault_sha: Option<String>,
    pub vault_file_count: usize,
    /// SHA-256 of the factory.json the operator approved for this repository.
    pub approved_config_sha: Option<String>,
}

/// Runs one configured command and records it. Tier 2 output is reduced to
/// `HOLDOUT_FAIL:` lines for the author; the raw tail goes to `operator_output`.
pub fn run_check(
    tier: u8,
    cmd: &GateCommand,
    cwd: &Path,
    env: &[(&str, String)],
    timeout: Duration,
    cancel: &AtomicBool,
) -> CheckResult {
    let run = run_shell(cwd, &cmd.run, env, timeout, cancel);
    let outcome = if run.spawn_error.is_some() || run.cancelled {
        CheckOutcome::ERROR
    } else if run.timed_out {
        CheckOutcome::TIMEOUT
    } else if run.exit_code == Some(0) {
        CheckOutcome::PASS
    } else {
        CheckOutcome::FAIL
    };
    let mut raw = run.output.clone();
    if let Some(e) = &run.spawn_error {
        raw.push_str(e);
    }
    if run.cancelled {
        raw.push_str("\n[cancelled]");
    }
    if run.timed_out {
        raw.push_str(&format!("\n[timed out after {}s]", timeout.as_secs()));
    }

    let (output, operator_output) = if tier == 2 {
        let markers = vault::sanitize_tier2_output(&raw);
        let shown = match outcome {
            CheckOutcome::PASS => "Passed.".to_string(),
            _ if !markers.is_empty() => markers.join("\n"),
            CheckOutcome::TIMEOUT => format!(
                "Holdback check '{}' timed out. Details are withheld from the author.",
                cmd.name
            ),
            _ => format!(
                "Holdback check '{}' did not pass{}. Details are withheld from the author.",
                cmd.name,
                run.exit_code.map(|c| format!(" (exit code {})", c)).unwrap_or_default()
            ),
        };
        (shown, Some(tail(&raw, OUTPUT_TAIL_CHARS)))
    } else {
        (tail(&raw, OUTPUT_TAIL_CHARS), None)
    };

    CheckResult {
        tier,
        name: cmd.name.clone(),
        command: cmd.run.clone(),
        outcome,
        exit_code: run.exit_code,
        duration_ms: run.duration_ms,
        output,
        operator_output,
    }
}

fn skipped(tier: u8, cmd: &GateCommand, why: &str) -> CheckResult {
    CheckResult {
        tier,
        name: cmd.name.clone(),
        command: cmd.run.clone(),
        outcome: CheckOutcome::SKIPPED,
        exit_code: None,
        duration_ms: 0,
        output: why.to_string(),
        operator_output: None,
    }
}

fn describe(c: &CheckResult, timeout: Duration) -> String {
    let tier = if c.tier == 2 { "Tier 2" } else { "Tier 1" };
    match c.outcome {
        CheckOutcome::FAIL => format!(
            "{} check '{}' failed{}",
            tier,
            c.name,
            c.exit_code.map(|e| format!(" (exit code {})", e)).unwrap_or_default()
        ),
        CheckOutcome::TIMEOUT => format!(
            "{} check '{}' timed out after {}s",
            tier,
            c.name,
            timeout.as_secs()
        ),
        CheckOutcome::ERROR => format!("{} check '{}' could not run", tier, c.name),
        _ => String::new(),
    }
}

struct Verdicts {
    failures: Vec<String>,
    inconclusive: Vec<String>,
}

impl Verdicts {
    fn finish(self, mut report: GateReport) -> GateReport {
        report.finished_at_ms = now_ms();
        if !self.failures.is_empty() {
            report.verdict = GateVerdict::FAIL;
            report.reasons = self.failures;
            report.reasons.extend(self.inconclusive);
        } else if !self.inconclusive.is_empty() {
            report.verdict = GateVerdict::INCONCLUSIVE;
            report.reasons = self.inconclusive;
        } else {
            report.verdict = GateVerdict::PASS;
            report.reasons = vec!["Every check passed.".to_string()];
        }
        report
    }
}

fn audit_summary(rep: &crate::slices::audit::models::AuditReport) -> AuditSummary {
    // Snippets are left out on purpose: they can contain the secret that was found.
    let findings = rep
        .violations
        .iter()
        .filter(|v| v.severity == "blocker" || v.severity == "warning")
        .take(MAX_AUDIT_FINDINGS)
        .map(|v| {
            format!(
                "[{}] {} in {}{}: {}",
                v.severity,
                v.category,
                v.file_path,
                v.line_number.map(|n| format!(":{}", n)).unwrap_or_default(),
                v.message
            )
        })
        .collect();
    AuditSummary {
        passed: rep.passed,
        blocker_count: rep.blocker_count,
        warning_count: rep.warning_count,
        findings,
    }
}

pub fn run_gate(input: &GateInput, cancel: &AtomicBool) -> GateReport {
    let mut report = GateReport {
        attempt: input.attempt,
        started_at_ms: now_ms(),
        finished_at_ms: 0,
        candidate_sha: String::new(),
        verdict: GateVerdict::INCONCLUSIVE,
        reasons: Vec::new(),
        changed_files: Vec::new(),
        scope_violations: Vec::new(),
        protected_violations: Vec::new(),
        audit: None,
        checks: Vec::new(),
    };
    let mut v = Verdicts {
        failures: Vec::new(),
        inconclusive: Vec::new(),
    };

    // The gate definition comes from the main checkout, never from the worktree, and
    // its commands run only if the operator approved these exact bytes.
    let cfg: FactoryConfig = match load_config_pinned(&input.repo_root) {
        Ok(loaded) => {
            if let Some(why) = unapproved_reason(&loaded, input.approved_config_sha.as_deref()) {
                v.inconclusive.push(why);
                return v.finish(report);
            }
            loaded.config
        }
        Err(e) => {
            v.inconclusive.push(e);
            return v.finish(report);
        }
    };
    let wt = &input.worktree;
    if !wt.is_dir() {
        v.inconclusive.push(format!("The worktree {} is missing.", wt.display()));
        return v.finish(report);
    }

    // 1. Commit the candidate so the verdict applies to one exact commit.
    let message = format!(
        "machina({}): candidate for gate attempt {}",
        input.wo_id, input.attempt
    );
    if let Err(e) = git::commit_all(wt, &message, &FACTORY_MANAGED) {
        v.inconclusive.push(format!("Could not commit the candidate: {}", e));
        return v.finish(report);
    }
    match git::head_sha(wt) {
        Ok(sha) => report.candidate_sha = sha,
        Err(e) => {
            v.inconclusive.push(e);
            return v.finish(report);
        }
    }

    // 2. Scope and protected paths, over everything the branch changed.
    match git::changed_files(wt, &input.base_sha, &report.candidate_sha) {
        Ok(files) => report.changed_files = files,
        Err(e) => {
            v.inconclusive.push(e);
            return v.finish(report);
        }
    }
    if report.changed_files.is_empty() {
        v.failures
            .push("The branch has no changes relative to its base commit.".to_string());
    }
    let protected = cfg.effective_protected();
    for f in &report.changed_files {
        if matches_any(&protected, f) {
            report.protected_violations.push(f.clone());
        } else if !matches_any(&input.allowed, f) {
            report.scope_violations.push(f.clone());
        }
    }
    if !report.protected_violations.is_empty() {
        v.failures.push(format!(
            "{} changed file(s) are protected: {}",
            report.protected_violations.len(),
            report.protected_violations.join(", ")
        ));
    }
    if !report.scope_violations.is_empty() {
        v.failures.push(format!(
            "{} changed file(s) are outside the allowed output paths: {}",
            report.scope_violations.len(),
            report.scope_violations.join(", ")
        ));
    }

    // 3. Pre-PR secret and leak audit over the branch diff.
    match run_pre_pr_audit_sync(&wt.to_string_lossy(), Some(&input.base_sha)) {
        Ok(rep) => {
            let summary = audit_summary(&rep);
            if !summary.passed {
                v.failures.push(format!(
                    "The pre-PR audit found {} blocker(s).",
                    summary.blocker_count
                ));
            }
            report.audit = Some(summary);
        }
        Err(e) => v.inconclusive.push(format!("The pre-PR audit could not run: {}", e)),
    }

    let timeout = Duration::from_secs(cfg.timeout_sec);
    let base_env = vec![
        ("MACHINA_WORK_ORDER", input.wo_id.clone()),
        ("MACHINA_WORKTREE", wt.to_string_lossy().to_string()),
    ];

    // 4. Tier 1, all commands, so the author sees every failure at once.
    if cfg.tier1.is_empty() {
        v.inconclusive.push(format!(
            "No tier1 checks are configured in {}; the gate cannot judge the build.",
            super::config::CONFIG_REL_PATH
        ));
    }
    let mut tier1_ok = true;
    for cmd in &cfg.tier1 {
        if cancel.load(Ordering::SeqCst) {
            report.checks.push(skipped(1, cmd, "Skipped: the gate was cancelled."));
            tier1_ok = false;
            continue;
        }
        let c = run_check(1, cmd, wt, &base_env, timeout, cancel);
        match c.outcome {
            CheckOutcome::PASS => {}
            CheckOutcome::FAIL => {
                tier1_ok = false;
                v.failures.push(describe(&c, timeout));
            }
            _ => {
                tier1_ok = false;
                v.inconclusive.push(describe(&c, timeout));
            }
        }
        report.checks.push(c);
    }

    // 5. Tier 2 with the holdbacks restored, only on a green Tier 1.
    if !tier1_ok {
        for cmd in &cfg.tier2 {
            report
                .checks
                .push(skipped(2, cmd, "Skipped: Tier 1 did not pass."));
        }
    } else if cfg.tier2.is_empty() {
        if input.vault_file_count > 0 {
            v.inconclusive.push(format!(
                "{} holdback file(s) are vaulted but no tier2 commands are configured to run them.",
                input.vault_file_count
            ));
        }
    } else {
        let restored = match &input.vault_sha {
            Some(sha) => vault::restore_into(&input.vault_root, &input.wo_id, sha, wt),
            None => Err("This work order has no vault.".to_string()),
        };
        match restored {
            Err(e) => {
                v.inconclusive.push(e);
                for cmd in &cfg.tier2 {
                    report
                        .checks
                        .push(skipped(2, cmd, "Skipped: the holdbacks could not be restored."));
                }
            }
            Ok(dir) => {
                let mut env = base_env.clone();
                env.push(("MACHINA_HOLDBACKS", dir.to_string_lossy().to_string()));
                for cmd in &cfg.tier2 {
                    if cancel.load(Ordering::SeqCst) {
                        report.checks.push(skipped(2, cmd, "Skipped: the gate was cancelled."));
                        continue;
                    }
                    let c = run_check(2, cmd, wt, &env, timeout, cancel);
                    match c.outcome {
                        CheckOutcome::PASS => {}
                        CheckOutcome::FAIL => v.failures.push(describe(&c, timeout)),
                        _ => v.inconclusive.push(describe(&c, timeout)),
                    }
                    report.checks.push(c);
                }
                // The author must never find the holdbacks in the worktree afterwards.
                if let Err(e) = vault::remove_restored(wt) {
                    v.inconclusive.push(format!(
                        "The restored holdbacks could not be removed from the worktree ({}). Remove {} by hand before the author continues.",
                        e,
                        super::config::HOLDBACKS_REL_DIR
                    ));
                }
            }
        }
    }

    if cancel.load(Ordering::SeqCst) {
        v.inconclusive.push("The gate was cancelled.".to_string());
    }
    v.finish(report)
}
