use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::{ClaudeStatus, TerminalInfo};

/// Resolves the target of a `quay_*` tool call: an exact terminal id, or an exact session
/// name. An id reaches any terminal, exited or not, in any project. A name matches live
/// terminals only, those in the caller's project first. Anything else is an error that
/// says why, and lists the peers when the target matches nothing.
pub fn resolve_target(
    target: &str,
    caller_id: Option<&str>,
    pty_manager: &PtyManager,
) -> Result<TerminalInfo, String> {
    let caller_project = caller_id
        .and_then(|id| pty_manager.get_info(id))
        .map(|info| info.project_path);
    match_target(target, caller_project.as_deref(), &pty_manager.list()).cloned()
}

/// The rule `resolve_target` applies, over a given set of terminals.
pub fn match_target<'a>(
    target: &str,
    caller_project: Option<&str>,
    terminals: &'a [TerminalInfo],
) -> Result<&'a TerminalInfo, String> {
    let target = target.trim();
    if target.is_empty() {
        return Err("No target given. Pass a peer's exact terminal ID or session name.".to_string());
    }

    if let Some(t) = terminals.iter().find(|t| t.id == target) {
        return Ok(t);
    }

    let named: Vec<&TerminalInfo> = terminals.iter().filter(|t| t.name == target).collect();
    let live: Vec<&TerminalInfo> = named
        .iter()
        .copied()
        .filter(|t| t.claude_status != ClaudeStatus::Exited)
        .collect();
    let in_caller_project: Vec<&TerminalInfo> = match caller_project {
        Some(project) => live
            .iter()
            .copied()
            .filter(|t| same_project(&t.project_path, project))
            .collect(),
        None => Vec::new(),
    };
    let candidates = if in_caller_project.is_empty() { live } else { in_caller_project };

    match candidates.as_slice() {
        [only] => Ok(only),
        [] if !named.is_empty() => Err(format!(
            "'{}' has exited; no live terminal has that session name. Exited: {}. \
             Ask the user to relaunch it, or pass its terminal ID to reach the exited terminal.",
            target,
            named.iter().map(|t| describe(t)).collect::<Vec<_>>().join(", ")
        )),
        [] => Err(format!(
            "No terminal has the ID or session name '{}'. Pass an exact terminal ID or session name. {}",
            target,
            peer_list(terminals)
        )),
        matches => Err(format!(
            "'{}' is ambiguous: {} live terminals share that name: {}. Pass the terminal ID instead.",
            target,
            matches.len(),
            matches.iter().map(|t| describe(t)).collect::<Vec<_>>().join(", ")
        )),
    }
}

/// The live peers, as an unknown target's error lists them.
fn peer_list(terminals: &[TerminalInfo]) -> String {
    let peers: Vec<String> = terminals
        .iter()
        .filter(|t| t.bus_level().is_some() && t.claude_status != ClaudeStatus::Exited)
        .map(describe)
        .collect();
    if peers.is_empty() {
        "There are no live peers.".to_string()
    } else {
        format!("Peers: {}.", peers.join(", "))
    }
}

fn describe(t: &TerminalInfo) -> String {
    format!("{} (id {}, project {})", t.name, t.id, t.project_path)
}

fn same_project(a: &str, b: &str) -> bool {
    fn normalize(p: &str) -> String {
        p.replace('\\', "/").trim_end_matches('/').to_lowercase()
    }
    normalize(a) == normalize(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::pty::models::{test_terminal, RunKind};

    fn terminal(id: &str, name: &str, project: &str, status: ClaudeStatus) -> TerminalInfo {
        let mut t = test_terminal(id, RunKind::Claude, status);
        t.name = name.to_string();
        t.project_path = project.to_string();
        t
    }

    const APP: &str = "E:\\Projects\\App";
    const OTHER: &str = "E:\\Projects\\Other";

    fn resolved(target: &str, caller_project: Option<&str>, terminals: &[TerminalInfo]) -> String {
        match_target(target, caller_project, terminals)
            .map(|t| t.id.clone())
            .unwrap_or_else(|e| panic!("'{target}' did not resolve: {e}"))
    }

    fn refused(target: &str, caller_project: Option<&str>, terminals: &[TerminalInfo]) -> String {
        match match_target(target, caller_project, terminals) {
            Ok(t) => panic!("'{target}' resolved to {} but should be refused", t.id),
            Err(e) => e,
        }
    }

    #[test]
    fn an_exact_id_resolves() {
        let ts = [terminal("term-1", "answerer", APP, ClaudeStatus::Idle)];
        assert_eq!(resolved("term-1", None, &ts), "term-1");
        assert_eq!(resolved("  term-1 ", None, &ts), "term-1");
    }

    #[test]
    fn an_exact_name_resolves() {
        let ts = [
            terminal("term-1", "asker", APP, ClaudeStatus::Idle),
            terminal("term-2", "answerer", APP, ClaudeStatus::Working),
        ];
        assert_eq!(resolved("answerer", Some(APP), &ts), "term-2");
    }

    #[test]
    fn run_kind_substring_prefix_and_case_variants_are_refused() {
        let ts = [terminal("term-abc", "answerer", APP, ClaudeStatus::Idle)];
        for target in ["claude", "answ", "swer", "term-a", "Answerer"] {
            let err = refused(target, None, &ts);
            assert!(err.contains("No terminal has the ID or session name"), "{err}");
        }
    }

    #[test]
    fn an_unknown_target_lists_the_live_peers() {
        let mut shell = test_terminal("term-sh", RunKind::PowerShell, ClaudeStatus::Unknown);
        shell.name = "shell".to_string();
        let ts = [
            terminal("term-1", "asker", APP, ClaudeStatus::Idle),
            terminal("term-2", "gone", APP, ClaudeStatus::Exited),
            shell,
        ];
        let err = refused("nobody", None, &ts);
        assert!(err.contains("'nobody'"), "{err}");
        assert!(err.contains("asker (id term-1"), "{err}");
        assert!(!err.contains("term-2"), "an exited terminal is not listed: {err}");
        assert!(!err.contains("term-sh"), "a shell is not a peer: {err}");
    }

    #[test]
    fn an_unknown_target_with_no_peers_says_so() {
        let err = refused("nobody", None, &[]);
        assert!(err.contains("There are no live peers."), "{err}");
    }

    #[test]
    fn an_empty_target_is_refused() {
        let ts = [terminal("term-1", "", APP, ClaudeStatus::Idle)];
        let err = refused("   ", None, &ts);
        assert!(err.contains("No target given"), "{err}");
    }

    #[test]
    fn a_name_two_live_terminals_share_is_ambiguous_and_lists_them() {
        let ts = [
            terminal("term-1", "worker", APP, ClaudeStatus::Idle),
            terminal("term-2", "worker", APP, ClaudeStatus::Working),
        ];
        let err = refused("worker", Some(APP), &ts);
        assert!(err.contains("ambiguous"), "{err}");
        assert!(err.contains("term-1") && err.contains("term-2"), "{err}");
        assert_eq!(resolved("term-2", Some(APP), &ts), "term-2");
    }

    #[test]
    fn an_exited_terminal_is_reachable_by_id_but_not_by_name() {
        let ts = [terminal("term-1", "answerer", APP, ClaudeStatus::Exited)];
        assert_eq!(resolved("term-1", Some(APP), &ts), "term-1");
        let err = refused("answerer", Some(APP), &ts);
        assert!(err.contains("'answerer' has exited"), "{err}");
        assert!(err.contains("id term-1"), "the error gives the id that still reaches it: {err}");
    }

    #[test]
    fn a_name_skips_its_exited_namesake_for_the_live_one() {
        // Startup restores every saved terminal as Exited under its old name.
        let ts = [
            terminal("term-old", "answerer", APP, ClaudeStatus::Exited),
            terminal("term-new", "answerer", APP, ClaudeStatus::Starting),
        ];
        assert_eq!(resolved("answerer", Some(APP), &ts), "term-new");
    }

    #[test]
    fn a_name_matches_in_the_callers_project_first() {
        let ts = [
            terminal("term-app", "reviewer", APP, ClaudeStatus::Idle),
            terminal("term-other", "reviewer", OTHER, ClaudeStatus::Idle),
        ];
        assert_eq!(resolved("reviewer", Some(APP), &ts), "term-app");
        assert_eq!(resolved("reviewer", Some(OTHER), &ts), "term-other");
        assert_eq!(resolved("reviewer", Some("e:/projects/app/"), &ts), "term-app");
        let err = refused("reviewer", None, &ts);
        assert!(err.contains("ambiguous"), "{err}");
    }

    #[test]
    fn a_name_found_only_in_another_project_still_resolves() {
        let ts = [terminal("term-other", "reviewer", OTHER, ClaudeStatus::Idle)];
        assert_eq!(resolved("reviewer", Some(APP), &ts), "term-other");
    }

    #[test]
    fn an_id_reaches_a_terminal_in_another_project() {
        let ts = [
            terminal("term-app", "reviewer", APP, ClaudeStatus::Idle),
            terminal("term-other", "reviewer", OTHER, ClaudeStatus::Idle),
        ];
        assert_eq!(resolved("term-other", Some(APP), &ts), "term-other");
    }

    #[test]
    fn a_name_two_other_projects_share_is_ambiguous() {
        let ts = [
            terminal("term-a", "reviewer", OTHER, ClaudeStatus::Idle),
            terminal("term-b", "reviewer", "E:\\Projects\\Third", ClaudeStatus::Idle),
        ];
        let err = refused("reviewer", Some(APP), &ts);
        assert!(err.contains("ambiguous"), "{err}");
    }

    #[test]
    fn resolve_target_scopes_by_the_callers_project() {
        let pty = PtyManager::new();
        pty.insert_test_terminal(terminal("term-tgt-caller", "tgt-asker", APP, ClaudeStatus::Idle));
        pty.insert_test_terminal(terminal("term-tgt-app", "tgt-reviewer", APP, ClaudeStatus::Idle));
        pty.insert_test_terminal(terminal("term-tgt-other", "tgt-reviewer", OTHER, ClaudeStatus::Idle));

        let found = resolve_target("tgt-reviewer", Some("term-tgt-caller"), &pty).unwrap();
        assert_eq!(found.id, "term-tgt-app");
        assert!(resolve_target("tgt-reviewer", None, &pty).is_err());
    }
}
