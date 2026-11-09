//! The runner against a fake `praxis` (#446): `fake_praxis.mjs`, laid out as a checkout's
//! `engine` package, replays recorded `--json` records, the stderr phrases `praxis` prints at
//! the SDK pin, and exit codes. The template commands' records are the vendored read-model
//! fixtures. The graph commands' (#460) are `graph_outputs.fixture.json`, what the real `praxis`
//! printed for each, refusals and `praxis-error/1` records included.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use uuid::Uuid;

use super::launch::LookupEnv;
use super::outcome::{CallOutcome, HostCondition, Verb};
use super::runner::{CallBounds, ConditionChange, PraxisCli};
use super::settings::PraxisCliSettings;
use super::{interactive_argv, InteractiveCommand};
use crate::test_support::TempDir;

const FAKE: &str = include_str!("fake_praxis.mjs");

fn fixtures() -> Value {
    serde_json::from_str(include_str!("../../../../vendor/aiws/spec/engine-v1/read-models.fixtures.json")).unwrap()
}

/// The first valid fixture record of `def`.
fn fixture(def: &str) -> Value {
    fixtures()["cases"].as_array().unwrap().iter().find(|c| c["def"] == def && c["valid"] == true).unwrap()["record"].clone()
}

/// The stderr `praxis` prints at the SDK pin, as `runPraxis` writes a failure.
fn praxis_err(message: &str) -> String {
    format!("praxis: {message}\n")
}

/// A temp checkout holding the fake `praxis`, a project folder, and a runner set to use them.
struct Harness {
    root: PathBuf,
    project: PathBuf,
    cli: PraxisCli,
    changes: Arc<Mutex<Vec<ConditionChange>>>,
    /// `root`'s folder, removed when the harness drops
    _dir: TempDir,
}

impl Harness {
    fn new() -> Self {
        Self::with_bounds(CallBounds::default())
    }

    fn with_bounds(bounds: CallBounds) -> Self {
        let dir = TempDir::new("praxis-cli");
        std::fs::create_dir_all(dir.join("sdk").join("engine").join("src")).unwrap();
        let root = PathBuf::from(crate::slices::praxis::store::display_path(&dir.canonicalize().unwrap()).unwrap());
        std::fs::write(root.join("sdk").join("engine").join("package.json"), r#"{"name":"@aiws/engine","bin":{"praxis":"src/praxis.mjs"}}"#).unwrap();
        std::fs::write(root.join("sdk").join("engine").join("src").join("praxis.mjs"), FAKE).unwrap();
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let cli = PraxisCli::with(root.join("praxis-cli.json"), bounds, LookupEnv::from_process);
        cli.write_settings(PraxisCliSettings { checkout: Some(root.join("sdk").to_string_lossy().into_owned()), installation: None }).unwrap();
        let changes = Arc::new(Mutex::new(Vec::new()));
        let sink = changes.clone();
        cli.on_condition_changed(move |change| sink.lock().unwrap().push(change.clone()));
        Self { root, project, cli, changes, _dir: dir }
    }

    fn src(&self) -> PathBuf {
        self.root.join("sdk").join("engine").join("src")
    }

    fn scenario(&self, scenario: Value) {
        std::fs::write(self.src().join("scenario.json"), scenario.to_string()).unwrap();
    }

    fn call(&self, verb: Verb, args: &[&str]) -> CallOutcome {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        self.cli.call(&self.project, verb, &args, Uuid::new_v4())
    }

    /// The arguments of every run of the fake, in order.
    fn calls(&self) -> Vec<Vec<String>> {
        std::fs::read_to_string(self.src().join("calls.log"))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    fn condition(&self) -> HostCondition {
        self.cli.condition(&self.project)
    }
}

#[test]
fn a_catalog_record_is_read_and_the_host_is_signed_in() {
    let h = Harness::new();
    assert_eq!(h.condition(), HostCondition::NotCheckedYet);
    let catalog = fixture("WorkflowCatalog");
    h.scenario(json!({ "stdout": catalog }));
    assert_eq!(h.call(Verb::WorkflowsList, &["workflows", "list"]), CallOutcome::Record { record: catalog, trust_hint: None });
    assert_eq!(h.calls(), [["workflows", "list", "--json"]]);
    assert_eq!(h.condition(), HostCondition::SignedIn);
    let changes = h.changes.lock().unwrap();
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].condition, HostCondition::SignedIn);
    assert_eq!(changes[0].project_path, h.project.to_string_lossy());
    assert!(!changes[0].project_path.starts_with(r"\\?\"));
}

#[test]
fn an_unchanged_condition_is_not_announced_again() {
    let h = Harness::new();
    h.scenario(json!({ "stdout": fixture("WorkflowRuns") }));
    h.call(Verb::Runs, &["runs", "review-code", "--limit", "20"]);
    h.call(Verb::Runs, &["runs", "review-code", "--limit", "20"]);
    assert_eq!(h.changes.lock().unwrap().len(), 1);
}

#[test]
fn a_simulated_host_is_its_own_condition() {
    let h = Harness::new();
    let mut runs = fixture("WorkflowRuns");
    runs["simulatedIdentity"] = json!(true);
    h.scenario(json!({ "stdout": runs, "stderr": "Simulated identity: nothing decided on this host is a human decision.\n" }));
    assert!(matches!(h.call(Verb::Runs, &["runs", "review-code"]), CallOutcome::Record { .. }));
    assert_eq!(h.condition(), HostCondition::SimulatedHost);
}

#[test]
fn the_installation_setting_is_passed_as_state_on_every_call() {
    let h = Harness::new();
    let installation = h.root.join("installation");
    std::fs::create_dir_all(&installation).unwrap();
    let mut settings = h.cli.settings();
    settings.installation = Some(installation.to_string_lossy().into_owned());
    h.cli.write_settings(settings).unwrap();
    h.scenario(json!({ "stdout": fixture("WorkflowCatalog") }));
    h.call(Verb::WorkflowsShow, &["workflows", "show", "review-code"]);
    let state = installation.to_string_lossy().into_owned();
    assert_eq!(h.calls(), [vec!["workflows".to_string(), "show".into(), "review-code".into(), "--json".into(), "--state".into(), state]]);
}

#[test]
fn bad_settings_are_refused_with_a_clear_message() {
    let h = Harness::new();
    let refuse = |checkout: Option<&str>, installation: Option<&str>| {
        h.cli
            .write_settings(PraxisCliSettings { checkout: checkout.map(str::to_string), installation: installation.map(str::to_string) })
            .unwrap_err()
    };
    assert!(refuse(None, Some("")).contains("is empty"));
    assert!(refuse(None, Some("relative/dir")).contains("must be an absolute path"));
    let missing = h.root.join("missing").to_string_lossy().into_owned();
    assert!(refuse(None, Some(&missing)).contains("doesn't exist"));
    let file = h.root.join("praxis-cli.json").to_string_lossy().into_owned();
    assert!(refuse(None, Some(&file)).contains("is a file"));
    let project = h.project.to_string_lossy().into_owned();
    assert!(refuse(Some(&project), None).contains("isn't an AI-WS-SDK checkout"));
    // The settings that were in place stay.
    assert!(h.cli.settings().checkout.is_some());
}

#[test]
fn a_checkout_that_went_away_is_cli_not_found() {
    let h = Harness::new();
    std::fs::remove_dir_all(h.root.join("sdk")).unwrap();
    let outcome = h.call(Verb::WorkflowsList, &["workflows", "list"]);
    assert!(matches!(&outcome, CallOutcome::CliNotFound { reason } if reason.contains("doesn't exist")), "{outcome:?}");
    assert!(matches!(h.condition(), HostCondition::CliNotFound { .. }));
}

#[test]
fn exit_1_phrases_map_to_host_conditions() {
    let h = Harness::new();
    let cases = [
        (
            praxis_err(r"There is no Praxis host connection descriptor at C:\Users\me\AppData\Local\Praxis\installation\identity\connection.json. Start the host, or pass --state DIR for its installation."),
            "noHost",
            HostCondition::NoHostSetUp,
        ),
        (praxis_err("Could not connect to the host at https://127.0.0.1:7443; is it running?"), "hostDown", HostCondition::HostUnreachable),
        (
            praxis_err(r"There is no CLI session for this host in C:\Users\me\AppData\Local\Praxis\cli. Run praxis login --state C:\Users\me\AppData\Local\Praxis\installation."),
            "notSignedIn",
            HostCondition::NotSignedIn,
        ),
        (
            praxis_err(r"The host did not accept the CLI session (UNAUTHENTICATED). Run praxis login --state C:\Users\me\AppData\Local\Praxis\installation."),
            "expired",
            HostCondition::NotSignedIn,
        ),
    ];
    for (stderr, kind, condition) in cases {
        h.scenario(json!({ "stderr": stderr, "exit": 1 }));
        let outcome = h.call(Verb::Runs, &["runs", "review-code"]);
        let json = serde_json::to_value(&outcome).unwrap();
        assert_eq!(json["kind"], kind, "{stderr}");
        assert_eq!(json["message"], stderr.trim());
        assert_eq!(h.condition(), condition, "{stderr}");
    }
}

#[test]
fn any_other_exit_1_is_a_refusal_with_the_verbatim_text_and_keeps_the_condition() {
    let h = Harness::new();
    h.scenario(json!({ "stdout": fixture("WorkflowRuns") }));
    h.call(Verb::Runs, &["runs", "review-code"]);
    let stderr = praxis_err("The host refused the request (WORKFLOW_TEMPLATE_NOT_FOUND).");
    h.scenario(json!({ "stderr": stderr, "exit": 1 }));
    assert_eq!(h.call(Verb::Runs, &["runs", "review-code"]), CallOutcome::Refused { message: stderr.trim().to_string() });
    assert_eq!(h.condition(), HostCondition::SignedIn);
}

#[test]
fn an_unknown_format_or_exit_2_needs_an_update() {
    let h = Harness::new();
    let mut catalog = fixture("WorkflowCatalog");
    catalog["format"] = json!("aiws-workflow-catalog/2");
    h.scenario(json!({ "stdout": catalog }));
    let outcome = h.call(Verb::WorkflowsList, &["workflows", "list"]);
    assert!(matches!(&outcome, CallOutcome::NeedsUpdate { detail } if detail.contains("aiws-workflow-catalog/2")), "{outcome:?}");

    h.scenario(json!({ "stdout": "not json" }));
    assert!(matches!(h.call(Verb::WorkflowsList, &["workflows", "list"]), CallOutcome::NeedsUpdate { .. }));

    h.scenario(json!({ "stderr": praxis_err("unknown workflows command: lsit") + "Usage:\n  praxis workflows list\n", "exit": 2 }));
    assert!(matches!(h.call(Verb::WorkflowsList, &["workflows", "list"]), CallOutcome::NeedsUpdate { .. }));
    assert_eq!(h.condition(), HostCondition::NotCheckedYet);
}

#[test]
fn unknown_fields_are_ignored() {
    let h = Harness::new();
    let mut catalog = fixture("WorkflowCatalog");
    catalog["somethingNew"] = json!({ "nested": [1, 2] });
    h.scenario(json!({ "stdout": catalog }));
    assert!(matches!(h.call(Verb::WorkflowsList, &["workflows", "list"]), CallOutcome::Record { .. }));
}

#[test]
fn a_created_run_and_a_blocked_run() {
    let h = Harness::new();
    let mut created = fixture("WorkflowRunResult");
    created["runPageAddress"] = json!("https://praxis-abcdefghij.localhost:7443/#/runs/wo-1");
    h.scenario(json!({ "stdout": created }));
    assert_eq!(h.call(Verb::Run, &["run", "review-code"]), CallOutcome::Record { record: created, trust_hint: None });

    let held = fixtures()["cases"].as_array().unwrap().iter().find(|c| c["record"]["code"] == "WORKFLOW_RUN_HELD").unwrap()["record"].clone();
    let address = "https://praxis-abcdefghij.localhost:7443/#/runs/wo-6f1c2d3e-4b5a-4968-8776-655443322110";
    let mut refusal = held;
    refusal["blockingRunAddress"] = json!(address);
    h.scenario(json!({ "stdout": refusal, "exit": 7 }));
    assert_eq!(
        h.call(Verb::Run, &["run", "review-code"]),
        CallOutcome::Blocked { record: refusal, blocking_run_address: address.to_string() }
    );
}

#[test]
fn identical_reads_in_flight_share_one_process() {
    let h = Harness::new();
    let runs = fixture("WorkflowRuns");
    h.scenario(json!({ "stdout": runs, "delayMs": 1500 }));
    let outcomes: Vec<CallOutcome> = std::thread::scope(|scope| {
        let joins: Vec<_> = (0..3).map(|_| scope.spawn(|| h.call(Verb::Runs, &["runs", "review-code"]))).collect();
        joins.into_iter().map(|j| j.join().unwrap()).collect()
    });
    for outcome in &outcomes {
        assert_eq!(outcome, &CallOutcome::Record { record: runs.clone(), trust_hint: None });
    }
    assert_eq!(h.calls().len(), 1, "{:?}", h.calls());
    // Different arguments are a different call.
    h.scenario(json!({ "stdout": runs }));
    h.call(Verb::Runs, &["runs", "other"]);
    assert_eq!(h.calls().len(), 2);
}

/// Whether a process with this OS process id is running.
fn process_alive(pid: u32) -> bool {
    if cfg!(windows) {
        let filter = format!("PID eq {pid}");
        let out = crate::spawn::hidden_command("tasklist").args(["/FI", &filter, "/NH", "/FO", "CSV"]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).contains(&format!("\"{pid}\""))
    } else {
        crate::spawn::hidden_command("kill").args(["-0", &pid.to_string()]).status().unwrap().success()
    }
}

/// The id of the fake's sleeping child, once it has written it.
fn child_pid(src: &Path) -> u32 {
    let started = Instant::now();
    loop {
        if let Some(pid) = std::fs::read_to_string(src.join("child.pid")).ok().and_then(|s| s.trim().parse().ok()) {
            return pid;
        }
        assert!(started.elapsed() < Duration::from_secs(30), "the fake never started its child");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn a_timeout_kills_the_whole_tree() {
    let h = Harness::with_bounds(CallBounds { read: Duration::from_secs(3), ..CallBounds::default() });
    h.scenario(json!({ "child": true, "delayMs": 120000 }));
    let started = Instant::now();
    assert_eq!(h.call(Verb::Status, &["status", "wo-1"]), CallOutcome::TimedOut);
    assert!(started.elapsed() < Duration::from_secs(30));
    let pid = child_pid(&h.src());
    assert!(!process_alive(pid), "the fake's child {pid} outlived the timeout");
}

#[test]
fn run_creation_has_its_own_longer_timeout() {
    assert_eq!(CallBounds::default().read, Duration::from_secs(15));
    assert_eq!(CallBounds::default().write, Duration::from_secs(75));
    let h = Harness::with_bounds(CallBounds { read: Duration::from_millis(500), write: Duration::from_secs(20), ..CallBounds::default() });
    h.scenario(json!({ "stdout": fixture("WorkflowRunResult"), "delayMs": 1500 }));
    assert!(matches!(h.call(Verb::Run, &["run", "review-code"]), CallOutcome::Record { .. }));
    assert_eq!(h.call(Verb::Runs, &["runs", "review-code"]), CallOutcome::TimedOut);
}

#[test]
fn stdout_past_its_cap_stops_the_call_and_stderr_keeps_its_tail() {
    assert_eq!(CallBounds::default().stdout_cap, 8 * 1024 * 1024);
    assert_eq!(CallBounds::default().stderr_cap, 64 * 1024);
    let h = Harness::new();
    h.scenario(json!({ "stdoutBytes": 8 * 1024 * 1024 + 1, "delayMs": 0 }));
    let outcome = h.call(Verb::Status, &["status", "wo-1"]);
    assert!(matches!(&outcome, CallOutcome::Refused { message } if message.contains("more than 8 MiB")), "{outcome:?}");

    let long = format!("{}{}", "x".repeat(100 * 1024), praxis_err("the end"));
    h.scenario(json!({ "stderr": long, "exit": 1 }));
    let CallOutcome::Refused { message } = h.call(Verb::Status, &["status", "wo-1"]) else { panic!("not a refusal") };
    assert!(message.len() <= 64 * 1024 && message.ends_with("praxis: the end"), "kept {} bytes", message.len());
}

#[test]
fn a_cancelled_caller_returns_at_once_and_the_last_one_kills_the_process() {
    let h = Harness::new();
    h.scenario(json!({ "child": true, "delayMs": 120000 }));
    let (first, second) = (Uuid::new_v4(), Uuid::new_v4());
    let args = vec!["status".to_string(), "wo-1".to_string()];
    std::thread::scope(|scope| {
        let a = scope.spawn(|| h.cli.call(&h.project, Verb::Status, &args, first));
        let b = scope.spawn(|| h.cli.call(&h.project, Verb::Status, &args, second));
        let pid = child_pid(&h.src());
        h.cli.cancel(first);
        assert_eq!(a.join().unwrap(), CallOutcome::Cancelled);
        assert!(process_alive(pid), "one caller's cancel killed a process another is waiting on");
        h.cli.cancel(second);
        assert_eq!(b.join().unwrap(), CallOutcome::Cancelled);
        let started = Instant::now();
        while process_alive(pid) {
            assert!(started.elapsed() < Duration::from_secs(20), "the process outlived the last cancel");
            std::thread::sleep(Duration::from_millis(50));
        }
    });
    assert_eq!(h.calls().len(), 1);
}

#[test]
fn interactive_commands_run_the_same_praxis_with_no_confirmation_skipped() {
    let h = Harness::new();
    let argv = interactive_argv(&h.cli, InteractiveCommand::Login).unwrap();
    assert_eq!(argv.len(), 3, "{argv:?}");
    assert!(Path::new(&argv[0]).is_file());
    assert_eq!(Path::new(&argv[1]), h.src().join("praxis.mjs"));
    assert_eq!(argv[2], "login");
    let installation = h.root.join("installation");
    std::fs::create_dir_all(&installation).unwrap();
    let mut settings = h.cli.settings();
    settings.installation = Some(installation.to_string_lossy().into_owned());
    h.cli.write_settings(settings).unwrap();
    for (command, verb) in [(InteractiveCommand::Serve, "serve"), (InteractiveCommand::Setup, "setup"), (InteractiveCommand::Trust, "trust")] {
        let argv = interactive_argv(&h.cli, command).unwrap();
        assert_eq!(argv[2..], [verb.to_string(), "--state".into(), installation.to_string_lossy().into_owned()]);
    }
}

/// The vendored read-model fixtures against the vendored schema, and each valid record of a
/// format the runner reads through its outcome parsing.
#[test]
fn the_vendored_read_model_fixtures_hold() {
    let schema: Value = serde_json::from_str(include_str!("../../../../vendor/aiws/spec/engine-v1/read-models.schema.json")).unwrap();
    let fixtures = fixtures();
    assert_eq!(fixtures["profile"], "aiws-read-model-fixtures/1");
    let cases = fixtures["cases"].as_array().unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        let def = case["def"].as_str().unwrap();
        let mut def_schema = schema["$defs"][def].clone();
        def_schema["$defs"] = schema["$defs"].clone();
        let validator = jsonschema::validator_for(&def_schema).unwrap_or_else(|e| panic!("{def} doesn't compile: {e}"));
        assert_eq!(validator.is_valid(&case["record"]), case["valid"] == true, "{}", case["name"]);

        let verb = match def {
            "WorkflowCatalog" | "WorkflowTemplateDetail" => Some(Verb::WorkflowsList),
            "WorkflowRuns" => Some(Verb::Runs),
            "WorkflowRunResult" => Some(Verb::Run),
            _ => None,
        };
        if let (Some(verb), true) = (verb, case["valid"] == true) {
            let stdout = serde_json::to_vec(&case["record"]).unwrap();
            assert_eq!(super::outcome::interpret(verb, Some(0), &stdout, ""), CallOutcome::Record { record: case["record"].clone(), trust_hint: None }, "{}", case["name"]);
        }
    }
}

#[test]
fn each_command_has_the_argv_praxis_expects_with_the_template_name_where_the_guard_looks() {
    let argv = |verb: Verb, operands: &[&str]| verb.args(operands.iter().map(|o| o.to_string()));
    assert_eq!(argv(Verb::WorkflowsList, &[]), ["workflows", "list"]);
    assert_eq!(argv(Verb::Status, &["wo-1"]), ["status", "wo-1"]);
    for (verb, operands, expected) in [
        (Verb::WorkflowsShow, &["t"][..], &["workflows", "show", "t"][..]),
        (Verb::Runs, &["t", "--limit", "20"][..], &["runs", "t", "--limit", "20"][..]),
        (Verb::Run, &["t"][..], &["run", "t"][..]),
    ] {
        let args = argv(verb, operands);
        assert_eq!(args, expected);
        assert_eq!(args[verb.template_arg().unwrap()], "t", "{verb:?}");
    }
    assert_eq!(Verb::WorkflowsList.template_arg(), None);
    assert_eq!(Verb::Status.template_arg(), None);
}

#[test]
fn a_template_name_the_host_refuses_never_reaches_praxis() {
    let h = Harness::new();
    h.scenario(json!({ "stdout": fixture("WorkflowRuns") }));
    // Built the way the Tauri commands build them, so the name sits where `Verb::args` puts it.
    let calls = [
        Verb::WorkflowsShow.args(["Review_Code".to_string()]),
        Verb::Runs.args(["review.code".to_string(), "--limit".into(), "20".into()]),
        Verb::Run.args(["con".to_string()]),
    ];
    for (verb, args) in [Verb::WorkflowsShow, Verb::Runs, Verb::Run].into_iter().zip(calls) {
        match h.cli.call(&h.project, verb, &args, Uuid::new_v4()) {
            CallOutcome::Refused { message } => {
                assert_eq!(message, crate::slices::praxis::template_name::TEMPLATE_NAME_RULE, "{args:?}")
            }
            other => panic!("{args:?} gave {other:?}"),
        }
    }
    assert!(h.calls().is_empty(), "{:?}", h.calls());
    assert_eq!(h.condition(), HostCondition::NotCheckedYet);
    // A name the rule admits still runs.
    assert!(matches!(h.call(Verb::Runs, &["runs", "review-code", "--limit", "20"]), CallOutcome::Record { .. }));
}

/// A `coding-operator-view/1` record as `praxis status <wo> --json` prints it, as far as the
/// runner reads it: the CLI checks only its format and work order.
fn operator_view(work_order: &str) -> Value {
    json!({
        "format": "coding-operator-view/1",
        "workOrderId": work_order,
        "runId": "run-1",
        "status": "AWAITING_APPROVAL",
        "stage": "IMPLEMENTATION",
        "pending": ["HUMAN_APPROVAL"],
        "runPageAddress": format!("https://praxis-abcdefghij.localhost:7443/#work-order={work_order}"),
    })
}

#[test]
fn status_passes_on_the_certificate_hint_praxis_writes_on_stderr() {
    let h = Harness::new();
    let view = operator_view("wo-1");
    // `trustHint` in engine/src/praxis-follow.ts at the SDK pin, after the simulated banner.
    let hint = r"Your browser does not trust this host's certificate yet: run praxis trust --state C:\Users\u\AppData\Local\Praxis\installation first.";
    h.scenario(json!({ "stdout": view, "stderr": format!("Simulated identity: nothing decided on this host is a human decision.\n{hint}\n") }));
    assert_eq!(h.call(Verb::Status, &["status", "wo-1"]), CallOutcome::Record { record: view.clone(), trust_hint: Some(hint.to_string()) });

    h.scenario(json!({ "stdout": view }));
    assert_eq!(h.call(Verb::Status, &["status", "wo-1"]), CallOutcome::Record { record: view, trust_hint: None });
}

#[test]
fn only_status_reads_a_certificate_hint() {
    let h = Harness::new();
    let runs = fixture("WorkflowRuns");
    h.scenario(json!({ "stdout": runs, "stderr": "Your browser does not trust this host's certificate yet: run praxis trust first.\n" }));
    assert_eq!(h.call(Verb::Runs, &["runs", "review-code"]), CallOutcome::Record { record: runs, trust_hint: None });
}

#[test]
fn a_record_without_a_hint_is_sent_without_the_field() {
    let json = serde_json::to_value(CallOutcome::Record { record: json!({ "format": "x" }), trust_hint: None }).unwrap();
    assert_eq!(json, json!({ "kind": "record", "record": { "format": "x" } }));
    let json = serde_json::to_value(CallOutcome::Record { record: json!({}), trust_hint: Some("run praxis trust".into()) }).unwrap();
    assert_eq!(json["trustHint"], "run praxis trust");
}

/// The `aiws-workflow-run-error/1` refusal `praxis run` prints with exit 7 for `code`, naming the
/// run that blocks it.
fn run_refusal(code: &str) -> Value {
    let mut refusal = fixtures()["cases"].as_array().unwrap().iter().find(|c| c["record"]["code"] == code).unwrap()["record"].clone();
    refusal["blockingRunAddress"] = json!("https://praxis-abcdefghij.localhost:7443/#work-order=wo-6f1c2d3e-4b5a-4968-8776-655443322110");
    refusal
}

#[test]
fn every_outcome_of_a_run_creation() {
    let h = Harness::new();
    let run = || h.call(Verb::Run, &["run", "review-code"]);
    let kind = |outcome: &CallOutcome| serde_json::to_value(outcome).unwrap()["kind"].as_str().unwrap().to_string();

    h.scenario(json!({ "stdout": fixture("WorkflowRunResult") }));
    assert_eq!(run(), CallOutcome::Record { record: fixture("WorkflowRunResult"), trust_hint: None });

    for code in ["WORKFLOW_RUN_HELD", "WORKFLOW_RUN_PENDING_APPROVAL"] {
        h.scenario(json!({ "stdout": run_refusal(code), "exit": 7 }));
        assert_eq!(kind(&run()), "blocked", "{code}");
    }

    for (stderr, expected) in [
        (praxis_err(r"There is no Praxis host connection descriptor at C:\x\connection.json. Start the host, or pass --state DIR for its installation."), "noHost"),
        (praxis_err("Could not connect to the host at https://127.0.0.1:7443; is it running?"), "hostDown"),
        (praxis_err(r"There is no CLI session for this host in C:\x\cli. Run praxis login."), "notSignedIn"),
        (praxis_err("The host did not accept the CLI session (UNAUTHENTICATED). Run praxis login."), "expired"),
    ] {
        h.scenario(json!({ "stderr": stderr, "exit": 1 }));
        assert_eq!(kind(&run()), expected, "{stderr}");
    }

    let stderr = praxis_err("The host refused the run (READINESS_BLOCKED): Required capability TOOL node is not supported.");
    h.scenario(json!({ "stderr": stderr, "exit": 1 }));
    assert_eq!(run(), CallOutcome::Refused { message: stderr.trim().to_string() });

    h.scenario(json!({ "stderr": praxis_err("unknown option --jsn"), "exit": 2 }));
    assert_eq!(kind(&run()), "needsUpdate");
    let mut result = fixture("WorkflowRunResult");
    result["format"] = json!("aiws-workflow-run-result/2");
    h.scenario(json!({ "stdout": result }));
    assert_eq!(kind(&run()), "needsUpdate");

    // An exit praxis doesn't document for `run` says nothing about whether the run was created.
    h.scenario(json!({ "stderr": praxis_err("something broke"), "exit": 9 }));
    let outcome = run();
    assert!(matches!(&outcome, CallOutcome::Unknown { detail, request_id: None } if detail.contains("something broke")), "{outcome:?}");
    // Each creation ran praxis once: Quay retries none of them.
    assert_eq!(h.calls().len(), 11);
    assert!(h.calls().iter().all(|c| c == &["run", "review-code", "--json"]), "{:?}", h.calls());
}

#[test]
fn a_repeated_run_while_one_is_in_flight_joins_the_same_process() {
    let h = Harness::new();
    let created = fixture("WorkflowRunResult");
    h.scenario(json!({ "stdout": created, "delayMs": 1500 }));
    let outcomes: Vec<CallOutcome> = std::thread::scope(|scope| {
        let joins: Vec<_> = (0..2).map(|_| scope.spawn(|| h.call(Verb::Run, &["run", "review-code"]))).collect();
        joins.into_iter().map(|j| j.join().unwrap()).collect()
    });
    for outcome in &outcomes {
        assert_eq!(outcome, &CallOutcome::Record { record: created.clone(), trust_hint: None });
    }
    assert_eq!(h.calls().len(), 1, "{:?}", h.calls());
}

#[test]
fn a_creation_killed_by_the_timeout_stays_pending_and_the_next_run_resumes_it() {
    let h = Harness::with_bounds(CallBounds { write: Duration::from_secs(2), ..CallBounds::default() });
    let created = fixture("WorkflowRunResult");
    h.scenario(json!({ "stdout": created, "profile": true, "delayMs": 120000 }));
    assert_eq!(h.call(Verb::Run, &["run", "review-code"]), CallOutcome::TimedOut);
    let profile: Value = serde_json::from_str(&std::fs::read_to_string(h.src().join("profile.json")).unwrap()).unwrap();
    let pending = profile["pending"]["requestId"].clone();
    assert!(pending.is_string(), "the killed creation is still pending: {profile}");
    // Quay ran praxis once and didn't run it again by itself.
    assert_eq!(h.calls().len(), 1);

    h.scenario(json!({ "stdout": created, "profile": true }));
    let CallOutcome::Record { record, .. } = h.call(Verb::Run, &["run", "review-code"]) else { panic!("the next run didn't finish") };
    assert_eq!(record["requestId"], pending, "the next run resumed the pending creation");
    assert_eq!(record["workOrderId"], created["workOrderId"]);
    let profile: Value = serde_json::from_str(&std::fs::read_to_string(h.src().join("profile.json")).unwrap()).unwrap();
    assert_eq!(profile["pending"], Value::Null);
    assert_eq!(h.calls(), [["run", "review-code", "--json"], ["run", "review-code", "--json"]]);
}

// The graph commands (#460) against what the real `praxis` printed for each, recorded by
// graph_outputs.record.mjs against the SDK's simulated host.

/// The recorded case `name`: the arguments Quay gave, the exit, the stdout record and stderr.
fn recorded(name: &str) -> Value {
    let file: Value = serde_json::from_str(include_str!("graph_outputs.fixture.json")).unwrap();
    file["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).unwrap_or_else(|| panic!("no recorded case {name}")).clone()
}

/// A scenario that replays `case` as `praxis` printed it.
fn replay(case: &Value) -> Value {
    let stdout = if case["stdout"].is_null() { json!("") } else { case["stdout"].clone() };
    json!({ "stdout": stdout, "stderr": case["stderr"], "exit": case["exit"] })
}

/// The recorded arguments of `case`, which the real `praxis` took.
fn recorded_args(case: &Value) -> Vec<String> {
    case["args"].as_array().unwrap().iter().map(|a| a.as_str().unwrap().to_string()).collect()
}

/// Runs `verb` with `operands` as the Tauri commands build them, against `case` replayed.
fn graph_call(h: &Harness, verb: Verb, operands: &[impl AsRef<str>], case: &Value) -> CallOutcome {
    h.scenario(replay(case));
    let args = verb.args(operands.iter().map(|o| o.as_ref().to_string()));
    h.cli.call(&h.project, verb, &args, Uuid::new_v4())
}

/// Asserts `h` ran `praxis` once, with the arguments the real `praxis` took in `case`, and `--json`.
fn assert_called_as(h: &Harness, case: &Value) {
    let mut expected = recorded_args(case);
    expected.push("--json".into());
    assert_eq!(h.calls(), [expected], "{}", case["name"]);
}

#[test]
fn graphs_list_reads_the_host_s_graph_workflows_and_updates_the_condition() {
    let h = Harness::new();
    let case = recorded("graphs list");
    let outcome = graph_call(&h, Verb::GraphsList, &["--limit", "100"], &case);
    assert_eq!(outcome, CallOutcome::Record { record: case["stdout"].clone(), trust_hint: None });
    assert_called_as(&h, &case);
    assert_eq!(h.condition(), HostCondition::SimulatedHost);
}

#[test]
fn a_praxis_error_record_says_which_host_condition_failed_in_its_own_words() {
    let h = Harness::new();
    for (name, kind, condition) in [
        ("no host set up", "noHost", HostCondition::NoHostSetUp),
        ("host down", "hostDown", HostCondition::HostUnreachable),
        ("not signed in (made)", "notSignedIn", HostCondition::NotSignedIn),
        ("session refused (made)", "expired", HostCondition::NotSignedIn),
    ] {
        let case = recorded(name);
        let outcome = serde_json::to_value(graph_call(&h, Verb::GraphsList, &["--limit", "100"], &case)).unwrap();
        assert_eq!(outcome["kind"], kind, "{name}");
        assert_eq!(outcome["message"], case["stdout"]["message"], "{name}");
        assert_eq!(h.condition(), condition, "{name}");
    }
}

#[test]
fn a_usage_error_record_needs_an_update_and_keeps_the_condition() {
    let h = Harness::new();
    let case = recorded("usage: unknown graphs command, exit 2");
    let outcome = graph_call(&h, Verb::GraphsList, &[] as &[&str], &case);
    assert_eq!(outcome, CallOutcome::NeedsUpdate { detail: "praxis didn't accept Quay's arguments: unknown graphs command: lsit".into() });
    assert_eq!(h.condition(), HostCondition::NotCheckedYet);
}

#[test]
fn graphs_show_reads_one_graph_workflow_with_its_revisions_and_admission_page() {
    let h = Harness::new();
    let case = recorded("graphs show");
    let outcome = graph_call(&h, Verb::GraphsShow, &["release-review"], &case);
    let CallOutcome::Record { record, .. } = outcome else { panic!("{outcome:?}") };
    assert_eq!(record, case["stdout"]);
    assert_eq!(record["revisions"].as_array().unwrap().len(), 2);
    assert!(record["admissionPageAddress"].as_str().unwrap().ends_with("#graph-workflow=release-review&revision=2"));
    assert_called_as(&h, &case);
}

#[test]
fn a_host_refusal_carries_the_host_s_code_and_says_the_host_answered() {
    let h = Harness::new();
    let case = recorded("graphs show: not submitted");
    let outcome = graph_call(&h, Verb::GraphsShow, &["nothing-here"], &case);
    assert_eq!(
        outcome,
        CallOutcome::HostRefused {
            message: "The host refused the request (NOT_FOUND).".into(),
            host_code: "NOT_FOUND".into(),
            record: case["stdout"].clone(),
        }
    );
    let json = serde_json::to_value(&outcome).unwrap();
    assert_eq!((json["kind"].as_str(), json["hostCode"].as_str()), (Some("hostRefused"), Some("NOT_FOUND")));
    // The host answered this session, so it is signed in, here as the simulated host.
    assert_eq!(h.condition(), HostCondition::SimulatedHost);
}

/// Each recorded read `praxis` answered with a record: the verb and operands Quay gives it, and
/// the case. The arguments the runner builds must be the ones the real CLI took.
#[test]
fn each_graph_read_is_read_with_the_arguments_praxis_took() {
    let status = recorded("status: awaiting approval");
    let work_order = status["stdout"]["workOrderId"].as_str().unwrap().to_string();
    let cases: [(Verb, Vec<&str>, &str); 4] = [
        (Verb::GraphsRevisions, vec!["release-review", "--before", "2", "--limit", "20"], "graphs show: older revisions"),
        (Verb::GraphsWithdraw, vec!["release-review", "1"], "graphs withdraw: a pending candidate"),
        (Verb::GraphRuns, vec!["nightly-build", "--limit", "20"], "runs"),
        (Verb::GraphStatus, vec![&work_order], "status: awaiting approval"),
    ];
    for (verb, operands, name) in cases {
        let h = Harness::new();
        let case = recorded(name);
        let outcome = graph_call(&h, verb, &operands, &case);
        let CallOutcome::Record { record, .. } = outcome else { panic!("{name}: {outcome:?}") };
        assert_eq!(record, case["stdout"], "{name}");
        assert_called_as(&h, &case);
        assert_eq!(h.condition(), HostCondition::SimulatedHost, "{name}");
    }
}

#[test]
fn a_graph_run_is_created_or_blocked_by_a_run_that_needs_a_person() {
    let h = Harness::new();
    let case = recorded("run: created");
    assert_eq!(graph_call(&h, Verb::GraphRun, &["nightly-build"], &case), CallOutcome::Record { record: case["stdout"].clone(), trust_hint: None });
    assert_called_as(&h, &case);

    let case = recorded("run: blocked by a run awaiting approval, exit 7");
    let address = case["stdout"]["blockingRunAddress"].as_str().unwrap().to_string();
    assert_eq!(
        graph_call(&h, Verb::GraphRun, &["nightly-build"], &case),
        CallOutcome::Blocked { record: case["stdout"].clone(), blocking_run_address: address }
    );
    assert_eq!(h.condition(), HostCondition::SimulatedHost);
}

#[test]
fn a_graph_status_passes_on_the_certificate_hint() {
    let h = Harness::new();
    let case = recorded("status: awaiting approval");
    let work_order = case["stdout"]["workOrderId"].as_str().unwrap().to_string();
    let CallOutcome::Record { trust_hint, .. } = graph_call(&h, Verb::GraphStatus, &[&work_order], &case) else { panic!("not a record") };
    let stderr = case["stderr"].as_str().unwrap();
    assert!(stderr.contains(trust_hint.as_deref().unwrap()) && trust_hint.unwrap().starts_with("Your browser does not trust this host's certificate"));
}

#[test]
fn each_graph_command_s_recorded_refusal() {
    for (verb, operands, name, host_code) in [
        (Verb::GraphsRevisions, &["nothing-here", "--before", "2", "--limit", "20"][..], "graphs show: older revisions, not submitted", Some("NOT_FOUND")),
        (Verb::GraphsWithdraw, &["release-review", "1"][..], "graphs withdraw: not pending", Some("REVISION_NOT_PENDING")),
        (Verb::GraphRuns, &["nothing-here", "--limit", "20"][..], "runs: not submitted", Some("NOT_FOUND")),
        (Verb::GraphStatus, &["wo-nothing-here"][..], "status: no such run", Some("NOT_FOUND")),
        // praxis refuses this itself, after reading the graph workflow, so no host code comes.
        (Verb::GraphRun, &["release-review"][..], "run: no admitted revision", None),
    ] {
        let h = Harness::new();
        let case = recorded(name);
        let outcome = graph_call(&h, verb, operands, &case);
        assert_called_as(&h, &case);
        let message = case["stdout"]["message"].as_str().unwrap().to_string();
        match host_code {
            Some(code) => {
                assert_eq!(outcome, CallOutcome::HostRefused { message, host_code: code.into(), record: case["stdout"].clone() }, "{name}");
                assert_eq!(h.condition(), HostCondition::SimulatedHost, "{name}");
            }
            None => {
                assert_eq!(outcome, CallOutcome::Refused { message }, "{name}");
                assert_eq!(h.condition(), HostCondition::NotCheckedYet, "{name}");
            }
        }
    }
}

#[test]
fn a_graph_workflow_name_the_host_refuses_never_reaches_praxis() {
    let h = Harness::new();
    h.scenario(replay(&recorded("graphs show")));
    let rule = crate::slices::praxis::template_name::GRAPH_WORKFLOW_NAME_RULE;
    for (verb, operands, why) in [
        (Verb::GraphsShow, vec!["Release_Review".to_string()], rule.to_string()),
        (Verb::GraphsRevisions, vec!["con".into(), "--before".into(), "2".into(), "--limit".into(), "20".into()], rule.to_string()),
        (Verb::GraphsWithdraw, vec!["".into(), "1".into()], rule.to_string()),
        (Verb::GraphRun, vec!["review.code".into()], rule.to_string()),
        (Verb::GraphRuns, vec!["check".into(), "--limit".into(), "20".into()], crate::slices::praxis::template_name::GRAPH_WORKFLOW_NAME_CHECK.to_string()),
    ] {
        let args = verb.args(operands);
        assert_eq!(h.cli.call(&h.project, verb, &args, Uuid::new_v4()), CallOutcome::Refused { message: why }, "{args:?}");
    }
    assert!(h.calls().is_empty(), "{:?}", h.calls());
    assert_eq!(h.condition(), HostCondition::NotCheckedYet);
    // `check` is only a graph workflow's refusal: a template of that name still runs.
    h.scenario(json!({ "stdout": fixture("WorkflowRuns") }));
    assert!(matches!(h.call(Verb::Runs, &["runs", "check", "--limit", "20"]), CallOutcome::Record { .. }));
}

/// Writes `.praxis/<rel>` in `project` with `body` as JSON.
fn put(project: &Path, rel: &str, body: Value) {
    let path = project.join(".praxis").join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body.to_string()).unwrap();
}

/// A graph workflow `release-review` whose contract `c1` grants `g1` and `g2`, all saved.
fn saved_graph_workflow(project: &Path) {
    put(project, "graph-workflows/release-review.json", json!({ "version": 1, "contractId": "c1", "graphId": "gr1", "graphBindingId": "b1" }));
    put(project, "contracts/c1.json", json!({ "id": "c1" }));
    put(project, "graphs/gr1.json", json!({ "id": "gr1" }));
    put(project, "graph-bindings/b1.json", json!({ "graphBindingId": "b1", "graphId": "gr1" }));
    put(project, "bindings/c1.json", json!({ "version": 1, "graphs": ["gr1"], "grants": ["g2", "g1"] }));
    put(project, "grants/g1.json", json!({ "id": "g1" }));
    put(project, "grants/g2.json", json!({ "id": "g2" }));
}

#[test]
fn a_check_sends_the_graph_workflow_s_saved_files_as_paths() {
    let h = Harness::new();
    saved_graph_workflow(&h.project);
    // The commands give it the project root as they resolve it, canonical.
    let operands = super::bundle::bundle_operands(&h.project.canonicalize().unwrap(), "release-review").unwrap();
    let file = |rel: &str| rel.split('/').fold(h.project.join(".praxis"), |p, part| p.join(part)).to_string_lossy().into_owned();
    let expected = vec![
        "release-review".to_string(),
        "--graph".into(), file("graphs/gr1.json"),
        "--binding".into(), file("graph-bindings/b1.json"),
        "--contract".into(), file("contracts/c1.json"),
        // The grants in the order the contract's bindings file lists them.
        "--grant".into(), file("grants/g2.json"),
        "--grant".into(), file("grants/g1.json"),
    ];
    assert_eq!(operands, expected);
    let case = recorded("graphs check: valid");
    assert_eq!(graph_call(&h, Verb::GraphsCheck, &operands, &case), CallOutcome::Record { record: case["stdout"].clone(), trust_hint: None });
    let mut argv = vec!["graphs".to_string(), "check".into()];
    argv.extend(expected);
    argv.push("--json".into());
    assert_eq!(h.calls(), [argv]);
    assert_eq!(h.condition(), HostCondition::SimulatedHost);
}

#[test]
fn a_bundle_with_a_file_missing_is_refused_before_praxis_runs() {
    let refusal = |change: &dyn Fn(&Path)| {
        let h = Harness::new();
        saved_graph_workflow(&h.project);
        change(&h.project);
        super::bundle::bundle_operands(&h.project.canonicalize().unwrap(), "release-review").unwrap_err()
    };
    let gone = |rel: &'static str| move |p: &Path| std::fs::remove_file(p.join(".praxis").join(rel)).unwrap();
    assert_eq!(refusal(&gone("graph-workflows/release-review.json")), ".praxis/graph-workflows/release-review.json doesn't exist.");
    assert_eq!(refusal(&gone("graphs/gr1.json")), ".praxis/graphs/gr1.json doesn't exist.");
    assert_eq!(refusal(&gone("grants/g1.json")), ".praxis/grants/g1.json doesn't exist.");
    assert_eq!(refusal(&gone("bindings/c1.json")), "Contract c1 has no bindings file, so graph workflow release-review carries no grants.");
    let no_grants = |p: &Path| put(p, "bindings/c1.json", json!({ "version": 1, "graphs": ["gr1"], "grants": [] }));
    assert_eq!(refusal(&no_grants), "Contract c1's bindings file lists no grants, and a graph workflow carries at least one.");
    let too_many = |p: &Path| {
        let grants: Vec<String> = (0..65).map(|i| format!("g{i}")).collect();
        put(p, "bindings/c1.json", json!({ "version": 1, "graphs": ["gr1"], "grants": grants }));
    };
    assert_eq!(refusal(&too_many), "Contract c1's bindings file lists 65 grants, and a graph workflow carries at most 64.");
    let unpicked = |p: &Path| put(p, "graph-workflows/release-review.json", json!({ "version": 1, "contractId": "c1", "graphId": "gr1" }));
    assert_eq!(refusal(&unpicked), "Graph workflow release-review isn't valid: Pick a graph binding.");
    let h = Harness::new();
    assert_eq!(super::bundle::bundle_operands(&h.project, "check").unwrap_err(), crate::slices::praxis::template_name::GRAPH_WORKFLOW_NAME_CHECK);
}

/// The bundle operands of `release-review` in a harness's project, saved.
fn bundle_in(h: &Harness) -> Vec<String> {
    saved_graph_workflow(&h.project);
    super::bundle::bundle_operands(&h.project.canonicalize().unwrap(), "release-review").unwrap()
}

/// The operands `praxis_host_graph_submit` gives for `release-review` in a harness's project,
/// saved, with `base` and `request_id`.
fn submit_in(h: &Harness, base: Option<u32>, request_id: Option<Uuid>) -> Vec<String> {
    saved_graph_workflow(&h.project);
    super::commands::submit_operands(&h.project.canonicalize().unwrap(), "release-review", base, request_id).unwrap()
}

/// `args` with the bundle's file operands (`--graph`, `--binding`, `--contract` and each
/// `--grant`, with their paths) put as one `<bundle>`, since the recorded bundle and a test
/// project's saved one name and count their files differently.
fn bundle_as_one(args: &[String]) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if matches!(arg.as_str(), "--graph" | "--binding" | "--contract" | "--grant") {
            args.next();
            if kept.last().map(String::as_str) != Some("<bundle>") {
                kept.push("<bundle>".into());
            }
        } else {
            kept.push(arg.clone());
        }
    }
    kept
}

#[test]
fn a_submission_becomes_a_candidate_with_its_admission_page() {
    for (base, name, revision) in [(None, "graphs submit: a candidate", 1), (Some(1), "graphs submit: a second candidate", 2)] {
        let h = Harness::new();
        let operands = submit_in(&h, base, None);
        let case = recorded(name);
        let outcome = graph_call(&h, Verb::GraphsSubmit, &operands, &case);
        let CallOutcome::Record { record, .. } = outcome else { panic!("{name}: {outcome:?}") };
        assert_eq!((record["status"].as_str(), record["revision"].as_u64()), (Some("CANDIDATE"), Some(revision)), "{name}");
        assert_eq!(record["baseRevision"].as_u64(), base.map(u64::from), "{name}");
        assert!(record["admissionPageAddress"].as_str().unwrap().ends_with(&format!("#graph-workflow=release-review&revision={revision}")), "{name}");
        // The name, the bundle, then `--base`, in the order the real `praxis` took them.
        let mut expected = recorded_args(&case);
        expected.push("--json".into());
        assert_eq!(h.calls().iter().map(|call| bundle_as_one(call)).collect::<Vec<_>>(), [bundle_as_one(&expected)], "{name}");
        assert_eq!(h.condition(), HostCondition::SimulatedHost, "{name}");
    }
}

#[test]
fn a_bundle_the_host_finds_faults_in_gives_its_findings_on_exit_9() {
    for (verb, name) in [(Verb::GraphsCheck, "graphs check: faults, exit 9"), (Verb::GraphsSubmit, "graphs submit: faults, exit 9")] {
        let h = Harness::new();
        let operands = bundle_in(&h);
        let case = recorded(name);
        let outcome = graph_call(&h, verb, &operands, &case);
        assert_eq!(outcome, CallOutcome::BundleInvalid { record: case["stdout"].clone() }, "{name}");
        assert_eq!(case["stdout"]["findings"][0]["file"], "contract", "{name}");
        assert_eq!(serde_json::to_value(&outcome).unwrap()["kind"], "bundleInvalid");
        assert_eq!(h.condition(), HostCondition::SimulatedHost, "{name}");
    }
}

#[test]
fn an_unconfirmed_submission_is_unknown_with_the_request_id_to_resend() {
    let h = Harness::new();
    let case = recorded("graphs submit: outcome unknown (made)");
    let request_id = "3f2c8a1e-5b7d-4e9a-8c6f-0d1e2a3b4c5d";
    let operands = submit_in(&h, Some(1), Some(Uuid::parse_str(request_id).unwrap()));
    let outcome = graph_call(&h, Verb::GraphsSubmit, &operands, &case);
    // The resend goes after the bundle and `--base`, as `--request-id`.
    let call = &h.calls()[0];
    assert_eq!(call[call.len() - 5..], ["--base", "1", "--request-id", request_id, "--json"]);
    assert_eq!(
        outcome,
        CallOutcome::Unknown { detail: case["stdout"]["message"].as_str().unwrap().to_string(), request_id: Some(request_id.to_string()) }
    );
    assert_eq!(serde_json::to_value(&outcome).unwrap()["requestId"], request_id);
    assert_eq!(h.condition(), HostCondition::NotCheckedYet);
    // An unknown outcome of a run creation carries no request id: the profile keeps it.
    let json = serde_json::to_value(CallOutcome::Unknown { detail: "x".into(), request_id: None }).unwrap();
    assert_eq!(json, json!({ "kind": "unknown", "detail": "x" }));
}

#[test]
fn a_graph_record_in_a_format_quay_does_not_read_or_one_the_host_does_not_serve_needs_an_update() {
    let h = Harness::new();
    let mut case = recorded("graphs list");
    case["stdout"]["format"] = json!("aiws-graph-workflows/2");
    let outcome = graph_call(&h, Verb::GraphsList, &["--limit", "100"], &case);
    assert!(matches!(&outcome, CallOutcome::NeedsUpdate { detail } if detail.contains("aiws-graph-workflows/2")), "{outcome:?}");

    let case = recorded("format not served (made)");
    let outcome = graph_call(&h, Verb::GraphsList, &["--limit", "100"], &case);
    assert_eq!(outcome, CallOutcome::NeedsUpdate { detail: case["stdout"]["message"].as_str().unwrap().to_string() });
    assert_eq!(h.condition(), HostCondition::NotCheckedYet);
}

#[test]
fn graph_command_bounds_refuse_what_praxis_would_refuse() {
    use super::commands::{check_page_limit, check_revision, MAX_PAGE_LIMIT};
    assert_eq!(MAX_PAGE_LIMIT, 100);
    assert!(check_page_limit(1).is_ok() && check_page_limit(100).is_ok());
    assert_eq!(check_page_limit(0).unwrap_err(), "The limit must be from 1 to 100, not 0.");
    assert!(check_page_limit(101).is_err());
    assert!(check_revision(1).is_ok());
    assert_eq!(check_revision(0).unwrap_err(), "A revision is a whole number from 1, not 0.");
}

// Starting a graph run (#466): `praxis run <name> --json` for a graph workflow, with the outcomes
// a template run has (#454).

#[test]
fn every_outcome_of_a_graph_run_creation() {
    let h = Harness::new();
    let run = || h.call(Verb::GraphRun, &["run", "nightly-build"]);
    let kind = |outcome: &CallOutcome| serde_json::to_value(outcome).unwrap()["kind"].as_str().unwrap().to_string();

    let created = recorded("run: created")["stdout"].clone();
    h.scenario(json!({ "stdout": created }));
    assert_eq!(run(), CallOutcome::Record { record: created.clone(), trust_hint: None });

    let mut held = recorded("run: blocked by a run awaiting approval, exit 7")["stdout"].clone();
    for code in ["WORKFLOW_RUN_HELD", "WORKFLOW_RUN_PENDING_APPROVAL"] {
        held["code"] = json!(code);
        h.scenario(json!({ "stdout": held, "exit": 7 }));
        assert_eq!(kind(&run()), "blocked", "{code}");
    }

    for (stderr, expected) in [
        (praxis_err("Could not connect to the host at https://127.0.0.1:7443; is it running?"), "hostDown"),
        (praxis_err(r"There is no CLI session for this host in C:\x\cli. Run praxis login."), "notSignedIn"),
        (praxis_err("The host did not accept the CLI session (UNAUTHENTICATED). Run praxis login."), "expired"),
    ] {
        h.scenario(json!({ "stderr": stderr, "exit": 1 }));
        assert_eq!(kind(&run()), expected, "{stderr}");
    }

    let case = recorded("run: no admitted revision");
    h.scenario(replay(&case));
    assert_eq!(run(), CallOutcome::Refused { message: case["stdout"]["message"].as_str().unwrap().to_string() });

    // An exit praxis doesn't document for `run` says nothing about whether the run was created.
    h.scenario(json!({ "stderr": praxis_err("something broke"), "exit": 9 }));
    let outcome = run();
    assert!(matches!(&outcome, CallOutcome::Unknown { detail, .. } if detail.contains("something broke")), "{outcome:?}");
    // Each creation ran praxis once: Quay retries none of them.
    assert_eq!(h.calls().len(), 8);
    assert!(h.calls().iter().all(|c| c == &["run", "nightly-build", "--json"]), "{:?}", h.calls());
}

#[test]
fn a_repeated_graph_run_while_one_is_in_flight_joins_the_same_process() {
    let h = Harness::new();
    let created = recorded("run: created")["stdout"].clone();
    h.scenario(json!({ "stdout": created, "delayMs": 1500 }));
    let outcomes: Vec<CallOutcome> = std::thread::scope(|scope| {
        let joins: Vec<_> = (0..2).map(|_| scope.spawn(|| h.call(Verb::GraphRun, &["run", "nightly-build"]))).collect();
        joins.into_iter().map(|j| j.join().unwrap()).collect()
    });
    for outcome in &outcomes {
        assert_eq!(outcome, &CallOutcome::Record { record: created.clone(), trust_hint: None });
    }
    assert_eq!(h.calls().len(), 1, "{:?}", h.calls());
}

#[test]
fn a_graph_run_killed_by_the_timeout_stays_pending_and_the_next_run_resumes_it() {
    let h = Harness::with_bounds(CallBounds { write: Duration::from_secs(2), ..CallBounds::default() });
    let created = recorded("run: created")["stdout"].clone();
    h.scenario(json!({ "stdout": created, "profile": true, "delayMs": 120000 }));
    assert_eq!(h.call(Verb::GraphRun, &["run", "nightly-build"]), CallOutcome::TimedOut);
    let profile: Value = serde_json::from_str(&std::fs::read_to_string(h.src().join("profile.json")).unwrap()).unwrap();
    let pending = profile["pending"]["requestId"].clone();
    assert!(pending.is_string(), "the killed creation is still pending: {profile}");
    assert_eq!(h.calls().len(), 1);

    h.scenario(json!({ "stdout": created, "profile": true }));
    let CallOutcome::Record { record, .. } = h.call(Verb::GraphRun, &["run", "nightly-build"]) else { panic!("the next run didn't finish") };
    assert_eq!(record["requestId"], pending, "the next run resumed the pending creation");
    assert_eq!(record["workOrderId"], created["workOrderId"]);
    assert_eq!(h.calls(), [["run", "nightly-build", "--json"], ["run", "nightly-build", "--json"]]);
}

/// Runs git in `repo`, which must succeed.
fn git_in(repo: &Path, args: &[&str]) {
    crate::slices::machina::git::run_ok(repo, args).unwrap();
}

#[test]
fn the_graph_workflow_s_files_with_changes_since_the_last_commit() {
    use crate::slices::praxis::models::ChangeStatus;
    use super::bundle::{bundle_changes, BundleFileChange};
    let h = Harness::new();
    saved_graph_workflow(&h.project);
    put(&h.project, "contracts/other.json", json!({ "id": "other" }));
    let repo = h.project.canonicalize().unwrap();
    assert_eq!(bundle_changes(&repo, "release-review").unwrap(), vec![], "a project that isn't a git repository has none");

    git_in(&repo, &["init", "-q"]);
    for (k, v) in [("user.name", "Quay Test"), ("user.email", "quay@example.invalid"), ("core.autocrlf", "false")] {
        git_in(&repo, &["config", k, v]);
    }
    git_in(&repo, &["add", "-A"]);
    git_in(&repo, &["commit", "-q", "-m", "init"]);
    assert_eq!(bundle_changes(&repo, "release-review").unwrap(), vec![]);

    put(&h.project, "graphs/gr1.json", json!({ "id": "gr1", "nodes": [] }));
    put(&h.project, "grants/g1.json", json!({ "id": "g1", "limit": "5" }));
    put(&h.project, "bindings/c1.json", json!({ "version": 1, "graphs": ["gr1"], "grants": ["g2", "g1", "g3"] }));
    put(&h.project, "grants/g3.json", json!({ "id": "g3" }));
    // The graph workflow's own record counts, as the file that names the bundle.
    let record = repo.join(".praxis/graph-workflows/release-review.json");
    std::fs::write(&record, format!("{}\n", std::fs::read_to_string(&record).unwrap())).unwrap();
    // Files outside the bundle don't count.
    put(&h.project, "contracts/other.json", json!({ "id": "other", "x": 1 }));
    let change = |path: &str, status| BundleFileChange { path: path.to_string(), status };
    assert_eq!(
        bundle_changes(&repo, "release-review").unwrap(),
        vec![
            change(".praxis/bindings/c1.json", ChangeStatus::Modified),
            change(".praxis/grants/g1.json", ChangeStatus::Modified),
            change(".praxis/grants/g3.json", ChangeStatus::Added),
            change(".praxis/graph-workflows/release-review.json", ChangeStatus::Modified),
            change(".praxis/graphs/gr1.json", ChangeStatus::Modified),
        ],
        "in path order"
    );

    put(&h.project, "graph-workflows/release-review.json", json!({ "version": 1, "contractId": "c1", "graphId": "gr1" }));
    assert_eq!(bundle_changes(&repo, "release-review").unwrap_err(), "Graph workflow release-review isn't valid: Pick a graph binding.");
}
