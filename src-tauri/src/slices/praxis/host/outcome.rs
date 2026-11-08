//! What a `praxis --json` call means (#228, #362): its record, checked against the format Quay
//! reads for that command, or a typed reason it has none, and the host condition that follows.

use serde::Serialize;
use serde_json::Value;

/// The `praxis` commands Quay runs headless: the template commands (#446) and the graph
/// commands (#460), whose names, records and exits are those of `praxis` in AI-WS-SDK
/// `GRAPH-WORKFLOWS.md`, "The praxis commands".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verb {
    WorkflowsList,
    WorkflowsShow,
    Runs,
    Status,
    Run,
    /// `praxis graphs list`: the host's graph workflows, in name order.
    GraphsList,
    /// `praxis graphs show <name>`: one graph workflow with its newest revisions.
    GraphsShow,
    /// `praxis graphs show <name> --before <revision>`: a page of older revisions.
    GraphsRevisions,
    /// `praxis graphs withdraw <name> <revision>`: withdraws a pending candidate.
    GraphsWithdraw,
    /// `praxis run <name>`: creates a run of the graph workflow's current admitted revision.
    /// `praxis run` tries a template of the name first, so a template and a graph workflow of
    /// one name run the template, and this reads its result as a record Quay doesn't read.
    GraphRun,
    /// `praxis runs <name> --format aiws-graph-runs/1`: a graph workflow's runs, newest first.
    GraphRuns,
    /// `praxis status <workOrderId> --format aiws-graph-operator-view/1`: one graph run.
    GraphStatus,
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
            Verb::GraphsList => "aiws-graph-workflows/1",
            Verb::GraphsShow => "aiws-graph-workflow/1",
            Verb::GraphsRevisions => "aiws-graph-workflow-revisions/1",
            Verb::GraphsWithdraw => "aiws-graph-workflow-withdraw-result/1",
            Verb::GraphRun => "aiws-graph-run-result/1",
            Verb::GraphRuns => "aiws-graph-runs/1",
            Verb::GraphStatus => "aiws-graph-operator-view/1",
        }
    }

    /// Whether this command changes the host, so it has the longer timeout, and a failure Quay
    /// can't read leaves its outcome unknown rather than refused. `praxis` resends each of them
    /// while their outcome is unknown.
    pub fn writes(self) -> bool {
        matches!(self, Verb::Run | Verb::GraphsWithdraw | Verb::GraphRun)
    }

    /// The record format of the refusal `praxis run` prints with exit 7, when an earlier run that
    /// needs a person blocks a new one.
    fn blocked_format(self) -> Option<&'static str> {
        match self {
            Verb::Run => Some(RUN_ERROR_FORMAT),
            Verb::GraphRun => Some(GRAPH_RUN_ERROR_FORMAT),
            _ => None,
        }
    }

    /// Whether this command is `praxis status`, which may write a certificate hint on stderr.
    fn reads_status(self) -> bool {
        matches!(self, Verb::Status | Verb::GraphStatus)
    }

    /// The words that name this command to `praxis`, before its operands.
    pub fn words(self) -> &'static [&'static str] {
        match self {
            Verb::WorkflowsList => &["workflows", "list"],
            Verb::WorkflowsShow => &["workflows", "show"],
            Verb::Runs | Verb::GraphRuns => &["runs"],
            Verb::Status | Verb::GraphStatus => &["status"],
            Verb::Run | Verb::GraphRun => &["run"],
            Verb::GraphsList => &["graphs", "list"],
            Verb::GraphsShow | Verb::GraphsRevisions => &["graphs", "show"],
            Verb::GraphsWithdraw => &["graphs", "withdraw"],
        }
    }

    /// Whether `praxis` is asked for this command's [`format`](Self::format) by name, with
    /// `--format`, so a host that doesn't serve it is refused with exit 8 rather than answered
    /// in another format. The graph reads, which take `--format`, pin it; `runs` and `status`
    /// need it to read a graph workflow's record rather than a template's. The template
    /// commands keep the CLI's default.
    fn pins_format(self) -> bool {
        matches!(self, Verb::GraphsList | Verb::GraphsShow | Verb::GraphsRevisions | Verb::GraphRuns | Verb::GraphStatus)
    }

    /// This command's arguments: its [`words`](Self::words), then `operands`, then `--format`
    /// with its format when it [pins](Self::pins_format) one. A command that takes a workflow
    /// template name (`workflows show`, `runs` and `run`) takes it as its first operand.
    pub fn args(self, operands: impl IntoIterator<Item = String>) -> Vec<String> {
        let pin = self.pins_format().then(|| ["--format".to_string(), self.format().to_string()]);
        self.words().iter().map(|w| w.to_string()).chain(operands).chain(pin.into_iter().flatten()).collect()
    }

    /// Where in [`args`](Self::args) the workflow template name is, for the commands that take
    /// one: right after the command's words.
    pub fn template_arg(self) -> Option<usize> {
        match self {
            Verb::WorkflowsShow | Verb::Runs | Verb::Run => Some(self.words().len()),
            _ => None,
        }
    }
}

/// The record format `praxis run` prints with exit 7.
pub const RUN_ERROR_FORMAT: &str = "aiws-workflow-run-error/1";

/// The record format `praxis run` prints with exit 7 for a graph workflow.
pub const GRAPH_RUN_ERROR_FORMAT: &str = "aiws-graph-run-error/1";

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
    /// The host refused the request, as a `praxis-error/1` record says: `host_code` is the
    /// host's own refusal code, such as `NOT_FOUND`, and `record` the whole error record.
    HostRefused { message: String, host_code: String, record: Value },
    /// Any other failure, with `praxis`'s own words.
    Refused { message: String },
    /// `praxis` couldn't be found or started, or Node is older than 24.
    CliNotFound { reason: String },
    /// A run creation ended in a way that doesn't say whether the run was created: `praxis`
    /// stopped without an exit code, or exited with a code `run` doesn't document. Its pending
    /// creation stays in the profile, so the next `run` of the name resumes it (#361).
    Unknown { detail: String },
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

/// A failure Quay can't read further: a refusal, except for a creation, where it can't tell whether
/// the run was created.
fn unread_failure(verb: Verb, text: String) -> CallOutcome {
    if verb.writes() {
        CallOutcome::Unknown { detail: text }
    } else {
        CallOutcome::Refused { message: text }
    }
}

/// The record format a `--json` command prints on stdout for a failure, beside its message on
/// stderr (`engine/src/praxis-error.ts`), from the CLI that has the graph commands on.
pub const PRAXIS_ERROR_FORMAT: &str = "praxis-error/1";

/// The `praxis-error/1` record on `stdout`, when there is one with the `code` and `message` Quay
/// reads. A CLI from before the record prints nothing on stdout for a failure.
fn praxis_error(stdout: &[u8]) -> Option<(Value, String, String)> {
    let record: Value = serde_json::from_slice(stdout).ok()?;
    if record.get("format").and_then(Value::as_str) != Some(PRAXIS_ERROR_FORMAT) {
        return None;
    }
    let code = record.get("code").and_then(Value::as_str)?.to_string();
    let message = record.get("message").and_then(Value::as_str)?.to_string();
    Some((record, code, message))
}

/// What a `praxis-error/1` record means, by its `code`, or `None` for a code this Quay doesn't
/// know, which the record says to handle by the exit code. The record has no code of its own for
/// a missing connection descriptor, an `ENGINE` failure, so that one is still told by its phrase.
/// An `AUTHENTICATION` failure that carries the host's code is the host refusing the session; one
/// without it is the profile holding none.
fn from_error_record(record: &Value, code: &str, message: String) -> Option<CallOutcome> {
    let host_code = record.get("hostCode").and_then(Value::as_str);
    Some(match code {
        "USAGE" => CallOutcome::NeedsUpdate { detail: format!("praxis didn't accept Quay's arguments: {message}") },
        "CONNECTION" => CallOutcome::HostDown { message },
        "AUTHENTICATION" if host_code.is_some() => CallOutcome::Expired { message },
        "AUTHENTICATION" => CallOutcome::NotSignedIn { message },
        "ENGINE" => match (host_code, phrase(&message)) {
            (Some(host_code), _) => CallOutcome::HostRefused { message, host_code: host_code.to_string(), record: record.clone() },
            (None, Some(Phrase::NoHost)) => CallOutcome::NoHost { message },
            (None, _) => CallOutcome::Refused { message },
        },
        _ => return None,
    })
}

/// The exit-1 condition a stable phrase of `message` names, if any.
fn phrase(message: &str) -> Option<Phrase> {
    PHRASES.iter().find(|(phrase, _)| message.contains(phrase)).map(|(_, kind)| *kind)
}

/// What a `praxis <verb> --json` that exited with `code` means. A failure is read from the
/// `praxis-error/1` record when the CLI prints one, and from its stderr phrases when it doesn't.
pub fn interpret(verb: Verb, code: Option<i32>, stdout: &[u8], stderr: &str) -> CallOutcome {
    let Some(code) = code else {
        return unread_failure(verb, format!("praxis was stopped before it finished. {}", stderr.trim()).trim_end().to_string());
    };
    match code {
        0 => record(stdout, verb.format()).map_or_else(
            |o| o,
            |record| CallOutcome::Record { record, trust_hint: if verb.reads_status() { trust_hint(stderr) } else { None } },
        ),
        7 if let Some(format) = verb.blocked_format() => match record(stdout, format) {
            Ok(record) => match record.get("blockingRunAddress").and_then(Value::as_str) {
                Some(address) => CallOutcome::Blocked { blocking_run_address: address.to_string(), record },
                None => CallOutcome::NeedsUpdate { detail: "praxis refused the run without naming the run that blocks it.".into() },
            },
            Err(outcome) => outcome,
        },
        _ => match praxis_error(stdout).and_then(|(record, kind, message)| from_error_record(&record, &kind, message)) {
            Some(outcome) => outcome,
            None => by_exit(verb, code, stderr),
        },
    }
}

/// What a failure means by its exit code and the phrases of its stderr alone.
fn by_exit(verb: Verb, code: i32, stderr: &str) -> CallOutcome {
    match code {
        1 => {
            let message = message(stderr, code);
            match phrase(&message) {
                Some(Phrase::NoHost) => CallOutcome::NoHost { message },
                Some(Phrase::HostDown) => CallOutcome::HostDown { message },
                Some(Phrase::NotSignedIn) => CallOutcome::NotSignedIn { message },
                Some(Phrase::Expired) => CallOutcome::Expired { message },
                None => CallOutcome::Refused { message },
            }
        }
        2 => CallOutcome::NeedsUpdate { detail: format!("praxis didn't accept Quay's arguments: {}", message(stderr, code)) },
        _ => unread_failure(verb, format!("praxis exited with {code}. {}", message(stderr, code))),
    }
}

/// The host condition `outcome` shows, or `None` when it says nothing new about the host. A
/// record, and a refusal that carries the host's code, show the host answered this session. A
/// refusal without one, an unknown creation outcome, a timeout, a cancel or a record Quay can't read leave
/// the last condition standing.
pub fn condition_after(outcome: &CallOutcome) -> Option<HostCondition> {
    let simulated = |record: &Value| record.get("simulatedIdentity") == Some(&Value::Bool(true));
    match outcome {
        CallOutcome::Record { record, .. } | CallOutcome::Blocked { record, .. } | CallOutcome::HostRefused { record, .. } => {
            Some(if simulated(record) { HostCondition::SimulatedHost } else { HostCondition::SignedIn })
        }
        CallOutcome::NoHost { .. } => Some(HostCondition::NoHostSetUp),
        CallOutcome::HostDown { .. } => Some(HostCondition::HostUnreachable),
        CallOutcome::NotSignedIn { .. } | CallOutcome::Expired { .. } => Some(HostCondition::NotSignedIn),
        CallOutcome::CliNotFound { reason } => Some(HostCondition::CliNotFound { reason: reason.clone() }),
        CallOutcome::NeedsUpdate { .. } | CallOutcome::Refused { .. } | CallOutcome::Unknown { .. } | CallOutcome::TimedOut | CallOutcome::Cancelled => None,
    }
}
