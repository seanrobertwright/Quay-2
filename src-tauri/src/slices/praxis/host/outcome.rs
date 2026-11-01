//! What a `praxis --json` call means (#228, #362): its record, checked against the format Quay
//! reads for that command, or a typed reason it has none, and the host condition that follows.

use serde::Serialize;
use serde_json::Value;

/// The `praxis` commands Quay runs headless.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verb {
    WorkflowsList,
    WorkflowsShow,
    Runs,
    Status,
    Run,
}

impl Verb {
    /// The record format Quay reads from this command's stdout on exit 0.
    pub fn format(self) -> &'static str {
        match self {
            Verb::WorkflowsList | Verb::WorkflowsShow => "aiws-workflow-catalog/1",
            Verb::Runs => "aiws-workflow-runs/1",
            // The operator view isn't a contracted read model (#361). Only its format is checked
            // here; the builder reads the fields it draws leniently.
            Verb::Status => "coding-operator-view/1",
            Verb::Run => "aiws-workflow-run-result/1",
        }
    }

    /// Whether this command creates a run, rather than reads.
    pub fn creates(self) -> bool {
        self == Verb::Run
    }

    /// The words that name this command to `praxis`, before its operands.
    pub fn words(self) -> &'static [&'static str] {
        match self {
            Verb::WorkflowsList => &["workflows", "list"],
            Verb::WorkflowsShow => &["workflows", "show"],
            Verb::Runs => &["runs"],
            Verb::Status => &["status"],
            Verb::Run => &["run"],
        }
    }

    /// This command's arguments: its [`words`](Self::words), then `operands`. A command that
    /// takes a workflow template name (`workflows show`, `runs` and `run`) takes it as its first
    /// operand.
    pub fn args(self, operands: impl IntoIterator<Item = String>) -> Vec<String> {
        self.words().iter().map(|w| w.to_string()).chain(operands).collect()
    }

    /// Where in [`args`](Self::args) the workflow template name is, for the commands that take
    /// one: right after the command's words.
    pub fn template_arg(self) -> Option<usize> {
        match self {
            Verb::WorkflowsShow | Verb::Runs | Verb::Run => Some(self.words().len()),
            Verb::WorkflowsList | Verb::Status => None,
        }
    }
}

/// The record format `praxis run` prints with exit 7.
pub const RUN_ERROR_FORMAT: &str = "aiws-workflow-run-error/1";

/// The outcome of one call, as the frontend receives it: `{ "kind": "record", "record": {…} }`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CallOutcome {
    /// Exit 0 with a record in the format Quay reads for the command. For `status`, `trust_hint`
    /// is the certificate hint `praxis` writes on stderr while the run waits for a browser
    /// decision and the browser may not trust the host's certificate; it is left out when absent.
    Record {
        record: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        trust_hint: Option<String>,
    },
    /// `praxis run` exit 7: a held run, or one awaiting approval, blocks new runs.
    Blocked { record: Value, blocking_run_address: String },
    /// Exit 2, or a record Quay doesn't read: "Quay needs an update for this praxis".
    NeedsUpdate { detail: String },
    /// The installation has no connection descriptor: no host has been set up.
    NoHost { message: String },
    /// Nothing answered at the host's address.
    HostDown { message: String },
    /// The profile holds no session for this host.
    NotSignedIn { message: String },
    /// The host refused the profile's session.
    Expired { message: String },
    /// Any other failure, with `praxis`'s own words.
    Refused { message: String },
    /// `praxis` couldn't be found or started, or Node is older than 24.
    CliNotFound { reason: String },
    /// Quay's own timeout passed and the call was killed.
    TimedOut,
    /// The caller cancelled.
    Cancelled,
}

/// What the builder knows about a project's Praxis host (#362 "Reconciled with #363"), as the
/// frontend receives it: `{ "state": "signedIn" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum HostCondition {
    NotCheckedYet,
    /// The CLI isn't linked, or Node is older than 24.
    CliNotFound { reason: String },
    NoHostSetUp,
    HostUnreachable,
    NotSignedIn,
    SignedIn,
    /// A host whose identity is simulated, so its decisions aren't a person's.
    SimulatedHost,
}

/// Which exit-1 condition a stable phrase of `praxis`'s stderr names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phrase {
    NoHost,
    HostDown,
    NotSignedIn,
    Expired,
}

/// The stable phrases `praxis` prints on stderr with exit 1, at the pinned SDK commit
/// (`engine/src/praxis-client.ts`). This is the one place they live, so it can go once
/// AI-WS-SDK #327 writes errors as a JSON record.
const PHRASES: [(&str, Phrase); 5] = [
    ("There is no Praxis host connection descriptor at", Phrase::NoHost),
    ("; is it running?", Phrase::HostDown),
    ("There is no CLI session for this host", Phrase::NotSignedIn),
    ("There is no simulated CLI session for this host", Phrase::NotSignedIn),
    ("The host did not accept the CLI session", Phrase::Expired),
];

/// The words every certificate hint of `praxis status` holds (`trustHint` in
/// `engine/src/praxis-follow.ts` at the pinned SDK commit).
const TRUST_HINT_PHRASE: &str = "this host's certificate";

/// The certificate hint on `stderr`, the first line holding [`TRUST_HINT_PHRASE`].
fn trust_hint(stderr: &str) -> Option<String> {
    stderr.lines().map(str::trim).find(|line| line.contains(TRUST_HINT_PHRASE)).map(str::to_string)
}

/// `praxis`'s stderr, trimmed, or a stand-in when it printed nothing.
fn message(stderr: &str, code: i32) -> String {
    let text = stderr.trim();
    if text.is_empty() { format!("praxis exited with {code} and printed nothing.") } else { text.to_string() }
}

/// The record on `stdout`, when it is one JSON object in `format`.
fn record(stdout: &[u8], format: &str) -> Result<Value, CallOutcome> {
    let value: Value = serde_json::from_slice(stdout)
        .map_err(|_| CallOutcome::NeedsUpdate { detail: "praxis printed something other than a JSON record.".into() })?;
    match value.get("format").and_then(Value::as_str) {
        Some(found) if found == format => Ok(value),
        Some(found) => Err(CallOutcome::NeedsUpdate { detail: format!("praxis printed a {found} record, and this Quay reads {format}.") }),
        None => Err(CallOutcome::NeedsUpdate { detail: format!("praxis printed a record with no format, and this Quay reads {format}.") }),
    }
}

/// What a `praxis <verb> --json` that exited with `code` means.
pub fn interpret(verb: Verb, code: Option<i32>, stdout: &[u8], stderr: &str) -> CallOutcome {
    let Some(code) = code else {
        return CallOutcome::Refused { message: format!("praxis was stopped before it finished. {}", stderr.trim()).trim_end().to_string() };
    };
    match code {
        0 => record(stdout, verb.format()).map_or_else(
            |o| o,
            |record| CallOutcome::Record { record, trust_hint: if verb == Verb::Status { trust_hint(stderr) } else { None } },
        ),
        1 => {
            let message = message(stderr, code);
            match PHRASES.iter().find(|(phrase, _)| message.contains(phrase)).map(|(_, kind)| *kind) {
                Some(Phrase::NoHost) => CallOutcome::NoHost { message },
                Some(Phrase::HostDown) => CallOutcome::HostDown { message },
                Some(Phrase::NotSignedIn) => CallOutcome::NotSignedIn { message },
                Some(Phrase::Expired) => CallOutcome::Expired { message },
                None => CallOutcome::Refused { message },
            }
        }
        2 => CallOutcome::NeedsUpdate { detail: format!("praxis didn't accept Quay's arguments: {}", message(stderr, code)) },
        7 if verb.creates() => match record(stdout, RUN_ERROR_FORMAT) {
            Ok(record) => match record.get("blockingRunAddress").and_then(Value::as_str) {
                Some(address) => CallOutcome::Blocked { blocking_run_address: address.to_string(), record },
                None => CallOutcome::NeedsUpdate { detail: "praxis refused the run without naming the run that blocks it.".into() },
            },
            Err(outcome) => outcome,
        },
        _ => CallOutcome::Refused { message: format!("praxis exited with {code}. {}", message(stderr, code)) },
    }
}

/// The host condition `outcome` shows, or `None` when it says nothing new about the host: a
/// refusal, a timeout, a cancel or a record Quay can't read leave the last condition standing.
pub fn condition_after(outcome: &CallOutcome) -> Option<HostCondition> {
    let simulated = |record: &Value| record.get("simulatedIdentity") == Some(&Value::Bool(true));
    match outcome {
        CallOutcome::Record { record, .. } | CallOutcome::Blocked { record, .. } => {
            Some(if simulated(record) { HostCondition::SimulatedHost } else { HostCondition::SignedIn })
        }
        CallOutcome::NoHost { .. } => Some(HostCondition::NoHostSetUp),
        CallOutcome::HostDown { .. } => Some(HostCondition::HostUnreachable),
        CallOutcome::NotSignedIn { .. } | CallOutcome::Expired { .. } => Some(HostCondition::NotSignedIn),
        CallOutcome::CliNotFound { reason } => Some(HostCondition::CliNotFound { reason: reason.clone() }),
        CallOutcome::NeedsUpdate { .. } | CallOutcome::Refused { .. } | CallOutcome::TimedOut | CallOutcome::Cancelled => None,
    }
}
