//! Graph workflows (#444, #459): `.praxis/graph-workflows/<name>.json`, the unit Quay will
//! submit to a Praxis host. A graph workflow ties a contract, a graph and one of that graph's
//! graph bindings together, and carries the grants of the contract's bindings file. Its file
//! name is its name on the host, so it holds no id and follows the host's name rule.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use super::graph_bindings::validate_graph_binding;
use super::models::PraxisKind;
use super::store::{read_record, validate_id, BINDINGS_DIR};
use super::validate::{check_size, field_issue, validate_contract, validate_grant, validate_graph, Diagnostic, Found, Severity, Validation};

/// A graph workflow's local checks (#459), against the records it names as saved on disk,
/// since a submission sends the saved files only (#444).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphWorkflowCheck {
    /// The grant set the graph workflow carries: the grants of its contract's bindings file, in
    /// file order. Empty when the contract has no bindings file, or it can't be read.
    pub grants: Vec<String>,
    /// Each check that fails, on the field that names the record at fault: a record that doesn't
    /// exist, can't be read or isn't valid, a graph the contract's bindings file doesn't list,
    /// and a graph binding of another graph. A grant at fault is on the contract, whose bindings
    /// file lists it (#462).
    pub diagnostics: Vec<Diagnostic>,
}

/// The saved record of `kind` that `field` names, or none after an issue on that field saying
/// it doesn't exist or can't be read. `noun` names the kind in the issue's message.
fn saved(found: &mut Found, repo: &Path, kind: PraxisKind, field: &str, noun: &str, id: &str) -> Option<Value> {
    let path = format!("/{}", field);
    match read_record(repo, kind.folder(), id) {
        Ok(Some(record)) => return Some(record),
        Ok(None) => found.push(field_issue(&path, "NOT_FOUND", format!("No saved {} has the id {}.", noun, id))),
        Err(why) => found.push(field_issue(&path, "UNREADABLE", format!("{} {} can't be read: {}", capitalized(noun), id, why))),
    }
    None
}

/// `noun` with its first letter in upper case.
fn capitalized(noun: &str) -> String {
    let mut chars = noun.chars();
    chars.next().map(|first| first.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

/// The id in `field` when it is a filename-safe string; otherwise the shape check flags it and
/// nothing is looked up.
fn reference<'a>(workflow: &'a Value, field: &str) -> Option<&'a str> {
    workflow.get(field).and_then(Value::as_str).filter(|id| validate_id(id).is_ok())
}

/// The strings in a JSON array, or none when it isn't one.
fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
}

/// Checks a graph workflow against the saved records it names: each must exist and be valid,
/// as must each grant its contract's bindings file lists, the bindings file must list the graph,
/// and the graph binding must bind the graph. Every issue is an error on the field naming the
/// record at fault, a grant's on the contract's. Content over the size limit is refused.
pub fn check_graph_workflow(repo: &Path, workflow: &Value) -> Result<GraphWorkflowCheck, String> {
    check_size(workflow)?;
    let mut found = Found::default();
    let mut grants = Vec::new();
    let push = |found: &mut Found, path: &str, code: &str, message: String| found.push(field_issue(path, code, message));
    // A record's validation, as one issue naming its first error.
    let invalid = |found: &mut Found, path: &str, noun: &str, id: &str, v: Validation| {
        if v.verdict.is_none() {
            return;
        }
        let first = v.diagnostics.iter().find(|d| d.severity == Severity::Error).map(|d| d.message.as_str());
        let message = match first {
            Some(why) => format!("{} {} isn't valid: {}", noun, id, why),
            None => format!("{} {} isn't valid.", noun, id),
        };
        found.push(field_issue(path, "INVALID_REFERENCE", message));
    };
    let (contract_id, graph_id, binding_id) =
        (reference(workflow, "contractId"), reference(workflow, "graphId"), reference(workflow, "graphBindingId"));

    // The graphs the contract's bindings file lists: `None` when the contract wasn't read, and
    // `Some(None)` when it has no bindings file.
    let mut bound_graphs: Option<Option<Vec<String>>> = None;
    if let Some(cid) = contract_id {
        if let Some(contract) = saved(&mut found, repo, PraxisKind::Contracts, "contractId", "contract", cid) {
            invalid(&mut found, "/contractId", "Contract", cid, validate_contract(&contract));
            match read_record(repo, BINDINGS_DIR, cid) {
                Ok(None) => bound_graphs = Some(None),
                Ok(Some(bindings)) => {
                    grants = strings(bindings.get("grants"));
                    bound_graphs = Some(Some(strings(bindings.get("graphs"))));
                    for grant in grants.iter().filter(|g| validate_id(g).is_ok()) {
                        match read_record(repo, PraxisKind::Grants.folder(), grant) {
                            Ok(Some(record)) => invalid(&mut found, "/contractId", "Grant", grant, validate_grant(&record)),
                            Ok(None) => {
                                let message = format!("Contract {}'s bindings file lists grant {}, and no saved grant has that id.", cid, grant);
                                push(&mut found, "/contractId", "GRANT_NOT_FOUND", message);
                            }
                            Err(why) => push(&mut found, "/contractId", "UNREADABLE", format!("Grant {} can't be read: {}", grant, why)),
                        }
                    }
                }
                Err(why) => {
                    let message = format!("Contract {}'s bindings file can't be read: {}", cid, why);
                    push(&mut found, "/contractId", "UNREADABLE", message);
                }
            }
        }
    }

    let mut graph = None;
    if let Some(gid) = graph_id {
        if let Some(record) = saved(&mut found, repo, PraxisKind::Graphs, "graphId", "graph", gid) {
            invalid(&mut found, "/graphId", "Graph", gid, validate_graph(&record));
            graph = Some(record);
        }
        if let (Some(cid), Some(bound)) = (contract_id, &bound_graphs) {
            let message = match bound {
                None => Some(format!("Contract {} has no bindings file, so graph {} isn't in it.", cid, gid)),
                Some(graphs) if !graphs.iter().any(|g| g == gid) => {
                    Some(format!("Graph {} isn't in contract {}'s bindings file, so it can't run under it.", gid, cid))
                }
                Some(_) => None,
            };
            if let Some(message) = message {
                push(&mut found, "/graphId", "GRAPH_NOT_BOUND", message);
            }
        }
    }

    if let Some(bid) = binding_id {
        if let Some(binding) = saved(&mut found, repo, PraxisKind::GraphBindings, "graphBindingId", "graph binding", bid) {
            let binds = binding.get("graphId").and_then(Value::as_str);
            if let Some(gid) = graph_id.filter(|gid| binds != Some(*gid)) {
                let message = match binds {
                    Some(other) => format!("Graph binding {} binds graph {}, not {}.", bid, other, gid),
                    None => format!("Graph binding {} binds no graph, not {}.", bid, gid),
                };
                push(&mut found, "/graphBindingId", "BINDING_GRAPH_MISMATCH", message);
            }
            // Checked against the graph too when it is the one the binding binds.
            let against = graph.as_ref().filter(|_| binds.is_some() && binds == graph_id);
            invalid(&mut found, "/graphBindingId", "Graph binding", bid, validate_graph_binding(&binding, against));
        }
    }

    Ok(GraphWorkflowCheck { grants, diagnostics: found.into_validation().diagnostics })
}

/// The `version` a graph workflow is written with.
pub const GRAPH_WORKFLOW_VERSION: u64 = 1;

/// A graph workflow's keys in the order the canonical file writes them.
pub const GRAPH_WORKFLOW_KEYS: &[&str] = &["version", "contractId", "graphId", "graphBindingId"];

/// The reference fields, each with the noun its messages use.
const REFERENCES: [(&str, &str); 3] = [("contractId", "contract"), ("graphId", "graph"), ("graphBindingId", "graph binding")];

/// Validates a graph workflow's shape: `version` is 1, each reference a filename-safe id, and
/// no other field. Whether the records it names exist and agree is `check_graph_workflow`'s.
/// The verdict is the first issue's code.
pub fn validate_graph_workflow(record: &Value) -> Validation {
    let mut found = Found::default();
    match record.as_object() {
        None => found.push(field_issue("", "INVALID_DOCUMENT", "A graph workflow must be a JSON object.".to_string())),
        Some(map) => {
            if map.get("version").and_then(Value::as_u64) != Some(GRAPH_WORKFLOW_VERSION) {
                found.push(field_issue("/version", "INVALID_FIELD", format!("The version must be {}.", GRAPH_WORKFLOW_VERSION)));
            }
            for (field, noun) in REFERENCES {
                let message = match map.get(field) {
                    None => Some(format!("Pick a {}.", noun)),
                    Some(Value::String(id)) if id.is_empty() => Some(format!("Pick a {}.", noun)),
                    Some(Value::String(id)) => validate_id(id).err().map(|why| format!("The {} id isn't valid. {}", noun, why)),
                    Some(_) => Some(format!("The {} id must be a string.", noun)),
                };
                if let Some(message) = message {
                    found.push(field_issue(&format!("/{}", field), "INVALID_FIELD", message));
                }
            }
            for key in map.keys().filter(|k| !GRAPH_WORKFLOW_KEYS.contains(&k.as_str())) {
                let message = format!("A graph workflow has no field {:?}.", key);
                found.push(field_issue(&format!("/{}", super::validate::escape(key)), "UNKNOWN_FIELD", message));
            }
        }
    }
    found.into_validation()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::json;

    use super::*;
    use crate::slices::praxis::models::{BindingsInput, PraxisKind};
    use crate::slices::praxis::store::{read_definition, save_definition};
    use crate::slices::praxis::validate::validate_definition;
    use crate::test_support::TempDir;

    fn save(repo: &Path, kind: PraxisKind, id: &str, content: Value, bindings: Option<BindingsInput>) {
        save_definition(repo, kind, id, content, None, bindings.as_ref(), None, None, false).unwrap();
    }

    fn write(repo: &Path, rel: &str, body: &str) {
        let path = repo.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn contract(id: &str) -> Value {
        json!({
            "id": id, "missionId": id, "aiwsEdition": "0.4", "profile": "finite-v1",
            "budget": "0", "deadline": "1893456000000", "criteria": ["Tests pass"],
            "actions": [], "resources": [], "requiresApproval": true,
            "maxAttempts": "1", "maxAuthorizationAgeMs": "0", "features": ["graphs"]
        })
    }

    fn graph(id: &str) -> Value {
        json!({"id": id, "revision": "unsaved", "nodes": [
            {"id": "build", "kind": "TASK", "dependsOn": [], "config": {"executionKind": "AGENT"}},
            {"id": "end", "kind": "END", "dependsOn": ["build"], "config": {}}
        ]})
    }

    fn binding(id: &str, graph_id: &str) -> Value {
        json!({
            "format": "aiws-graph-binding/1", "graphBindingId": id, "graphBindingRevision": 1, "graphId": graph_id,
            "graphRevision": "", "graphDigest": "", "costUnit": "micro-USD", "maxTotalActiveMs": 60000,
            "nodes": {"build": {
                "executionKind": "AGENT", "role": "WORK", "agentId": "claude-code",
                "commands": [["npm", "test"]], "outputPaths": ["out.txt"],
                "exposure": {"kind": "NOT_APPLICABLE", "justification": "no model"},
                "maxTaskMs": 60000, "requirements": []
            }}
        })
    }

    fn grant(id: &str) -> Value {
        json!({
            "id": id, "subject": "agent", "profile": "finite-v1", "actions": [], "resources": [],
            "notBefore": "0", "expiresAt": "4102444800000", "limit": "0", "canDelegate": false, "depth": "0"
        })
    }

    /// Contract `c` binding graph `g` and grants `root` and `child`, graph `g` and its binding
    /// `g-1`, graph `other` and its binding `other-1`, each saved and valid.
    fn project() -> TempDir {
        let repo = TempDir::canonical("praxis-gw");
        let bound = BindingsInput { graphs: vec!["g".into()], grants: vec!["root".into(), "child".into()] };
        save(&repo, PraxisKind::Contracts, "c", contract("c"), Some(bound));
        for g in ["root", "child"] {
            save(&repo, PraxisKind::Grants, g, grant(g), None);
        }
        for g in ["g", "other"] {
            save(&repo, PraxisKind::Graphs, g, graph(g), None);
            let b = format!("{g}-1");
            save(&repo, PraxisKind::GraphBindings, &b, binding(&b, g), None);
        }
        repo
    }

    fn workflow(contract: &str, graph: &str, binding: &str) -> Value {
        json!({"version": 1, "contractId": contract, "graphId": graph, "graphBindingId": binding})
    }

    fn found(check: &GraphWorkflowCheck) -> Vec<(&str, &str)> {
        check.diagnostics.iter().map(|d| (d.code.as_str(), d.path.as_str())).collect()
    }

    #[test]
    fn the_fixture_records_are_valid() {
        let repo = project();
        let read = |kind: PraxisKind, id: &str| read_definition(&repo, kind, id).unwrap().content.unwrap();
        assert_eq!(validate_definition(PraxisKind::Contracts, &read(PraxisKind::Contracts, "c")).unwrap().verdict, None);
        assert_eq!(validate_definition(PraxisKind::Graphs, &read(PraxisKind::Graphs, "g")).unwrap().verdict, None);
        assert_eq!(validate_definition(PraxisKind::Grants, &read(PraxisKind::Grants, "root")).unwrap().verdict, None);
        let b = read(PraxisKind::GraphBindings, "g-1");
        let v = super::super::graph_bindings::validate_graph_binding(&b, Some(&read(PraxisKind::Graphs, "g")));
        assert_eq!(v.verdict, None, "{v:?}");
    }

    #[test]
    fn records_that_exist_agree_and_are_valid_pass_and_carry_the_contract_s_grants() {
        let repo = project();
        let check = check_graph_workflow(&repo, &workflow("c", "g", "g-1")).unwrap();
        assert_eq!(found(&check), vec![]);
        assert_eq!(check.grants, vec!["root", "child"]);
    }

    #[test]
    fn each_record_that_doesn_t_exist_is_flagged_on_the_field_that_names_it() {
        let repo = project();
        let check = check_graph_workflow(&repo, &workflow("nope", "gone", "lost")).unwrap();
        assert_eq!(found(&check), vec![("NOT_FOUND", "/contractId"), ("NOT_FOUND", "/graphId"), ("NOT_FOUND", "/graphBindingId")]);
        assert_eq!(check.diagnostics[0].message, "No saved contract has the id nope.");
        assert_eq!(check.diagnostics[1].message, "No saved graph has the id gone.");
        assert_eq!(check.diagnostics[2].message, "No saved graph binding has the id lost.");
        assert!(check.grants.is_empty());
    }

    #[test]
    fn a_graph_the_contract_s_bindings_file_doesn_t_list_is_flagged() {
        let repo = project();
        let check = check_graph_workflow(&repo, &workflow("c", "other", "other-1")).unwrap();
        assert_eq!(found(&check), vec![("GRAPH_NOT_BOUND", "/graphId")]);
        assert_eq!(check.diagnostics[0].message, "Graph other isn't in contract c's bindings file, so it can't run under it.");
        assert_eq!(check.grants, vec!["root", "child"]);
        // A contract with no bindings file binds no graph.
        save(&repo, PraxisKind::Contracts, "bare", contract("bare"), None);
        let check = check_graph_workflow(&repo, &workflow("bare", "g", "g-1")).unwrap();
        assert_eq!(found(&check), vec![("GRAPH_NOT_BOUND", "/graphId")]);
        assert_eq!(check.diagnostics[0].message, "Contract bare has no bindings file, so graph g isn't in it.");
    }

    #[test]
    fn a_graph_binding_of_another_graph_is_flagged() {
        let repo = project();
        let check = check_graph_workflow(&repo, &workflow("c", "g", "other-1")).unwrap();
        assert_eq!(found(&check), vec![("BINDING_GRAPH_MISMATCH", "/graphBindingId")]);
        assert_eq!(check.diagnostics[0].message, "Graph binding other-1 binds graph other, not g.");
    }

    #[test]
    fn a_record_that_is_invalid_or_can_t_be_read_is_flagged() {
        let repo = project();
        let mut broken = contract("c");
        broken["deadline"] = json!("");
        write(&repo, ".praxis/contracts/c.json", &broken.to_string());
        write(&repo, ".praxis/graphs/g.json", "{nope");
        let check = check_graph_workflow(&repo, &workflow("c", "g", "g-1")).unwrap();
        assert_eq!(found(&check), vec![("INVALID_REFERENCE", "/contractId"), ("UNREADABLE", "/graphId")]);
        assert_eq!(check.diagnostics[0].message, "Contract c isn't valid: The deadline isn't set.");
        assert!(check.diagnostics[1].message.starts_with("Graph g can't be read: Not valid JSON"), "{}", check.diagnostics[1].message);
        write(&repo, ".praxis/graph-bindings/other-1.json", r#"{"graphBindingId": "other-1", "graphId": "other"}"#);
        let check = check_graph_workflow(&repo, &workflow("c", "other", "other-1")).unwrap();
        let on_binding: Vec<&str> =
            check.diagnostics.iter().filter(|d| d.path == "/graphBindingId").map(|d| d.code.as_str()).collect();
        assert_eq!(on_binding, vec!["INVALID_REFERENCE"], "{:?}", check.diagnostics);
    }

    #[test]
    fn a_grant_the_bundle_carries_that_isn_t_saved_valid_or_readable_is_flagged_on_the_contract() {
        let repo = project();
        std::fs::remove_file(repo.join(".praxis/grants/root.json")).unwrap();
        let mut broken = grant("child");
        broken["limit"] = json!(5);
        write(&repo, ".praxis/grants/child.json", &broken.to_string());
        let check = check_graph_workflow(&repo, &workflow("c", "g", "g-1")).unwrap();
        assert_eq!(found(&check), vec![("GRANT_NOT_FOUND", "/contractId"), ("INVALID_REFERENCE", "/contractId")]);
        assert_eq!(check.diagnostics[0].message, "Contract c's bindings file lists grant root, and no saved grant has that id.");
        assert!(check.diagnostics[1].message.starts_with("Grant child isn't valid"), "{}", check.diagnostics[1].message);
        write(&repo, ".praxis/grants/child.json", "{nope");
        save(&repo, PraxisKind::Grants, "root", grant("root"), None);
        let check = check_graph_workflow(&repo, &workflow("c", "g", "g-1")).unwrap();
        assert_eq!(found(&check), vec![("UNREADABLE", "/contractId")]);
        assert!(check.diagnostics[0].message.starts_with("Grant child can't be read"), "{}", check.diagnostics[0].message);
        // The grant set is still the bindings file's.
        assert_eq!(check.grants, vec!["root", "child"]);
    }

    #[test]
    fn a_reference_the_shape_check_refuses_isn_t_looked_up() {
        let repo = project();
        let check = check_graph_workflow(&repo, &json!({"version": 1, "contractId": "", "graphId": "../g", "graphBindingId": 7})).unwrap();
        assert_eq!(found(&check), vec![]);
        assert!(check_graph_workflow(&repo, &json!([])).unwrap().diagnostics.is_empty());
    }

    fn issues(v: &Validation) -> Vec<(&str, &str)> {
        v.diagnostics.iter().map(|d| (d.code.as_str(), d.path.as_str())).collect()
    }

    #[test]
    fn a_complete_graph_workflow_has_the_right_shape() {
        let v = validate_graph_workflow(&json!({"version": 1, "contractId": "c", "graphId": "g", "graphBindingId": "g-1"}));
        assert_eq!(v.verdict, None, "{v:?}");
        assert!(v.diagnostics.is_empty());
    }

    #[test]
    fn each_reference_must_be_a_filename_safe_id_and_the_version_1() {
        let v = validate_graph_workflow(&json!({"version": 2, "contractId": "", "graphId": 3, "graphBindingId": "a b"}));
        assert_eq!(
            issues(&v),
            vec![("INVALID_FIELD", "/version"), ("INVALID_FIELD", "/contractId"), ("INVALID_FIELD", "/graphId"), ("INVALID_FIELD", "/graphBindingId")]
        );
        assert_eq!(v.verdict.as_deref(), Some("INVALID_FIELD"));
        assert_eq!(v.diagnostics[0].message, "The version must be 1.");
        assert_eq!(v.diagnostics[1].message, "Pick a contract.");
        assert_eq!(v.diagnostics[2].message, "The graph id must be a string.");
        assert!(v.diagnostics[3].message.starts_with("The graph binding id isn't valid."), "{}", v.diagnostics[3].message);
        let missing = validate_graph_workflow(&json!({}));
        assert_eq!(missing.diagnostics[2].message, "Pick a graph.");
        assert_eq!(
            issues(&missing),
            vec![("INVALID_FIELD", "/version"), ("INVALID_FIELD", "/contractId"), ("INVALID_FIELD", "/graphId"), ("INVALID_FIELD", "/graphBindingId")]
        );
    }

    #[test]
    fn a_field_a_graph_workflow_does_not_have_is_flagged_and_a_non_object_refused() {
        let v = validate_graph_workflow(&json!({"version": 1, "contractId": "c", "graphId": "g", "graphBindingId": "b", "grants": []}));
        assert_eq!(issues(&v), vec![("UNKNOWN_FIELD", "/grants")]);
        assert_eq!(issues(&validate_graph_workflow(&json!([]))), vec![("INVALID_DOCUMENT", "")]);
    }
}
