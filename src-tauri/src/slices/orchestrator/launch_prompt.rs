use serde::Deserialize;

use crate::slices::pty::models::{BusLevel, RunKind};

/// One agent row of a swarm, as the launcher sends it.
#[derive(Debug, Clone, Deserialize)]
pub struct SwarmMember {
    pub name: String,
    pub role: String,
    pub run_kind: RunKind,
    #[serde(default)]
    pub role_prompt: Option<String>,
}

const QUAY_TOOLS_LINE: &str = "Reach your teammates with the quay_* tools: quay_list_agents, \
     quay_send_message, quay_broadcast and quay_get_agent_status.";

const ACKNOWLEDGE_AND_WAIT: &str = "Confirm your role in one line, then wait for the user's task. \
     Do not read or change the repository until the user tells you to.";

/// The launch prompt for each member of a swarm, in roster order, or `None` for a member
/// whose CLI takes no launch prompt. The team briefing is built from `members`, so it
/// names every teammate as the swarm actually launches them.
pub fn compose_launch_prompts(members: &[SwarmMember]) -> Vec<Option<String>> {
    members
        .iter()
        .enumerate()
        .map(|(index, member)| {
            member
                .run_kind
                .launch_prompt_form()
                .map(|_| compose_launch_prompt(members, index))
        })
        .collect()
}

/// Role line, role prompt, team briefing, then the acknowledge-and-wait instruction.
fn compose_launch_prompt(members: &[SwarmMember], index: usize) -> String {
    let member = &members[index];
    let role = role_of(member);
    let role_prompt = member
        .role_prompt
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("You are the {}.", role));

    let mut sections = vec![format!("Role: {}", role), role_prompt, team_briefing(members, index)];
    if member.run_kind.gets_quay_mcp() {
        sections.push(QUAY_TOOLS_LINE.to_string());
    }
    sections.push(ACKNOWLEDGE_AND_WAIT.to_string());
    sections.join("\n\n")
}

/// The member's role, or its session name when the role is left blank.
fn role_of(member: &SwarmMember) -> &str {
    let role = member.role.trim();
    if role.is_empty() {
        member.name.trim()
    } else {
        role
    }
}

fn team_briefing(members: &[SwarmMember], index: usize) -> String {
    let teammates: Vec<String> = members
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != index)
        .map(|(_, teammate)| format!("- {}", teammate_line(teammate)))
        .collect();
    if teammates.is_empty() {
        return "You have no teammates in this swarm.".to_string();
    }
    format!(
        "Your teammates in this swarm, by session name:\n{}",
        teammates.join("\n")
    )
}

/// One teammate's line in the team briefing: session name, CLI and role, then its bus
/// level from `RunKind::bus_level`, the test `quay_list_agents` uses. A teammate that is
/// not a peer gets no level.
fn teammate_line(teammate: &SwarmMember) -> String {
    let line = format!(
        "{} ({}, {})",
        teammate.name.trim(),
        teammate.run_kind.display_name(),
        role_of(teammate)
    );
    match teammate.run_kind.bus_level() {
        Some(level) => format!("{}: {}", line, level_sentence(level)),
        None => line,
    }
}

/// What the team briefing says a teammate at `level` can do.
fn level_sentence(level: BusLevel) -> &'static str {
    match level {
        BusLevel::FullPeer => "a full peer.",
        BusLevel::Responder => {
            "a responder. Ask it a short question with wait_for_reply set to true; \
             it can't message you first."
        }
        BusLevel::Listener => "a listener: it gets messages but can't answer.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(name: &str, role: &str, run_kind: RunKind) -> SwarmMember {
        SwarmMember {
            name: name.to_string(),
            role: role.to_string(),
            run_kind,
            role_prompt: None,
        }
    }

    #[test]
    fn a_claude_agent_gets_role_line_role_team_briefing_with_tools_then_wait() {
        let swarm = [
            member("lead-dev", "Lead Developer", RunKind::Claude),
            member("build-watcher", "Build & Test Watcher", RunKind::PowerShell),
        ];

        let prompts = compose_launch_prompts(&swarm);

        assert_eq!(
            prompts[0].as_deref(),
            Some(
                "Role: Lead Developer\n\
                 \n\
                 You are the Lead Developer.\n\
                 \n\
                 Your teammates in this swarm, by session name:\n\
                 - build-watcher (PowerShell, Build & Test Watcher)\n\
                 \n\
                 Reach your teammates with the quay_* tools: quay_list_agents, \
                 quay_send_message, quay_broadcast and quay_get_agent_status.\n\
                 \n\
                 Confirm your role in one line, then wait for the user's task. \
                 Do not read or change the repository until the user tells you to."
            )
        );
    }

    #[test]
    fn only_agents_with_the_quay_mcp_server_hear_of_the_quay_tools() {
        let mut reviewer = member("codex-reviewer", "Code Reviewer & Quality Gate", RunKind::Codex);
        reviewer.role_prompt = Some("You are the reviewer.\nYou own review.md.".to_string());
        let swarm = [
            member("claude-dev", "Primary Implementer", RunKind::Claude),
            member("agy-planner", "Architecture & Planner", RunKind::Antigravity),
            reviewer,
            member("test-runner", "Test & CI Shell", RunKind::PowerShell),
            member("gemini-docs", "Docs", RunKind::Gemini),
        ];

        let prompts = compose_launch_prompts(&swarm);

        assert_eq!(
            prompts[2].as_deref(),
            Some(
                "Role: Code Reviewer & Quality Gate\n\
                 \n\
                 You are the reviewer.\n\
                 You own review.md.\n\
                 \n\
                 Your teammates in this swarm, by session name:\n\
                 - claude-dev (Claude, Primary Implementer): a full peer.\n\
                 - agy-planner (Antigravity, Architecture & Planner): a responder. Ask it a short \
                 question with wait_for_reply set to true; it can't message you first.\n\
                 - test-runner (PowerShell, Test & CI Shell)\n\
                 - gemini-docs (Gemini, Docs): a listener: it gets messages but can't answer.\n\
                 \n\
                 Reach your teammates with the quay_* tools: quay_list_agents, \
                 quay_send_message, quay_broadcast and quay_get_agent_status.\n\
                 \n\
                 Confirm your role in one line, then wait for the user's task. \
                 Do not read or change the repository until the user tells you to."
            )
        );
        assert!(prompts[0].as_deref().unwrap().contains("quay_list_agents"));
        assert!(!prompts[4].as_deref().unwrap().contains("quay_list_agents"));
    }

    #[test]
    fn a_blank_role_prompt_box_gives_only_the_you_are_line() {
        let mut writer = member("writer", "Technical Writer", RunKind::Claude);
        writer.role_prompt = Some("\n   \n".to_string());
        let swarm = [writer, member("editor", "Editor", RunKind::Claude)];

        let prompts = compose_launch_prompts(&swarm);

        assert!(
            prompts[0]
                .as_deref()
                .unwrap()
                .starts_with("Role: Technical Writer\n\nYou are the Technical Writer.\n\nYour teammates"),
            "{:?}",
            prompts[0]
        );
    }

    #[test]
    fn clis_without_launch_prompt_support_get_none_but_stay_in_the_briefing() {
        let swarm = [
            member("claude-dev", "Primary Implementer", RunKind::Claude),
            member("agy-planner", "Planner", RunKind::Antigravity),
            member("grok", "Grok", RunKind::Grok),
            member("aider", "Aider", RunKind::Aider),
            member("shell", "Shell", RunKind::PowerShell),
            member("cmd", "Command", RunKind::Command),
        ];

        let prompts = compose_launch_prompts(&swarm);

        assert!(prompts[0].is_some());
        assert_eq!(prompts[1..], [None, None, None, None, None]);
        assert!(prompts[0]
            .as_deref()
            .unwrap()
            .contains("- agy-planner (Antigravity, Planner): a responder."));
    }

    #[test]
    fn the_briefing_names_each_teammate_level_from_the_level_test() {
        let swarm = [
            member("lead", "Lead", RunKind::Claude),
            member("codex-reviewer", "Reviewer", RunKind::Codex),
            member("gemini-docs", "Docs", RunKind::Gemini),
            member("workflow", "Workflow", RunKind::Archon),
        ];

        let lead = compose_launch_prompts(&swarm)[0].clone().unwrap();

        assert!(lead.contains("- codex-reviewer (Codex, Reviewer): a full peer.\n"), "{lead}");
        assert!(
            lead.contains("- gemini-docs (Gemini, Docs): a listener: it gets messages but can't answer.\n"),
            "{lead}"
        );
        assert!(lead.contains("- workflow (Archon, Workflow)\n"), "{lead}");
    }
}
