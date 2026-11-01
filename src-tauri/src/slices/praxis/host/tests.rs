//! The runner against a fake `praxis` (#446): `fake_praxis.mjs`, laid out as a checkout's
//! `engine` package, replays recorded `--json` records, the stderr phrases `praxis` prints at
//! the SDK pin, and exit codes. The records are the vendored read-model fixtures.

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
}

impl Harness {
    fn new() -> Self {
        Self::with_bounds(CallBounds::default())
    }

    fn with_bounds(bounds: CallBounds) -> Self {
        let root = std::env::temp_dir().join(format!("quay-praxis-cli-{}", Uuid::new_v4().simple()));
        let src = root.join("sdk").join("engine").join("src");
        std::fs::create_dir_all(&src).unwrap();
        let root = PathBuf::from(crate::slices::praxis::store::display_path(&root.canonicalize().unwrap()).unwrap());
        std::fs::write(root.join("sdk").join("engine").join("package.json"), r#"{"name":"@aiws/engine","bin":{"praxis":"src/praxis.mjs"}}"#).unwrap();
        std::fs::write(root.join("sdk").join("engine").join("src").join("praxis.mjs"), FAKE).unwrap();
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let cli = PraxisCli::with(root.join("praxis-cli.json"), bounds, LookupEnv::from_process);
        cli.write_settings(PraxisCliSettings { checkout: Some(root.join("sdk").to_string_lossy().into_owned()), installation: None }).unwrap();
        let changes = Arc::new(Mutex::new(Vec::new()));
        let sink = changes.clone();
        cli.on_condition_changed(move |change| sink.lock().unwrap().push(change.clone()));
        Self { root, project, cli, changes }
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

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn a_catalog_record_is_read_and_the_host_is_signed_in() {
    let h = Harness::new();
    assert_eq!(h.condition(), HostCondition::NotCheckedYet);
    let catalog = fixture("WorkflowCatalog");
    h.scenario(json!({ "stdout": catalog }));
    assert_eq!(h.call(Verb::WorkflowsList, &["workflows", "list"]), CallOutcome::Record { record: catalog });
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
    assert_eq!(h.call(Verb::Run, &["run", "review-code"]), CallOutcome::Record { record: created });

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
        assert_eq!(outcome, &CallOutcome::Record { record: runs.clone() });
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
    assert_eq!(CallBounds::default().create, Duration::from_secs(75));
    let h = Harness::with_bounds(CallBounds { read: Duration::from_millis(500), create: Duration::from_secs(20), ..CallBounds::default() });
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
            assert_eq!(super::outcome::interpret(verb, Some(0), &stdout, ""), CallOutcome::Record { record: case["record"].clone() }, "{}", case["name"]);
        }
    }
}

#[test]
fn a_template_name_the_host_refuses_never_reaches_praxis() {
    let h = Harness::new();
    h.scenario(json!({ "stdout": fixture("WorkflowRuns") }));
    let calls: [(Verb, &[&str]); 3] = [
        (Verb::WorkflowsShow, &["workflows", "show", "Review_Code"]),
        (Verb::Runs, &["runs", "review.code", "--limit", "20"]),
        (Verb::Run, &["run", "con"]),
    ];
    for (verb, args) in calls {
        match h.call(verb, args) {
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
