//! Which agent made a commit, and how Quay knows (#353, #381), from its `Quay-Agent` and
//! `Co-authored-by` trailer values. Trailer values are untrusted display text: only an unknown
//! stamp's value is kept, cut short, and the frontend shows it escaped.

use serde::Serialize;

use crate::slices::pty::models::RunKind;

/// How Quay knows a commit's agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentSource {
    /// A `Quay-Agent` trailer, which agent terminals add (#380).
    Stamp,
    /// A `Co-authored-by` email in [`COAUTHORS`].
    Coauthor,
}

/// A commit's agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    /// The agent's run kind, or `None` for a stamp naming no agent `RunKind`.
    pub kind: Option<RunKind>,
    pub source: AgentSource,
    /// An unknown stamp's value, for the tooltip only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

/// Co-author emails that name an agent. Rows are added only once a real CLI's trailer is seen.
const COAUTHORS: [(&str, RunKind); 1] = [("noreply@anthropic.com", RunKind::Claude)];

/// The most characters of an unknown stamp's value a row keeps.
const RAW_CHARS: usize = 64;

/// The agent kind a stamp names: an agent `RunKind`'s serde name. A shell or command kind isn't an
/// agent, since only agent terminals stamp.
fn stamped_kind(value: &str) -> Option<RunKind> {
    serde_json::from_value::<RunKind>(serde_json::Value::String(value.to_string()))
        .ok()
        .filter(RunKind::is_agent)
}

/// The email between a `Co-authored-by` value's angle brackets.
fn coauthor_email(value: &str) -> Option<&str> {
    let start = value.rfind('<')? + 1;
    let end = start + value[start..].find('>')?;
    Some(value[start..end].trim())
}

/// Classifies a commit from its trailer values, in message order: a known stamp, then an
/// unknown stamp, then a known co-author; `None` for a human commit.
pub fn classify<'a>(
    quay_agent: impl IntoIterator<Item = &'a str>,
    co_authored_by: impl IntoIterator<Item = &'a str>,
) -> Option<Agent> {
    let mut unknown = None;
    for value in quay_agent {
        if let Some(kind) = stamped_kind(value) {
            return Some(Agent { kind: Some(kind), source: AgentSource::Stamp, raw: None });
        }
        unknown.get_or_insert(value);
    }
    if let Some(value) = unknown {
        let raw = value.chars().filter(|c| !c.is_control()).take(RAW_CHARS).collect();
        return Some(Agent { kind: None, source: AgentSource::Stamp, raw: Some(raw) });
    }
    co_authored_by.into_iter().filter_map(coauthor_email).find_map(|email| {
        COAUTHORS
            .iter()
            .find(|(known, _)| known.eq_ignore_ascii_case(email))
            .map(|&(_, kind)| Agent { kind: Some(kind), source: AgentSource::Coauthor, raw: None })
    })
}
