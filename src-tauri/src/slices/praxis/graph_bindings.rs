//! Graph bindings (#247, #273): `aiws-graph-binding/1` documents in
//! `.praxis/graph-bindings/<graphBindingId>.json`, one per binding, each saying how every
//! dispatchable node (TASK, LOOP and COMPENSATION) of one graph revision runs.
//!
//! The schema and its fixtures are PROVISIONAL, vendored at the AI-WS-SDK commit that
//! published them (AI-WS-SDK #289). Shape checks run here with the `jsonschema` crate the
//! SDK uses, never in the frontend. A binding pins its graph by `graphRevision` and
//! `graphDigest`, read from the graph file as saved on disk, never from an unsaved draft.

use std::collections::BTreeSet;
use std::path::Path;

use serde_json::{Map, Value};

use super::models::{BindingSuggestions, GraphPin, PraxisKind};
use super::store::{confined_dir, json_ids, read_definition, validate_id};
use super::validate::{check_canonical, escape, field_issue, with_verdict, Diagnostic, Found, Severity, Validation};

/// The most binding files `binding_suggestions` reads.
pub const MAX_BINDINGS_SCANNED: usize = 10_000;

/// The most values `binding_suggestions` returns for each field.
pub const MAX_SUGGESTIONS: usize = 500;

/// The entry fields `binding_suggestions` collects, in `BindingSuggestions` field order.
const SUGGESTED_FIELDS: [&str; 4] = ["agentId", "protocolBindingId", "action", "resource"];

/// How many hex digits of the content's SHA-256 make `graphBindingRevision`: 52 bits, so the
/// integer stays within the schema's 2^53 - 1.
const REVISION_HEX_DIGITS: usize = 13;

/// `graphBindingRevision` for `record`'s content (#247): the leading 52 bits of the SDK digest
/// of its canonical JSON without `graphBindingRevision`, as an integer of at least 1. The schema
/// takes an integer, so the digest is a number rather than #222's `sha256:` string, but it is
/// still a content digest: the same content always gets the same revision. `None` when the
/// record isn't an object or holds something the SDK can't canonicalize.
pub fn binding_revision(record: &Value) -> Option<u64> {
    let mut content = record.as_object()?.clone();
    content.remove("graphBindingRevision");
    let digest = aiws_sdk::digest(&Value::Object(content)).ok()?;
    let hex = digest.strip_prefix("sha256:")?.get(..REVISION_HEX_DIGITS)?;
    u64::from_str_radix(hex, 16).ok().map(|n| n.max(1))
}

/// The pin of the graph `graph_id` as saved on disk: its `revision` and the SDK digest of the
/// record exactly as the file holds it. `None` when there is no such graph file, or the id
/// can't name one. Refused when the file can't be read or isn't a JSON object, or the SDK
/// can't digest it.
pub fn graph_pin(repo: &Path, graph_id: &str) -> Result<Option<GraphPin>, String> {
    if validate_id(graph_id).is_err() {
        return Ok(None);
    }
    let file = read_definition(repo, PraxisKind::Graphs, graph_id)?;
    if file.missing {
        return Ok(None);
    }
    let graph = file.content.ok_or_else(|| {
        let why = file.problem.map_or_else(|| "it can't be read".to_string(), |p| p.message);
        format!("Graph {} can't be pinned: {}", graph_id, why)
    })?;
    let digest = aiws_sdk::digest(&graph).map_err(|e| format!("Graph {} can't be digested: {}", graph_id, e.code))?;
    let revision = graph.get("revision").and_then(Value::as_str).map(str::to_string);
    Ok(Some(GraphPin { revision, digest }))
}

/// The non-blank `agentId`, `protocolBindingId`, `action` and `resource` values of every
/// entry in the project's saved graph bindings (#247), each list distinct and sorted. It reads
/// the first `MAX_BINDINGS_SCANNED` files in id order, skips any that can't be read, and keeps
/// the first `MAX_SUGGESTIONS` values of each field: these are hints, not checks.
pub fn binding_suggestions(repo: &Path) -> Result<BindingSuggestions, String> {
    let folder = PraxisKind::GraphBindings.folder();
    let Some(dir) = confined_dir(repo, folder)? else { return Ok(BindingSuggestions::default()) };
    let mut found: [BTreeSet<String>; 4] = Default::default();
    for id in json_ids(&dir, folder)?.into_iter().take(MAX_BINDINGS_SCANNED) {
        let Ok(file) = read_definition(repo, PraxisKind::GraphBindings, &id) else { continue };
        let Some(nodes) = file.content.as_ref().and_then(|c| c.get("nodes")).and_then(Value::as_object) else {
            continue;
        };
        for entry in nodes.values() {
            for (field, values) in SUGGESTED_FIELDS.iter().zip(found.iter_mut()) {
                if let Some(value) = entry.get(*field).and_then(Value::as_str).filter(|v| !v.trim().is_empty()) {
                    values.insert(value.to_string());
                }
            }
        }
    }
    let [agent_id, protocol_binding_id, action, resource] =
        found.map(|values| values.into_iter().take(MAX_SUGGESTIONS).collect());
    Ok(BindingSuggestions { agent_id, protocol_binding_id, action, resource })
}

/// Fills a binding's `graphRevision` and `graphDigest` from its graph as saved on disk, when
/// they are unset (#247): a new binding is pinned on its first save. A pin already set stays,
/// so a binding whose graph changed stays Stale until Retarget to current graph re-pins it.
/// A graph that isn't saved, or can't be read, leaves the pins as they are.
pub fn fill_pins(repo: &Path, record: &mut Map<String, Value>) {
    let unset = |key: &str| record.get(key).is_none_or(|v| v.as_str() == Some(""));
    if !unset("graphRevision") || !unset("graphDigest") {
        return;
    }
    let Some(graph_id) = record.get("graphId").and_then(Value::as_str) else { return };
    let Ok(Some(pin)) = graph_pin(repo, graph_id) else { return };
    if let Some(revision) = pin.revision {
        record.insert("graphRevision".to_string(), Value::String(revision));
        record.insert("graphDigest".to_string(), Value::String(pin.digest));
    }
}

/// The node kinds Praxis dispatches, which are the kinds a binding has an entry for.
pub const DISPATCHABLE_KINDS: [&str; 3] = ["TASK", "LOOP", "COMPENSATION"];

/// The vendored graph binding schema, compiled once.
fn schema() -> &'static jsonschema::Validator {
    static VALIDATOR: std::sync::OnceLock<jsonschema::Validator> = std::sync::OnceLock::new();
    VALIDATOR.get_or_init(|| {
        let schema: Value = serde_json::from_str(include_str!("../../../vendor/aiws/spec/engine-v1/graph-binding.schema.json"))
            .expect("the vendored graph binding schema is JSON");
        jsonschema::validator_for(&schema).expect("the vendored graph binding schema compiles")
    })
}

fn describe(code: &str) -> &'static str {
    match code {
        "INVALID_RECORD" => "The binding doesn't match the PROVISIONAL graph binding schema.",
        "UNSAFE_NUMBER" => "A number isn't a whole number between -(2^53 - 1) and 2^53 - 1.",
        "INPUT_LIMIT" => "The binding is nested more deeply than Praxis allows.",
        "BINDING_INCOMPLETE" => "The binding doesn't have exactly one entry per TASK, LOOP and COMPENSATION node.",
        _ => "Praxis refuses this binding.",
    }
}

/// The ids of a graph's dispatchable nodes, in node order. Nodes without a string id are left
/// out: the graph's own validation reports them.
pub fn dispatchable_ids(graph: &Value) -> Vec<&str> {
    graph_nodes(graph)
        .filter(|n| n.get("kind").and_then(Value::as_str).is_some_and(|k| DISPATCHABLE_KINDS.contains(&k)))
        .filter_map(|n| n.get("id").and_then(Value::as_str))
        .collect()
}

/// The graph's nodes, in node order; none when it has no `nodes` array.
fn graph_nodes(graph: &Value) -> impl Iterator<Item = &Value> {
    graph.get("nodes").and_then(Value::as_array).into_iter().flatten()
}

/// An issue about one node's entry, placed on that node so its card and the Problems list show it.
fn entry_issue(path: String, node_id: &str, message: String) -> Diagnostic {
    Diagnostic {
        code: "BINDING_INCOMPLETE".to_string(),
        severity: Severity::Error,
        message,
        path,
        node_id: Some(node_id.to_string()),
        field: None,
    }
}

/// Validates a graph binding (#273): its shape against the vendored PROVISIONAL schema, the
/// numbers canonical JSON refuses, and, with `graph`, its completeness. Each dispatchable node
/// without an entry, and each entry for a node the graph lacks, is a `BINDING_INCOMPLETE` error
/// on that node. The other submission and attach checks against the graph and its contracts
/// are #274's.
pub fn validate_graph_binding(binding: &Value, graph: Option<&Value>) -> Validation {
    let mut found = Found::default();
    let mut verdict: Option<String> = None;
    // A field can break more than one schema rule; one message per path and message is enough.
    let mut seen = std::collections::HashSet::new();
    for error in schema().iter_errors(binding) {
        let path = error.instance_path.as_str().to_string();
        let message = error.to_string();
        if seen.insert((path.clone(), message.clone())) {
            found.push(field_issue(&path, "INVALID_RECORD", message));
            verdict.get_or_insert_with(|| "INVALID_RECORD".to_string());
        }
    }
    check_canonical(binding, "", 0, &mut |code, path, message| {
        found.push(field_issue(path, code, message));
        verdict.get_or_insert_with(|| code.to_string());
    });
    if let (Some(graph), Some(entries)) = (graph, binding.get("nodes").and_then(Value::as_object)) {
        let dispatchable = dispatchable_ids(graph);
        for id in &dispatchable {
            if !entries.contains_key(*id) {
                found.push(entry_issue("/nodes".to_string(), id, format!("Node {} has no entry, so Praxis can't tell what it runs.", id)));
                verdict.get_or_insert_with(|| "BINDING_INCOMPLETE".to_string());
            }
        }
        let all: Vec<&str> = graph_nodes(graph).filter_map(|n| n.get("id").and_then(Value::as_str)).collect();
        for id in entries.keys().filter(|id| !all.contains(&id.as_str())) {
            let path = format!("/nodes/{}", escape(id));
            found.push(entry_issue(path, id, format!("The graph has no node {}. Retarget to current graph drops this entry.", id)));
            verdict.get_or_insert_with(|| "BINDING_INCOMPLETE".to_string());
        }
    }
    with_verdict(verdict, found, describe)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;
    use crate::slices::praxis::models::{PraxisKind, SaveOutcome};
    use crate::slices::praxis::store::{list_definitions, read_definition, save_definition};

    fn temp_repo() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quay2-praxis-bindings-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    fn write(repo: &Path, rel: &str, body: &str) {
        let path = repo.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn fixtures() -> Value {
        serde_json::from_str(include_str!("../../../vendor/aiws/spec/engine-v1/graph-binding.fixtures.json")).unwrap()
    }

    /// The fixtures' graph, with the digest the SDK publishes for it.
    fn fixture_graph() -> (Value, String) {
        let vector = &fixtures()["graphs"][0];
        (vector["graph"].clone(), vector["digest"].as_str().unwrap().to_string())
    }

    fn binding(id: &str, graph_id: &str) -> Value {
        json!({
            "format": "aiws-graph-binding/1",
            "graphBindingId": id,
            "graphBindingRevision": 1,
            "graphId": graph_id,
            "graphRevision": "",
            "graphDigest": "",
            "costUnit": "micro-USD",
            "maxTotalActiveMs": 3600000,
            "nodes": {}
        })
    }

    fn save(repo: &Path, record: Value, expected: Option<&str>) -> Value {
        let id = record["graphBindingId"].as_str().unwrap().to_string();
        match save_definition(repo, PraxisKind::GraphBindings, &id, record, None, None, expected, None, false).unwrap() {
            SaveOutcome::Saved { content, .. } => content,
            other => panic!("not saved: {other:?}"),
        }
    }

    // --- the kind -----------------------------------------------------------------

    #[test]
    fn bindings_live_in_their_own_folder_and_list_with_their_graph() {
        let repo = temp_repo();
        write(&repo, ".praxis/graph-bindings/g-1.json", &binding("g-1", "g").to_string());
        write(&repo, ".praxis/graph-bindings/g-2.json", &binding("other", "g").to_string());
        let list = list_definitions(&repo, PraxisKind::GraphBindings).unwrap();
        assert_eq!(list.entries.len(), 2);
        assert_eq!(list.entries[0].graph_id.as_deref(), Some("g"));
        assert_eq!(list.entries[0].id_mismatch, None);
        // The id inside a binding is its graphBindingId.
        assert_eq!(list.entries[1].id_mismatch.as_ref().unwrap().found.as_deref(), Some("other"));
        assert_eq!(serde_json::to_value(PraxisKind::GraphBindings).unwrap(), json!("graph-bindings"));
    }

    #[test]
    fn a_binding_id_that_could_leave_the_folder_is_refused() {
        let repo = temp_repo();
        for id in ["../graphs/g", "..", "a/b", "a\\b"] {
            assert!(read_definition(&repo, PraxisKind::GraphBindings, id).is_err(), "{id}");
            let saved = save_definition(&repo, PraxisKind::GraphBindings, id, binding(id, "g"), None, None, None, None, false);
            assert!(saved.is_err(), "{id}");
        }
        assert!(!repo.join(".praxis/graphs").exists());
    }

    // --- graphBindingRevision -----------------------------------------------------

    #[test]
    fn saving_sets_the_revision_to_a_content_digest() {
        let repo = temp_repo();
        let saved = save(&repo, binding("release-review-1", "release-review"), None);
        // The first 13 hex digits of the SHA-256 of the canonical JSON without the revision,
        // computed outside Quay: 9790a3d17d568...
        assert_eq!(saved["graphBindingRevision"], json!(2666359672001896u64));
        assert_eq!(binding_revision(&saved), Some(2666359672001896));
    }

    #[test]
    fn the_revision_follows_the_content_and_ignores_the_old_revision() {
        let mut a = binding("b", "g");
        let mut b = binding("b", "g");
        b["graphBindingRevision"] = json!(77);
        assert_eq!(binding_revision(&a), binding_revision(&b));
        a["costUnit"] = json!("cents");
        assert_ne!(binding_revision(&a), binding_revision(&b));
        let revision = binding_revision(&a).unwrap();
        assert!((1..=9_007_199_254_740_991).contains(&revision));
    }

    // --- pins -----------------------------------------------------------------------

    #[test]
    fn the_pin_is_the_saved_graph_s_revision_and_sdk_digest() {
        let repo = temp_repo();
        let (graph, digest) = fixture_graph();
        write(&repo, ".praxis/graphs/release-review.json", &graph.to_string());
        let pin = graph_pin(&repo, "release-review").unwrap().unwrap();
        assert_eq!(pin, GraphPin { revision: Some("3".to_string()), digest });
        assert_eq!(graph_pin(&repo, "absent").unwrap(), None);
    }

    #[test]
    fn saving_fills_the_pins_from_the_graph_on_disk() {
        let repo = temp_repo();
        let (graph, digest) = fixture_graph();
        write(&repo, ".praxis/graphs/release-review.json", &graph.to_string());
        let saved = save(&repo, binding("release-review-1", "release-review"), None);
        assert_eq!(saved["graphRevision"], "3");
        assert_eq!(saved["graphDigest"], json!(digest));
    }

    #[test]
    fn saving_keeps_pins_already_set_so_a_stale_binding_stays_stale() {
        let repo = temp_repo();
        let (graph, _) = fixture_graph();
        write(&repo, ".praxis/graphs/release-review.json", &graph.to_string());
        let mut old = binding("release-review-1", "release-review");
        old["graphRevision"] = json!("2");
        old["graphDigest"] = json!(format!("sha256:{}", "a".repeat(64)));
        let saved = save(&repo, old.clone(), None);
        assert_eq!(saved["graphRevision"], "2");
        assert_eq!(saved["graphDigest"], old["graphDigest"]);
        // The graph on disk has moved on, so the pin no longer matches it.
        let pin = graph_pin(&repo, "release-review").unwrap().unwrap();
        assert_ne!(pin.revision.as_deref(), saved["graphRevision"].as_str());
    }

    #[test]
    fn a_binding_of_a_graph_never_saved_keeps_empty_pins() {
        let repo = temp_repo();
        let saved = save(&repo, binding("b", "nowhere"), None);
        assert_eq!(saved["graphRevision"], "");
        assert_eq!(saved["graphDigest"], "");
    }

    #[test]
    fn keys_are_written_in_schema_order() {
        let repo = temp_repo();
        let mut record = binding("b", "g");
        record["nodes"] = json!({"t": {"maxTaskMs": 1000, "agentId": "a", "role": "WORK", "executionKind": "AGENT"}});
        let reordered: serde_json::Map<String, Value> = record.as_object().unwrap().clone().into_iter().rev().collect();
        let saved = save(&repo, Value::Object(reordered), None);
        let keys = |v: &Value| v.as_object().unwrap().keys().cloned().collect::<Vec<_>>();
        assert_eq!(
            keys(&saved),
            ["format", "graphBindingId", "graphBindingRevision", "graphId", "graphRevision", "graphDigest", "costUnit", "maxTotalActiveMs", "nodes"]
        );
        assert_eq!(keys(&saved["nodes"]["t"]), ["executionKind", "role", "agentId", "maxTaskMs"]);
    }

    // --- shape checks -----------------------------------------------------------------

    fn errors(v: &crate::slices::praxis::validate::Validation) -> Vec<(String, String, Option<String>)> {
        v.diagnostics
            .iter()
            .filter(|d| d.severity == crate::slices::praxis::validate::Severity::Error)
            .map(|d| (d.code.clone(), d.path.clone(), d.node_id.clone()))
            .collect()
    }

    #[test]
    fn the_vendored_schema_is_the_provisional_graph_binding_schema() {
        let schema: Value =
            serde_json::from_str(include_str!("../../../vendor/aiws/spec/engine-v1/graph-binding.schema.json")).unwrap();
        assert_eq!(schema["x-aiws-format"], "aiws-graph-binding/1");
        assert_eq!(schema["x-aiws-stability"], "PROVISIONAL");
    }

    #[test]
    fn every_vendored_fixture_gets_the_shape_verdict_it_names() {
        let fixtures = fixtures();
        let cases = fixtures["cases"].as_array().unwrap();
        assert!(cases.len() > 50, "the vendored fixtures are all there");
        for case in cases {
            let v = validate_graph_binding(&case["record"], None);
            let valid = case["valid"].as_bool().unwrap();
            assert_eq!(v.verdict.is_none(), valid, "{}: {:?}", case["name"], v.diagnostics);
            if !valid {
                assert_eq!(v.diagnostics[0].severity, crate::slices::praxis::validate::Severity::Error, "{}", case["name"]);
            }
        }
    }

    #[test]
    fn a_shape_issue_points_at_its_field() {
        let mut record = binding("b", "g");
        record["maxTotalActiveMs"] = json!(5);
        record["costUnit"] = json!("");
        let v = validate_graph_binding(&record, None);
        assert_eq!(v.verdict.as_deref(), Some("INVALID_RECORD"));
        let paths: Vec<String> = errors(&v).into_iter().map(|e| e.1).collect();
        assert!(paths.contains(&"/maxTotalActiveMs".to_string()), "{paths:?}");
        assert!(paths.contains(&"/costUnit".to_string()), "{paths:?}");
    }

    // --- completeness against the graph -------------------------------------------------

    /// A binding with pins of the right shape, so only completeness can fail.
    fn pinned(id: &str, graph_id: &str) -> Value {
        let mut record = binding(id, graph_id);
        record["graphRevision"] = json!("1");
        record["graphDigest"] = json!(format!("sha256:{}", "0".repeat(64)));
        record
    }

    fn agent_entry() -> Value {
        json!({
            "executionKind": "AGENT", "role": "WORK", "agentId": "claude-code",
            "commands": [["npm", "test"]], "outputPaths": ["out.txt"],
            "exposure": {"kind": "NOT_APPLICABLE", "justification": "no model"},
            "maxTaskMs": 60000, "requirements": []
        })
    }

    #[test]
    fn each_dispatchable_node_without_an_entry_is_binding_incomplete() {
        let (graph, _) = fixture_graph();
        let mut record = pinned("b", "release-review");
        record["nodes"] = json!({"build": agent_entry(), "test": agent_entry()});
        let v = validate_graph_binding(&record, Some(&graph));
        assert_eq!(v.verdict.as_deref(), Some("BINDING_INCOMPLETE"));
        // publish (TASK), fix (LOOP) and rollback (COMPENSATION) have no entry; the gates and END need none.
        assert_eq!(
            errors(&v),
            [
                ("BINDING_INCOMPLETE".to_string(), "/nodes".to_string(), Some("fix".to_string())),
                ("BINDING_INCOMPLETE".to_string(), "/nodes".to_string(), Some("publish".to_string())),
                ("BINDING_INCOMPLETE".to_string(), "/nodes".to_string(), Some("rollback".to_string())),
            ]
        );
    }

    #[test]
    fn an_entry_for_a_node_the_graph_lacks_is_binding_incomplete_too() {
        let graph = json!({"id": "g", "revision": "1", "nodes": [
            {"id": "t", "kind": "TASK", "dependsOn": [], "config": {"executionKind": "AGENT"}},
            {"id": "end", "kind": "END", "dependsOn": ["t"], "config": {}}
        ]});
        let mut record = pinned("b", "g");
        record["nodes"] = json!({"t": agent_entry(), "gone": agent_entry()});
        let v = validate_graph_binding(&record, Some(&graph));
        assert_eq!(errors(&v), [("BINDING_INCOMPLETE".to_string(), "/nodes/gone".to_string(), Some("gone".to_string()))]);
    }

    #[test]
    fn a_complete_binding_has_no_issues() {
        let graph = json!({"id": "g", "revision": "1", "nodes": [
            {"id": "t", "kind": "TASK", "dependsOn": [], "config": {"executionKind": "AGENT"}},
            {"id": "end", "kind": "END", "dependsOn": ["t"], "config": {}}
        ]});
        let mut record = pinned("b", "g");
        record["nodes"] = json!({"t": agent_entry()});
        let v = validate_graph_binding(&record, Some(&graph));
        assert_eq!(v.verdict, None);
        assert!(errors(&v).is_empty(), "{:?}", v.diagnostics);
    }

    #[test]
    fn suggestions_are_the_ids_used_across_every_saved_binding() {
        let repo = temp_repo();
        write(
            &repo,
            ".praxis/graph-bindings/b.json",
            r#"{"graphBindingId": "b", "nodes": {"x": {"agentId": "codex"}, "y": {"protocolBindingId": "gh", "action": "merge", "resource": "repo"}}}"#,
        );
        write(
            &repo,
            ".praxis/graph-bindings/a.json",
            r#"{"graphBindingId": "a", "nodes": {"x": {"agentId": "claude-code"}, "z": {"agentId": "codex", "action": " "}}}"#,
        );
        write(&repo, ".praxis/graph-bindings/broken.json", "{");
        let found = binding_suggestions(&repo).unwrap();
        assert_eq!(found.agent_id, vec!["claude-code", "codex"]);
        assert_eq!(found.protocol_binding_id, vec!["gh"]);
        assert_eq!(found.action, vec!["merge"]);
        assert_eq!(found.resource, vec!["repo"]);
        assert_eq!(binding_suggestions(&temp_repo()).unwrap(), BindingSuggestions::default());
    }
}
