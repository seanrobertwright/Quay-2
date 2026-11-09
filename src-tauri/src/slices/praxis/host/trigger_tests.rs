//! The graph trigger commands (#474) against what the real `praxis` printed for each, recorded by
//! `trigger_outputs.record.mjs` against the SDK's simulated host.

use std::path::Path;

use serde_json::{json, Value};
use uuid::Uuid;

use super::{put, replay, Harness};
use crate::slices::praxis::host::commands::{check_fire_id, trigger_submit_operands, MAX_FIRE_ID};
use crate::slices::praxis::host::outcome::{CallOutcome, HostCondition, Verb};
use crate::slices::praxis::host::trigger::trigger_operands;
use crate::slices::praxis::template_name::{GRAPH_WORKFLOW_NAME_RULE, TRIGGER_NAME_RULE};

/// The recorded case `name`.
fn recorded(name: &str) -> Value {
    let file: Value = serde_json::from_str(include_str!("trigger_outputs.fixture.json")).unwrap();
    file["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).unwrap_or_else(|| panic!("no recorded case {name}")).clone()
}

/// `args` with the path after `--trigger` cut to its file name, since the recorded trigger file and
/// a test project's saved one sit in different folders.
fn file_names(args: &[String]) -> Vec<String> {
    let mut after_flag = false;
    args.iter()
        .map(|arg| {
            let kept = if after_flag { Path::new(arg).file_name().unwrap().to_string_lossy().into_owned() } else { arg.clone() };
            after_flag = arg == "--trigger";
            kept
        })
        .collect()
}

/// The arguments the real `praxis` took in `case`, then `--json`, which the runner adds.
fn praxis_took(case: &Value) -> Vec<String> {
    let mut args: Vec<String> = case["args"].as_array().unwrap().iter().map(|a| a.as_str().unwrap().to_string()).collect();
    args.push("--json".into());
    args
}

/// Runs `verb` with `operands` against `case` replayed, and checks `praxis` ran once with the
/// arguments the real CLI took, the trigger file by its name.
fn call(h: &Harness, verb: Verb, operands: &[impl AsRef<str>], case: &Value) -> CallOutcome {
    h.scenario(replay(case));
    let args = verb.args(operands.iter().map(|o| o.as_ref().to_string()));
    let outcome = h.cli.call(&h.project, verb, &args, Uuid::new_v4());
    assert_eq!(h.calls().iter().map(|c| file_names(c)).collect::<Vec<_>>(), [praxis_took(case)], "{}", case["name"]);
    outcome
}

/// A SCHEDULED trigger `id` of contract `release`, as the recorder submits it.
fn trigger(id: &str) -> Value {
    json!({
        "id": id, "revision": "1", "kind": "SCHEDULED", "source": "praxis", "eventType": "schedule.tick", "contractId": "release",
        "action": "START_RUN", "enabled": true, "notBefore": "0", "expiresAt": "4102444800000", "maxAgeMs": "3600000",
        "maxConcurrent": "5", "rateLimit": "100", "rateWindowMs": "3600000", "maxDepth": "0",
        "schedule": { "startMs": "0", "intervalMs": "60000", "catchUp": "ALL", "maxCatchUp": "3" }
    })
}

/// Saves trigger `id`, its Starts target `release-review`, and that graph workflow, of contract `release`.
fn saved_trigger(project: &Path, id: &str) {
    put(project, &format!("triggers/{id}.json"), trigger(id));
    put(project, &format!("trigger-targets/{id}.json"), json!({ "version": 1, "graphWorkflow": "release-review" }));
    put(project, "graph-workflows/release-review.json", json!({ "version": 1, "contractId": "release", "graphId": "gr1", "graphBindingId": "b1" }));
}

fn root(h: &Harness) -> std::path::PathBuf {
    h.project.canonicalize().unwrap()
}

#[test]
fn a_check_sends_the_saved_trigger_and_names_the_target_its_target_file_names() {
    let h = Harness::new();
    saved_trigger(&h.project, "nightly");
    let operands = trigger_operands(&root(&h), "nightly").unwrap();
    let path = h.project.join(".praxis").join("triggers").join("nightly.json").to_string_lossy().into_owned();
    assert_eq!(operands, ["nightly", "--workflow", "release-review", "--trigger", &path]);
    let case = recorded("triggers check: valid");
    assert_eq!(call(&h, Verb::TriggersCheck, &operands, &case), CallOutcome::Record { record: case["stdout"].clone(), trust_hint: None });
    assert_eq!(h.condition(), HostCondition::SimulatedHost);
}

#[test]
fn a_submission_becomes_a_candidate_with_its_review_page() {
    for (base, name, id, revision) in [(None, "triggers submit: a candidate", "nightly", 1), (Some(1), "triggers submit: a second candidate", "on-push", 2)] {
        let h = Harness::new();
        saved_trigger(&h.project, id);
        let case = recorded(name);
        let outcome = call(&h, Verb::TriggersSubmit, &trigger_submit_operands(&root(&h), id, base, None).unwrap(), &case);
        let CallOutcome::Record { record, .. } = outcome else { panic!("{name}: {outcome:?}") };
        assert_eq!((record["status"].as_str(), record["revision"].as_u64()), (Some("CANDIDATE"), Some(revision)), "{name}");
        assert!(record["admissionPageAddress"].as_str().unwrap().ends_with(&format!("#graph-trigger={id}&revision={revision}")), "{name}");
        assert_eq!(h.condition(), HostCondition::SimulatedHost, "{name}");
    }
}

#[test]
fn a_trigger_the_host_finds_faults_in_gives_its_findings_on_exit_9() {
    for (verb, name, code) in [
        (Verb::TriggersCheck, "triggers check: faults, exit 9", "EVENT_SOURCE_NOT_ADMITTED"),
        (Verb::TriggersSubmit, "triggers submit: faults, exit 9", "TRIGGER_DEPTH_UNSUPPORTED"),
    ] {
        let h = Harness::new();
        saved_trigger(&h.project, "nightly");
        let case = recorded(name);
        let outcome = call(&h, verb, &trigger_operands(&root(&h), "nightly").unwrap(), &case);
        assert_eq!(outcome, CallOutcome::TriggerInvalid { record: case["stdout"].clone() }, "{name}");
        assert_eq!(case["stdout"]["findings"][0]["code"], code, "{name}");
        assert_eq!(serde_json::to_value(&outcome).unwrap()["kind"], "triggerInvalid");
        assert_eq!(h.condition(), HostCondition::SimulatedHost, "{name}");
    }
}

#[test]
fn each_trigger_read_is_read_with_the_arguments_praxis_took() {
    let older = recorded("triggers fires: older");
    let older_args = older["args"].as_array().unwrap();
    let before = older_args[older_args.iter().position(|a| a == "--before").unwrap() + 1].as_str().unwrap().to_string();
    let cases: Vec<(Verb, Vec<&str>, &str)> = vec![
        (Verb::TriggersList, vec!["--limit", "100"], "triggers list"),
        (Verb::TriggersShow, vec!["nightly"], "triggers show: a candidate"),
        (Verb::TriggersShow, vec!["on-push"], "triggers show: admitted and enabled"),
        (Verb::TriggersShow, vec!["later"], "triggers show: admitted but blocked"),
        (Verb::TriggersShow, vec!["on-push"], "triggers show: admitted but disabled"),
        (Verb::TriggersShow, vec!["on-push"], "triggers show: retired"),
        (Verb::TriggersRevisions, vec!["on-push", "--before", "2", "--limit", "20"], "triggers show: older revisions"),
        (Verb::TriggersFires, vec!["on-push", "--limit", "20"], "triggers fires"),
        (Verb::TriggersFires, vec!["on-push", "--limit", "20", "--before", &before], "triggers fires: older"),
        (Verb::TriggersFires, vec!["later", "--limit", "20"], "triggers fires: none"),
    ];
    for (verb, operands, name) in cases {
        let h = Harness::new();
        let case = recorded(name);
        let outcome = call(&h, verb, &operands, &case);
        assert_eq!(outcome, CallOutcome::Record { record: case["stdout"].clone(), trust_hint: None }, "{name}");
        assert_eq!(h.condition(), HostCondition::SimulatedHost, "{name}");
    }
    // The fires page holds the run the first fire created, and the fires it held.
    let page = &recorded("triggers fires")["stdout"]["fires"];
    assert!(page.as_array().unwrap().iter().any(|f| f["disposition"] == "ADMITTED" && f["workOrderId"].is_string()));
    assert!(page.as_array().unwrap().iter().any(|f| f["disposition"] == "REFUSED" && f["reason"] == "RUN_HELD"));
}

#[test]
fn each_trigger_write_is_sent_as_praxis_took_it() {
    for (verb, operands, name) in [
        (Verb::TriggersWithdraw, vec!["nightly", "1"], "triggers withdraw: a pending candidate"),
        (Verb::TriggersDisable, vec!["on-push"], "triggers disable"),
        (Verb::TriggersRetire, vec!["on-push"], "triggers retire"),
    ] {
        let h = Harness::new();
        let case = recorded(name);
        assert_eq!(call(&h, verb, &operands, &case), CallOutcome::Record { record: case["stdout"].clone(), trust_hint: None }, "{name}");
        assert_eq!(h.condition(), HostCondition::SimulatedHost, "{name}");
    }
}

#[test]
fn each_trigger_command_s_recorded_refusal_carries_the_host_s_code() {
    let check = |h: &Harness| {
        saved_trigger(&h.project, "nightly");
        trigger_operands(&root(h), "nightly").unwrap()
    };
    let cases: Vec<(Verb, &dyn Fn(&Harness) -> Vec<String>, &str, &str)> = vec![
        (Verb::TriggersCheck, &check, "triggers check: target not on host", "NOT_FOUND"),
        (Verb::TriggersSubmit, &check, "triggers submit: target not on host", "NOT_FOUND"),
        (Verb::TriggersShow, &|_| vec!["nothing-here".into()], "triggers show: not submitted", "NOT_FOUND"),
        (Verb::TriggersWithdraw, &|_| vec!["nightly".into(), "1".into()], "triggers withdraw: not pending", "REVISION_NOT_PENDING"),
        (Verb::TriggersFires, &|_| vec!["nothing-here".into(), "--limit".into(), "20".into()], "triggers fires: not submitted", "NOT_FOUND"),
        (Verb::TriggersDisable, &|_| vec!["on-push".into()], "triggers disable: retired", "TRIGGER_STATE_CONFLICT"),
        (Verb::TriggersRetire, &|_| vec!["on-push".into()], "triggers retire: already retired", "TRIGGER_STATE_CONFLICT"),
    ];
    for (verb, operands, name, code) in cases {
        let h = Harness::new();
        let mut case = recorded(name);
        // The target the recorded check named is not the one a test project's target file names.
        if let Some(at) = case["args"].as_array().unwrap().iter().position(|a| a == "nothing-here") {
            if matches!(verb, Verb::TriggersCheck | Verb::TriggersSubmit) {
                case["args"][at] = json!("release-review");
            }
        }
        let outcome = call(&h, verb, &operands(&h), &case);
        let message = case["stdout"]["message"].as_str().unwrap().to_string();
        assert_eq!(outcome, CallOutcome::HostRefused { message, host_code: code.into(), record: case["stdout"].clone() }, "{name}");
        assert_eq!(h.condition(), HostCondition::SimulatedHost, "{name}");
    }
}

#[test]
fn an_unconfirmed_trigger_write_is_unknown_with_the_request_id_to_resend() {
    let h = Harness::new();
    let case = recorded("triggers retire: outcome unknown (made)");
    let request_id = "3f2c8a1e-5b7d-4e9a-8c6f-0d1e2a3b4c5d";
    let outcome = call(&h, Verb::TriggersRetire, &["on-push", "--request-id", request_id], &case);
    assert_eq!(outcome, CallOutcome::Unknown { detail: case["stdout"]["message"].as_str().unwrap().to_string(), request_id: Some(request_id.into()) });
    assert_eq!(h.condition(), HostCondition::NotCheckedYet);
    // A resent submission puts `--base`, then `--request-id`, after the trigger file.
    let h = Harness::new();
    saved_trigger(&h.project, "nightly");
    let id = Uuid::parse_str(request_id).unwrap();
    let operands = trigger_submit_operands(&root(&h), "nightly", Some(2), Some(id)).unwrap();
    assert_eq!(operands[5..], ["--base", "2", "--request-id", request_id]);
}

#[test]
fn every_trigger_write_has_the_write_timeout_and_every_read_pins_its_format() {
    for verb in [Verb::TriggersSubmit, Verb::TriggersWithdraw, Verb::TriggersDisable, Verb::TriggersRetire] {
        assert!(verb.writes(), "{verb:?}");
    }
    for (verb, format) in [
        (Verb::TriggersList, "aiws-graph-triggers/1"),
        (Verb::TriggersShow, "aiws-graph-trigger/1"),
        (Verb::TriggersRevisions, "aiws-graph-trigger-revisions/1"),
        (Verb::TriggersFires, "aiws-graph-trigger-fires/1"),
    ] {
        assert!(!verb.writes(), "{verb:?}");
        assert_eq!(verb.args(["x".to_string()]).last().map(String::as_str), Some(format), "{verb:?}");
    }
    assert!(!Verb::TriggersCheck.writes());
}

#[test]
fn a_trigger_record_in_a_format_quay_does_not_read_needs_an_update() {
    let h = Harness::new();
    let mut case = recorded("triggers show: a candidate");
    case["stdout"]["format"] = json!("aiws-graph-trigger/2");
    h.scenario(replay(&case));
    let outcome = h.cli.call(&h.project, Verb::TriggersShow, &Verb::TriggersShow.args(["nightly".to_string()]), Uuid::new_v4());
    assert!(matches!(&outcome, CallOutcome::NeedsUpdate { detail } if detail.contains("aiws-graph-trigger/2")), "{outcome:?}");
    assert_eq!(h.condition(), HostCondition::NotCheckedYet);
}

#[test]
fn a_trigger_name_the_host_refuses_never_reaches_praxis() {
    let h = Harness::new();
    h.scenario(replay(&recorded("triggers show: a candidate")));
    for (verb, operands) in [
        (Verb::TriggersShow, vec!["Nightly"]),
        (Verb::TriggersRevisions, vec!["con", "--before", "2", "--limit", "20"]),
        (Verb::TriggersFires, vec!["check", "--limit", "20"]),
        (Verb::TriggersWithdraw, vec!["", "1"]),
        (Verb::TriggersDisable, vec!["night_ly"]),
        (Verb::TriggersRetire, vec!["check"]),
        (Verb::TriggersCheck, vec!["check", "--workflow", "release-review", "--trigger", "x.json"]),
        (Verb::TriggersSubmit, vec!["Nightly", "--workflow", "release-review", "--trigger", "x.json"]),
    ] {
        let args = verb.args(operands.iter().map(|o| o.to_string()));
        assert_eq!(h.cli.call(&h.project, verb, &args, Uuid::new_v4()), CallOutcome::Refused { message: TRIGGER_NAME_RULE.into() }, "{args:?}");
    }
    assert!(h.calls().is_empty(), "{:?}", h.calls());
    assert_eq!(h.condition(), HostCondition::NotCheckedYet);
}

#[test]
fn a_trigger_quay_can_t_submit_is_refused_before_praxis_runs() {
    let refusal = |id: &str, change: &dyn Fn(&Path)| {
        let h = Harness::new();
        saved_trigger(&h.project, "nightly");
        change(&h.project);
        trigger_operands(&root(&h), id).unwrap_err()
    };
    let nothing = |_: &Path| {};
    assert_eq!(refusal("check", &nothing), TRIGGER_NAME_RULE);
    assert_eq!(refusal("weekly", &nothing), ".praxis/triggers/weekly.json doesn't exist.");
    let untargeted = |p: &Path| std::fs::remove_file(p.join(".praxis/trigger-targets/nightly.json")).unwrap();
    assert_eq!(refusal("nightly", &untargeted), "Trigger nightly has no Starts target, so it stays a local record and can't go to the host.");
    let blank = |p: &Path| put(p, "trigger-targets/nightly.json", json!({ "version": 1, "graphWorkflow": "" }));
    assert_eq!(refusal("nightly", &blank), "Trigger nightly has no Starts target, so it stays a local record and can't go to the host.");
    let unreadable = |p: &Path| std::fs::write(p.join(".praxis/trigger-targets/nightly.json"), "{").unwrap();
    assert!(refusal("nightly", &unreadable).starts_with("Trigger nightly's target file can't be read: "));
    let misnamed = |p: &Path| put(p, "trigger-targets/nightly.json", json!({ "version": 1, "graphWorkflow": "Release" }));
    assert_eq!(refusal("nightly", &misnamed), GRAPH_WORKFLOW_NAME_RULE);
    // The first error the trigger form shows for the saved files, as the form words it.
    let edited = |field: &'static str, value: Value| {
        move |p: &Path| {
            let mut t = trigger("nightly");
            t[field] = value.clone();
            put(p, "triggers/nightly.json", t);
        }
    };
    assert_eq!(refusal("nightly", &edited("kind", json!("MANUAL"))), "Trigger nightly isn't valid: A graph trigger can't be MANUAL.");
    assert_eq!(
        refusal("nightly", &edited("contractId", json!("other"))),
        "Trigger nightly isn't valid: Graph workflow release-review runs under contract release, so the trigger must name contract release, not other."
    );
    let no_workflow = |p: &Path| std::fs::remove_file(p.join(".praxis/graph-workflows/release-review.json")).unwrap();
    assert_eq!(refusal("nightly", &no_workflow), "Trigger nightly isn't valid: No saved graph workflow has the id release-review.");
}

#[test]
fn fire_ids_are_the_whole_numbers_praxis_takes() {
    assert_eq!(MAX_FIRE_ID, 999_999_999_999_999);
    assert!(check_fire_id(1).is_ok() && check_fire_id(MAX_FIRE_ID).is_ok());
    assert_eq!(check_fire_id(0).unwrap_err(), "A fire id is a whole number from 1 to 999999999999999, not 0.");
    assert!(check_fire_id(MAX_FIRE_ID + 1).is_err());
}
