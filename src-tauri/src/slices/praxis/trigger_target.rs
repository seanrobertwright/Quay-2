//! Trigger targets (#469, #472): `.praxis/trigger-targets/<trigger-id>.json` names the graph
//! workflow a trigger starts, so the trigger file stays a plain SDK `Trigger`. A trigger with a
//! target gets the Praxis host's graph trigger rules, from `GRAPH_TRIGGER_RULES`, and must
//! name its target's contract. All of it is checked offline, against the saved graph workflow.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use super::models::PraxisKind;
use super::store::{capped_ids, read_record, shown_path, validate_id, MAX_TRIGGERS_SCANNED, TRIGGER_TARGETS_DIR};
use super::validate::{check_size, field_issue, Diagnostic};

/// What breaks one graph trigger rule.
enum Breaks {
    /// The field holds this value.
    Is(&'static str),
    /// The field is set to anything but the decimal `"0"`.
    NotZero,
    /// The field is present on a trigger of this kind.
    OnKind(&'static str),
    /// The field is present on a trigger of any other kind.
    OffKind(&'static str),
}

/// One of the Praxis host's graph trigger rules, from AI-WS-SDK `spec/engine-v1/GRAPH-TRIGGERS.md`,
/// "Submission checks": the field it is about, what breaks it, the code the host refuses it with,
/// and how to fix it.
struct GraphTriggerRule {
    field: &'static str,
    breaks: Breaks,
    code: &'static str,
    message: &'static str,
    hint: &'static str,
}

/// The host's graph trigger rules that Quay checks before a submit (#469). They are design, not
/// gaps, so they hold for every trigger with a target and none without. The rules that need the
/// host's records, such as an admitted event source, are the host's to check.
const GRAPH_TRIGGER_RULES: &[GraphTriggerRule] = &[
    GraphTriggerRule {
        field: "kind",
        breaks: Breaks::Is("MANUAL"),
        code: "MANUAL_USE_GRAPH_RUNS",
        message: "A graph trigger can't be MANUAL.",
        hint: "Start a graph run of the graph workflow instead, or pick SCHEDULED, EVENT or CONDITION.",
    },
    GraphTriggerRule {
        field: "kind",
        breaks: Breaks::Is("EXTERNAL_RESPONSE"),
        code: "EXTERNAL_RESPONSE_USE_WAIT",
        message: "A graph trigger can't fire on an external response.",
        hint: "A WAIT node in the graph waits for the response instead.",
    },
    GraphTriggerRule {
        field: "kind",
        breaks: Breaks::Is("RESOURCE_CHANGE"),
        code: "RESOURCE_CHANGE_USE_EVENT",
        message: "A graph trigger can't fire on a resource change.",
        hint: "Make it an EVENT trigger, and have a relay send an event when the resource changes.",
    },
    GraphTriggerRule {
        field: "kind",
        breaks: Breaks::Is("WORKFLOW_LIFECYCLE"),
        code: "NOT_YET_SUPPORTED",
        message: "Praxis doesn't support WORKFLOW_LIFECYCLE graph triggers yet.",
        hint: "Pick SCHEDULED, EVENT or CONDITION.",
    },
    GraphTriggerRule {
        field: "action",
        breaks: Breaks::Is("RESUME_WAIT"),
        code: "RESUME_WAIT_USE_BINDING",
        message: "A graph trigger can only start a run.",
        hint: "The graph binding says what satisfies each WAIT node, so set the action to START_RUN.",
    },
    GraphTriggerRule {
        field: "maxDepth",
        breaks: Breaks::NotZero,
        code: "TRIGGER_DEPTH_UNSUPPORTED",
        message: "A graph trigger's max depth must be 0.",
        hint: "Praxis fires graph triggers only on events no run caused.",
    },
    GraphTriggerRule {
        field: "filter",
        breaks: Breaks::OnKind("SCHEDULED"),
        code: "TRIGGER_FILTER_UNSUPPORTED",
        message: "A SCHEDULED graph trigger can't have a filter.",
        hint: "Remove the filter: a schedule has no event to compare.",
    },
    GraphTriggerRule {
        field: "conditionMode",
        breaks: Breaks::OffKind("CONDITION"),
        code: "CONDITION_MODE_UNSUPPORTED",
        message: "Only a CONDITION graph trigger has a condition mode.",
        hint: "Make the trigger CONDITION, or remove conditionMode from its file.",
    },
];

/// A value a picker still lists but a graph trigger can't take, with the host's code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusedValue {
    pub field: String,
    pub value: String,
    pub code: String,
}

/// A trigger's checks as a graph trigger (#472). All empty for a trigger without a target.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerTargetCheck {
    /// The `contractId` of the saved target graph workflow, which the trigger must name, when
    /// it is a string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    /// The kinds and actions the rules refuse, in the rules' order, so the pickers mark them.
    pub refused: Vec<RefusedValue>,
    /// Each rule the trigger breaks, as an error with the host's code and a hint on the field it
    /// is about; an empty source or event type on an EVENT or CONDITION trigger; a target no
    /// saved graph workflow has; and a contract other than the target's.
    pub diagnostics: Vec<Diagnostic>,
}

/// Whether `rule` is broken by `trigger`.
fn breaks(rule: &GraphTriggerRule, trigger: &Value) -> bool {
    let value = trigger.get(rule.field);
    let kind = trigger.get("kind").and_then(Value::as_str);
    match rule.breaks {
        Breaks::Is(refused) => value.and_then(Value::as_str) == Some(refused),
        Breaks::NotZero => value.is_some_and(|v| v.as_str() != Some("0")),
        Breaks::OnKind(on) => value.is_some() && kind == Some(on),
        Breaks::OffKind(only) => value.is_some() && kind != Some(only),
    }
}

/// An error that carries a hint.
fn hinted(path: &str, code: &str, message: &str, hint: &str) -> Diagnostic {
    Diagnostic { hint: Some(hint.to_string()), ..field_issue(path, code, message.to_string()) }
}

/// Checks `trigger` as a graph trigger that starts the graph workflow `target` (#472): the host's
/// graph trigger rules, a source and event type for an EVENT or CONDITION trigger, which Quay
/// can't look up, and the target, read as saved, whose contract the trigger must name. With no
/// target there is nothing to check. Content over the size limit is refused.
pub fn check_trigger_target(repo: &Path, trigger: &Value, target: Option<&str>) -> Result<TriggerTargetCheck, String> {
    check_size(trigger)?;
    let Some(target) = target else { return Ok(TriggerTargetCheck::default()) };
    let mut diagnostics = Vec::new();
    let refused = GRAPH_TRIGGER_RULES
        .iter()
        .filter_map(|rule| match rule.breaks {
            Breaks::Is(value) => Some(RefusedValue { field: rule.field.into(), value: value.into(), code: rule.code.into() }),
            _ => None,
        })
        .collect();
    for rule in GRAPH_TRIGGER_RULES.iter().filter(|rule| breaks(rule, trigger)) {
        diagnostics.push(hinted(&format!("/{}", rule.field), rule.code, rule.message, rule.hint));
    }

    // The host looks up the event source and its declared types, which no command lists, so an
    // event-driven trigger only has to name them.
    let kind = trigger.get("kind").and_then(Value::as_str);
    if matches!(kind, Some("EVENT" | "CONDITION")) {
        let blank = |key: &str| trigger.get(key).and_then(Value::as_str).is_some_and(|v| v.trim().is_empty());
        if blank("source") {
            let hint = "Type the name of an event source the host admits. Quay can't list them.";
            diagnostics.push(hinted("/source", "SOURCE_NOT_SET", "A graph trigger fired by events needs their source.", hint));
        }
        if blank("eventType") {
            let hint = "Type an event type its source declares.";
            diagnostics.push(hinted("/eventType", "EVENT_TYPE_NOT_SET", "A graph trigger fired by events needs their type.", hint));
        }
    }

    // The target as saved, since a submission sends the saved files only.
    let mut contract_id = None;
    let read = match validate_id(target) {
        Err(why) => Err(field_issue("/target", "INVALID_FIELD", format!("The graph workflow id isn't valid. {}", why))),
        Ok(()) => read_record(repo, PraxisKind::GraphWorkflows.folder(), target)
            .map_err(|why| field_issue("/target", "UNREADABLE", format!("Graph workflow {} can't be read: {}", target, why))),
    };
    match read {
        Err(issue) => diagnostics.push(issue),
        Ok(None) => diagnostics.push(field_issue("/target", "NOT_FOUND", format!("No saved graph workflow has the id {}.", target))),
        Ok(Some(workflow)) => contract_id = workflow.get("contractId").and_then(Value::as_str).map(str::to_string),
    }
    let named = trigger.get("contractId").and_then(Value::as_str).filter(|c| !c.is_empty());
    if let (Some(named), Some(theirs)) = (named, &contract_id)
        && named != theirs
    {
        let message = format!("Graph workflow {} runs under contract {}, so the trigger must name contract {}, not {}.", target, theirs, theirs, named);
        let hint = format!("Use contract {}, or start another graph workflow.", theirs);
        diagnostics.push(Diagnostic { hint: Some(hint), ..field_issue("/contractId", "CONTRACT_MISMATCH", message) });
    }
    Ok(TriggerTargetCheck { contract_id, refused, diagnostics })
}

/// The triggers that start a graph workflow (#479), for its form's Triggers section.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphWorkflowTriggers {
    /// The ids of the triggers whose target file names the graph workflow, in id order.
    pub ids: Vec<String>,
    /// One line per target file that wasn't searched or was left out, as `ContractTriggers`
    /// names its own: it can't be read, it is past `MAX_TRIGGERS_SCANNED`, or no trigger has it.
    pub unchecked: Vec<String>,
}

/// The triggers whose target file, `.praxis/trigger-targets/<trigger-id>.json`, names the graph
/// workflow `graph_workflow` as its `graphWorkflow` (#479), read as saved. A rename keeps this
/// true without a second record: renaming a trigger moves its target file and renaming the graph
/// workflow rewrites the target files that name it (#472). A target file whose trigger doesn't
/// exist is named in `unchecked` rather than listed, since there is no trigger to open.
pub fn graph_workflow_triggers(repo: &Path, graph_workflow: &str) -> Result<GraphWorkflowTriggers, String> {
    validate_id(graph_workflow)?;
    let mut out = GraphWorkflowTriggers::default();
    let shown = |id: &str| shown_path(TRIGGER_TARGETS_DIR, id);
    for id in capped_ids(repo, TRIGGER_TARGETS_DIR, MAX_TRIGGERS_SCANNED, &mut out.unchecked)? {
        let target = match read_record(repo, TRIGGER_TARGETS_DIR, &id) {
            Ok(Some(target)) => target,
            Ok(None) => continue,
            Err(why) => {
                out.unchecked.push(format!("{}: {}", shown(&id), why));
                continue;
            }
        };
        if target.get("graphWorkflow").and_then(Value::as_str) != Some(graph_workflow) {
            continue;
        }
        match read_record(repo, PraxisKind::Triggers.folder(), &id) {
            Ok(Some(_)) => out.ids.push(id),
            Ok(None) => out.unchecked.push(format!("{}: no trigger {} has this target file.", shown(&id), id)),
            Err(why) => out.unchecked.push(format!("{}: its trigger can't be read: {}", shown(&id), why)),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::{json, Value};

    use super::*;
    use crate::slices::praxis::validate::Severity;
    use crate::test_support::TempDir;

    fn write(repo: &Path, rel: &str, body: &str) {
        let path = repo.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    /// A project with graph workflow `ship`, which runs under contract `c`.
    fn repo() -> TempDir {
        let repo = TempDir::canonical("praxis-target");
        write(&repo, ".praxis/graph-workflows/ship.json", r#"{"version": 1, "contractId": "c", "graphId": "g", "graphBindingId": "g-1"}"#);
        repo
    }

    /// An EVENT trigger that starts a run under contract `c`, which every rule accepts.
    fn trigger() -> Value {
        json!({
            "id": "t", "kind": "EVENT", "source": "github", "eventType": "push", "contractId": "c",
            "action": "START_RUN", "maxDepth": "0"
        })
    }

    /// The diagnostics' codes with their paths.
    fn codes(check: &TriggerTargetCheck) -> Vec<(&str, &str)> {
        check.diagnostics.iter().map(|d| (d.code.as_str(), d.path.as_str())).collect()
    }

    fn check(t: &Value) -> TriggerTargetCheck {
        check_trigger_target(&repo(), t, Some("ship")).unwrap()
    }

    #[test]
    fn a_trigger_without_a_target_gets_no_graph_trigger_checks() {
        let mut t = trigger();
        t["kind"] = json!("MANUAL");
        t["maxDepth"] = json!("3");
        let checked = check_trigger_target(&repo(), &t, None).unwrap();
        assert_eq!(checked, TriggerTargetCheck::default());
    }

    #[test]
    fn a_trigger_every_rule_accepts_has_no_issues_and_carries_its_target_s_contract() {
        let checked = check(&trigger());
        assert_eq!(codes(&checked), vec![]);
        assert_eq!(checked.contract_id.as_deref(), Some("c"));
    }

    #[test]
    fn each_refused_kind_is_an_error_with_the_host_s_code_and_a_hint() {
        for (kind, code) in [
            ("MANUAL", "MANUAL_USE_GRAPH_RUNS"),
            ("EXTERNAL_RESPONSE", "EXTERNAL_RESPONSE_USE_WAIT"),
            ("RESOURCE_CHANGE", "RESOURCE_CHANGE_USE_EVENT"),
            ("WORKFLOW_LIFECYCLE", "NOT_YET_SUPPORTED"),
        ] {
            let mut t = trigger();
            t["kind"] = json!(kind);
            let checked = check(&t);
            assert_eq!(codes(&checked), vec![(code, "/kind")], "{kind}");
            let d = &checked.diagnostics[0];
            assert_eq!(d.severity, Severity::Error);
            assert!(d.hint.as_deref().is_some_and(|h| !h.is_empty()), "{kind} has a hint");
        }
        for kind in ["SCHEDULED", "EVENT", "CONDITION"] {
            let mut t = trigger();
            t["kind"] = json!(kind);
            assert!(!codes(&check(&t)).iter().any(|(_, path)| *path == "/kind"), "{kind} is allowed");
        }
    }

    #[test]
    fn resume_wait_is_refused_for_start_run() {
        let mut t = trigger();
        t["action"] = json!("RESUME_WAIT");
        assert_eq!(codes(&check(&t)), vec![("RESUME_WAIT_USE_BINDING", "/action")]);
    }

    #[test]
    fn a_nonzero_max_depth_is_refused() {
        let mut t = trigger();
        t["maxDepth"] = json!("2");
        assert_eq!(codes(&check(&t)), vec![("TRIGGER_DEPTH_UNSUPPORTED", "/maxDepth")]);
    }

    #[test]
    fn a_filter_on_a_scheduled_trigger_is_refused_and_on_an_event_trigger_is_kept() {
        let mut t = trigger();
        t["filter"] = json!({"field": "ref", "equals": "main"});
        assert_eq!(codes(&check(&t)), vec![]);
        t["kind"] = json!("SCHEDULED");
        assert_eq!(codes(&check(&t)), vec![("TRIGGER_FILTER_UNSUPPORTED", "/filter")]);
    }

    #[test]
    fn a_condition_mode_belongs_only_to_a_condition_trigger() {
        let mut t = trigger();
        t["conditionMode"] = json!("EDGE");
        assert_eq!(codes(&check(&t)), vec![("CONDITION_MODE_UNSUPPORTED", "/conditionMode")]);
        t["kind"] = json!("CONDITION");
        t["filter"] = json!({"field": "ref", "equals": "main"});
        assert_eq!(codes(&check(&t)), vec![]);
    }

    #[test]
    fn a_contract_other_than_the_target_s_is_an_error_naming_the_target_s() {
        let mut t = trigger();
        t["contractId"] = json!("other");
        let checked = check(&t);
        assert_eq!(codes(&checked), vec![("CONTRACT_MISMATCH", "/contractId")]);
        assert_eq!(checked.contract_id.as_deref(), Some("c"));
        assert!(checked.diagnostics[0].message.contains("contract c"), "{}", checked.diagnostics[0].message);
        // An empty contract is the SDK's to flag; the form fills it when the target is picked.
        t["contractId"] = json!("");
        assert_eq!(codes(&check(&t)), vec![]);
    }

    #[test]
    fn a_target_no_saved_graph_workflow_has_is_flagged_and_its_contract_unknown() {
        let checked = check_trigger_target(&repo(), &trigger(), Some("gone")).unwrap();
        assert_eq!(codes(&checked), vec![("NOT_FOUND", "/target")]);
        assert_eq!(checked.contract_id, None);
        let repo = repo();
        write(&repo, ".praxis/graph-workflows/broken.json", "{nope");
        assert_eq!(codes(&check_trigger_target(&repo, &trigger(), Some("broken")).unwrap()), vec![("UNREADABLE", "/target")]);
        assert_eq!(codes(&check_trigger_target(&repo, &trigger(), Some("a/b")).unwrap()), vec![("INVALID_FIELD", "/target")]);
    }

    #[test]
    fn an_event_or_condition_trigger_with_an_empty_source_or_event_type_is_flagged() {
        for kind in ["EVENT", "CONDITION"] {
            let mut t = trigger();
            t["kind"] = json!(kind);
            t["filter"] = json!({"field": "ref", "equals": "main"});
            t["conditionMode"] = json!("EDGE");
            if kind == "EVENT" {
                t.as_object_mut().unwrap().remove("conditionMode");
            }
            t["source"] = json!("");
            t["eventType"] = json!("  ");
            assert_eq!(codes(&check(&t)), vec![("SOURCE_NOT_SET", "/source"), ("EVENT_TYPE_NOT_SET", "/eventType")], "{kind}");
            assert!(check(&t).diagnostics.iter().all(|d| d.hint.is_some()));
        }
        // A schedule fires on its slots, so the host doesn't read them.
        let mut t = trigger();
        t["kind"] = json!("SCHEDULED");
        t["source"] = json!("");
        assert_eq!(codes(&check(&t)), vec![]);
    }

    // --- the triggers that start a graph workflow (#479) ------------------------------------

    /// Trigger `id` with a target file naming `target` as its `graphWorkflow`.
    fn targeted(repo: &Path, id: &str, target: &str) {
        write(repo, &format!(".praxis/triggers/{id}.json"), &format!(r#"{{"id": "{id}", "contractId": "c"}}"#));
        write(repo, &format!(".praxis/trigger-targets/{id}.json"), &format!(r#"{{"version": 1, "graphWorkflow": "{target}"}}"#));
    }

    #[test]
    fn a_graph_workflow_s_triggers_are_those_whose_target_file_names_it_in_id_order() {
        let repo = repo();
        targeted(&repo, "nightly", "ship");
        targeted(&repo, "Alpha", "ship");
        targeted(&repo, "other", "review");
        // A trigger with no target file starts nothing, whatever its contract.
        write(&repo, ".praxis/triggers/plain.json", r#"{"id": "plain", "contractId": "c"}"#);
        let found = graph_workflow_triggers(&repo, "ship").unwrap();
        assert_eq!(found.ids, vec!["Alpha", "nightly"]);
        assert_eq!(found.unchecked, Vec::<String>::new());
        assert_eq!(graph_workflow_triggers(&repo, "review").unwrap().ids, vec!["other"]);
    }

    #[test]
    fn no_trigger_starts_a_graph_workflow_when_none_names_it_or_there_are_no_targets() {
        let repo = repo();
        assert_eq!(graph_workflow_triggers(&repo, "ship").unwrap(), GraphWorkflowTriggers::default());
        targeted(&repo, "t", "review");
        assert_eq!(graph_workflow_triggers(&repo, "ship").unwrap(), GraphWorkflowTriggers::default());
        assert!(graph_workflow_triggers(&repo, "../ship").is_err(), "an unsafe id is refused");
    }

    #[test]
    fn a_target_file_that_can_t_be_read_or_has_no_trigger_is_skipped_and_named() {
        let repo = repo();
        targeted(&repo, "good", "ship");
        write(&repo, ".praxis/trigger-targets/broken.json", "{nope");
        // A target file left behind with no trigger, as only a hand edit leaves one.
        write(&repo, ".praxis/trigger-targets/orphan.json", r#"{"version": 1, "graphWorkflow": "ship"}"#);
        let found = graph_workflow_triggers(&repo, "ship").unwrap();
        assert_eq!(found.ids, vec!["good"]);
        assert_eq!(found.unchecked.len(), 2, "{:?}", found.unchecked);
        assert!(found.unchecked[0].starts_with(".praxis/trigger-targets/broken.json: "), "{}", found.unchecked[0]);
        assert_eq!(found.unchecked[1], ".praxis/trigger-targets/orphan.json: no trigger orphan has this target file.");
    }

    #[test]
    fn the_refused_kinds_and_actions_are_listed_for_the_pickers() {
        let checked = check(&trigger());
        let refused: Vec<(&str, &str, &str)> =
            checked.refused.iter().map(|r| (r.field.as_str(), r.value.as_str(), r.code.as_str())).collect();
        assert_eq!(
            refused,
            vec![
                ("kind", "MANUAL", "MANUAL_USE_GRAPH_RUNS"),
                ("kind", "EXTERNAL_RESPONSE", "EXTERNAL_RESPONSE_USE_WAIT"),
                ("kind", "RESOURCE_CHANGE", "RESOURCE_CHANGE_USE_EVENT"),
                ("kind", "WORKFLOW_LIFECYCLE", "NOT_YET_SUPPORTED"),
                ("action", "RESUME_WAIT", "RESUME_WAIT_USE_BINDING"),
            ]
        );
    }
}
