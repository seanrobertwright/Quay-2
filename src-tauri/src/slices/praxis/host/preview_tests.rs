//! The authoring preview of a workflow template draft (#596) against what the real
//! `praxis preview --template` printed, recorded by `preview_outputs.record.mjs` against the SDK's
//! simulated host.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};
use uuid::Uuid;

use super::{praxis_err, recorded_args, replay, Harness};
use crate::slices::praxis::host::outcome::{CallOutcome, HostCondition, Verb};
use crate::slices::praxis::host::preview::preview_template;
use crate::slices::praxis::host::runner::CallBounds;
use crate::slices::praxis::store::MAX_FILE_BYTES;

/// The recorded case `name`.
fn recorded(name: &str) -> Value {
    let file: Value = serde_json::from_str(include_str!("preview_outputs.fixture.json")).unwrap();
    file["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).unwrap_or_else(|| panic!("no recorded case {name}")).clone()
}

/// The folder the draft's file is written to: one of the harness's own, so a test sees every file in it.
fn drafts(h: &Harness) -> PathBuf {
    let folder = h.root.join("drafts");
    std::fs::create_dir_all(&folder).unwrap();
    folder
}

/// The files left in the drafts folder.
fn left(h: &Harness) -> Vec<String> {
    std::fs::read_dir(drafts(h)).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect()
}

/// Previews `draft` as the Tauri command does, against `scenario`.
fn preview(h: &Harness, draft: &Value, scenario: Value) -> CallOutcome {
    h.scenario(scenario);
    preview_template(&h.cli, &h.project, &drafts(h), draft, Uuid::new_v4())
}

fn draft() -> Value {
    json!({ "description": "Add two numbers", "maxAttempts": 3 })
}

#[test]
fn a_creatable_draft_is_previewed_from_a_file_of_its_own_which_is_then_removed() {
    let h = Harness::new();
    let case = recorded("preview: a template a run can be created from");
    let mut scenario = replay(&case);
    scenario["keepFile"] = json!(1);
    let outcome = preview(&h, &draft(), scenario);
    assert_eq!(outcome, CallOutcome::Record { record: case["stdout"].clone(), trust_hint: None });
    assert_eq!((&case["exit"], &case["stdout"]["creatable"], &case["stdout"]["form"]), (&json!(0), &json!(true), &json!("TEMPLATE")));
    // `praxis` ran once, with the arguments the real CLI took, a file in place of the recorded one, and `--json`.
    let calls = h.calls();
    let [call] = calls.as_slice() else { panic!("praxis ran {} times", calls.len()) };
    let mut expected = recorded_args(&case);
    expected.push("--json".into());
    assert_eq!((&call[..1], &call[2..]), (&expected[..1], &expected[2..]));
    let file = PathBuf::from(&call[1]);
    assert_eq!(file.parent(), Some(drafts(&h).as_path()));
    // The file held the draft while `praxis` ran, and is gone now.
    let kept: Value = serde_json::from_str(&std::fs::read_to_string(h.src().join("kept.json")).unwrap()).unwrap();
    assert_eq!(kept, draft());
    assert_eq!(left(&h), Vec::<String>::new());
    assert_eq!(h.condition(), HostCondition::SimulatedHost);
}

#[test]
fn each_preview_has_a_file_name_of_its_own() {
    let h = Harness::new();
    let scenario = replay(&recorded("preview: a template a run can be created from"));
    preview(&h, &draft(), scenario.clone());
    preview(&h, &draft(), scenario);
    let calls = h.calls();
    assert_eq!(calls.len(), 2);
    assert_ne!(calls[0][1], calls[1][1]);
}

#[test]
fn a_draft_no_run_can_be_created_from_is_an_answer_with_its_diagnostics() {
    let h = Harness::new();
    for (name, valid) in [
        ("preview: a template with an authoring error", false),
        ("preview: a valid template no run can be created from", true),
        ("preview: a template that carries identities", false),
    ] {
        let case = recorded(name);
        assert_eq!(case["exit"], 1, "{name}");
        let outcome = preview(&h, &draft(), replay(&case));
        assert_eq!(outcome, CallOutcome::Record { record: case["stdout"].clone(), trust_hint: None }, "{name}");
        assert_eq!((&case["stdout"]["creatable"], &case["stdout"]["valid"]), (&json!(false), &json!(valid)), "{name}");
        assert!(case["stdout"]["diagnostics"].as_array().unwrap().iter().any(|d| d["severity"] == "ERROR"), "{name}");
        assert_eq!(left(&h), Vec::<String>::new(), "{name}");
    }
    assert_eq!(h.condition(), HostCondition::SimulatedHost);
}

#[test]
fn exit_1_without_a_preview_record_is_still_a_failure() {
    let h = Harness::new();
    let down = praxis_err("Could not reach the host at https://127.0.0.1:8443; is it running?");
    assert!(matches!(preview(&h, &draft(), json!({ "stderr": down, "exit": 1 })), CallOutcome::HostDown { .. }));
    let refused = json!({ "format": "praxis-error/1", "code": "ENGINE", "hostCode": "HUMAN_REQUIRED", "message": "The host refused the request." });
    assert!(matches!(preview(&h, &draft(), json!({ "stdout": refused, "exit": 1 })), CallOutcome::HostRefused { .. }));
    // Another command's exit 1 is no answer, whatever record is on its stdout.
    let record = recorded("preview: a template with an authoring error")["stdout"].clone();
    h.scenario(json!({ "stdout": record, "exit": 1 }));
    assert!(matches!(h.call(Verb::Agents, &["agents"]), CallOutcome::Refused { .. }));
    assert_eq!(left(&h), Vec::<String>::new());
}

#[test]
fn a_preview_in_another_format_is_not_read() {
    let h = Harness::new();
    let mut record = recorded("preview: a template a run can be created from")["stdout"].clone();
    record["format"] = json!("aiws-authoring-preview/2");
    let detail = "praxis printed a aiws-authoring-preview/2 record, and this Quay reads aiws-authoring-preview/1.".to_string();
    assert_eq!(preview(&h, &draft(), json!({ "stdout": record })), CallOutcome::NeedsUpdate { detail });
    assert_eq!(left(&h), Vec::<String>::new());
}

#[test]
fn a_praxis_that_does_not_know_preview_says_so() {
    let h = Harness::new();
    let unknown = CallOutcome::CommandUnknown { command: "preview".into() };
    assert_eq!(preview(&h, &draft(), json!({ "stderr": praxis_err("unknown command: preview"), "exit": 2 })), unknown);
    let usage = json!({ "format": "praxis-error/1", "code": "USAGE", "message": "unknown command: preview" });
    assert_eq!(preview(&h, &draft(), json!({ "stdout": usage, "exit": 2 })), unknown);
    // Arguments a `praxis` that has the command didn't accept are Quay's to fix.
    let outcome = preview(&h, &draft(), json!({ "stderr": praxis_err("unknown option --template"), "exit": 2 }));
    assert!(matches!(outcome, CallOutcome::NeedsUpdate { .. }));
    assert_eq!(left(&h), Vec::<String>::new());
}

#[test]
fn the_file_is_removed_after_a_timeout() {
    let h = Harness::with_bounds(CallBounds { read: Duration::from_millis(400), ..CallBounds::default() });
    assert_eq!(preview(&h, &draft(), json!({ "delayMs": 120000 })), CallOutcome::TimedOut);
    assert_eq!(left(&h), Vec::<String>::new());
}

#[test]
fn a_draft_that_is_not_an_object_or_is_too_large_is_refused_before_praxis_runs() {
    let h = Harness::new();
    h.scenario(json!({}));
    for draft in [json!([]), json!("text"), Value::Null, json!({ "description": "x".repeat(MAX_FILE_BYTES as usize) })] {
        assert!(matches!(preview_template(&h.cli, &h.project, &drafts(&h), &draft, Uuid::new_v4()), CallOutcome::Refused { .. }));
    }
    assert_eq!(h.calls(), Vec::<Vec<String>>::new());
    assert_eq!(left(&h), Vec::<String>::new());
}

#[test]
fn a_folder_that_cannot_be_written_to_is_a_refusal() {
    let h = Harness::new();
    h.scenario(json!({}));
    let outcome = preview_template(&h.cli, &h.project, &h.root.join("no-such-folder"), &draft(), Uuid::new_v4());
    assert!(matches!(outcome, CallOutcome::Refused { message } if message.contains("couldn't write the draft")));
    assert_eq!(h.calls(), Vec::<Vec<String>>::new());
}

#[test]
fn the_preview_is_a_read() {
    assert!(!Verb::Preview.writes());
}
