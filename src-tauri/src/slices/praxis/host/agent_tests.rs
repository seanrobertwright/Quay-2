//! The agent picker read (#482) against what the real `praxis agents` printed, recorded by
//! `agent_outputs.record.mjs` against the SDK's simulated host.

use serde_json::{json, Value};
use uuid::Uuid;

use super::{praxis_err, replay, Harness};
use crate::slices::praxis::host::outcome::{CallOutcome, HostCondition, Verb};

/// The recorded case `name`.
fn recorded(name: &str) -> Value {
    let file: Value = serde_json::from_str(include_str!("agent_outputs.fixture.json")).unwrap();
    file["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).unwrap_or_else(|| panic!("no recorded case {name}")).clone()
}

/// Reads the agent picker as the Tauri command does, against `scenario`.
fn read(h: &Harness, scenario: Value) -> CallOutcome {
    h.scenario(scenario);
    h.cli.call(&h.project, Verb::Agents, &Verb::Agents.args([]), Uuid::new_v4())
}

#[test]
fn the_picker_of_a_host_with_a_catalog_lists_its_agents_in_catalog_order_with_why_one_cannot_be_bound() {
    let h = Harness::new();
    let case = recorded("agents: a catalog");
    let outcome = read(&h, replay(&case));
    assert_eq!(outcome, CallOutcome::Record { record: case["stdout"].clone(), trust_hint: None });
    // `praxis` ran once, with the arguments the real CLI took and `--json`, which the runner adds.
    assert_eq!(h.calls(), [vec!["agents", "--format", "aiws-agent-picker/1", "--json"]]);
    let CallOutcome::Record { record, .. } = outcome else { unreachable!() };
    assert_eq!(record["catalog"], true);
    let agents: Vec<(&str, bool)> =
        record["agents"].as_array().unwrap().iter().map(|a| (a["agentId"].as_str().unwrap(), a["selectable"].as_bool().unwrap())).collect();
    assert_eq!(agents, [("ready-coder", true), ("changed-coder", false), ("unadapted-coder", true)]);
    assert_eq!(
        record["agents"][1]["reasons"],
        json!(["The host observes agent changed-coder with capability digest 4a5c57b7543c, not the 397912f62e5a the catalog pins."])
    );
    assert_eq!(h.condition(), HostCondition::SimulatedHost);
}

#[test]
fn the_picker_of_a_host_with_no_catalog_says_so_and_lists_no_agents() {
    let h = Harness::new();
    let case = recorded("agents: no catalog");
    let outcome = read(&h, replay(&case));
    assert_eq!(outcome, CallOutcome::Record { record: case["stdout"].clone(), trust_hint: None });
    assert_eq!((&case["stdout"]["catalog"], &case["stdout"]["agents"]), (&json!(false), &json!([])));
}

#[test]
fn a_picker_in_another_format_is_not_read() {
    let h = Harness::new();
    let mut record = recorded("agents: a catalog")["stdout"].clone();
    record["format"] = json!("aiws-agent-picker/2");
    let outcome = read(&h, json!({ "stdout": record }));
    assert_eq!(outcome, CallOutcome::NeedsUpdate { detail: "praxis printed a aiws-agent-picker/2 record, and this Quay reads aiws-agent-picker/1.".into() });
}

#[test]
fn a_praxis_that_does_not_know_agents_says_so_and_a_host_that_is_down_is_down() {
    let h = Harness::new();
    let unknown = praxis_err("unknown command: agents");
    assert_eq!(read(&h, json!({ "stderr": unknown, "exit": 2 })), CallOutcome::CommandUnknown { command: "agents".into() });
    let down = praxis_err("Could not reach the host at https://127.0.0.1:8443; is it running?");
    assert!(matches!(read(&h, json!({ "stderr": down, "exit": 1 })), CallOutcome::HostDown { .. }));
    assert_eq!(h.condition(), HostCondition::HostUnreachable);
}

#[test]
fn the_picker_is_a_read() {
    assert!(!Verb::Agents.writes());
}
