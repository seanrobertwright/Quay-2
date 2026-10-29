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

/// The most workflow template files `binding_suggestions` reads.
pub const MAX_TEMPLATES_SCANNED: usize = 10_000;

/// The most values `binding_suggestions` returns for each field.
pub const MAX_SUGGESTIONS: usize = 500;

/// The entry fields `binding_suggestions` collects, in `BindingSuggestions` field order.
const SUGGESTED_FIELDS: [&str; 4] = ["agentId", "protocolBindingId", "action", "resource"];

/// The position of `agentId` in `SUGGESTED_FIELDS`, where template agents go.
const AGENT_ID: usize = 0;

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
/// entry in the project's saved graph bindings, and the non-blank `agent` of every saved
/// workflow template (#247), each list distinct and sorted. A template holds no protocol
/// binding, action or resource, so it adds to the agent ids only. It reads the first
/// `MAX_BINDINGS_SCANNED` binding files and the first `MAX_TEMPLATES_SCANNED` template files in
/// id order, skips any that can't be read, and keeps the first `MAX_SUGGESTIONS` values of each
/// field: these are hints, not checks.
pub fn binding_suggestions(repo: &Path) -> Result<BindingSuggestions, String> {
    let mut found: [BTreeSet<String>; 4] = Default::default();
    for (_, record) in saved_bindings(repo, MAX_BINDINGS_SCANNED)?.0 {
        let Some(nodes) = record.get("nodes").and_then(Value::as_object) else { continue };
        for entry in nodes.values() {
            for (field, values) in SUGGESTED_FIELDS.iter().zip(found.iter_mut()) {
                insert_non_blank(values, entry.get(*field));
            }
        }
    }
    for (_, record) in saved_records(repo, PraxisKind::Templates, MAX_TEMPLATES_SCANNED)?.0 {
        insert_non_blank(&mut found[AGENT_ID], record.get("agent"));
    }
    let [agent_id, protocol_binding_id, action, resource] =
        found.map(|values| values.into_iter().take(MAX_SUGGESTIONS).collect());
    Ok(BindingSuggestions { agent_id, protocol_binding_id, action, resource })
}

/// The saved graph bindings by file id, as `saved_records` reads them.
pub fn saved_bindings(repo: &Path, cap: usize) -> Result<(Vec<(String, Value)>, usize), String> {
    saved_records(repo, PraxisKind::GraphBindings, cap)
}

/// The id and content of the first `cap` files of `kind`, in id order, leaving out any that
/// can't be read or parsed, and how many files past `cap` weren't read. Empty when the kind's
/// folder doesn't exist.
fn saved_records(repo: &Path, kind: PraxisKind, cap: usize) -> Result<(Vec<(String, Value)>, usize), String> {
    let folder = kind.folder();
    let Some(dir) = confined_dir(repo, folder)? else { return Ok((Vec::new(), 0)) };
    let ids = json_ids(&dir, folder)?;
    let skipped = ids.len().saturating_sub(cap);
    let records = ids
        .into_iter()
        .take(cap)
        .filter_map(|id| {
            let content = read_definition(repo, kind, &id).ok()?.content?;
            Some((id, content))
        })
        .collect();
    Ok((records, skipped))
}

/// Adds `value` to `values` when it is a string that isn't blank.
fn insert_non_blank(values: &mut BTreeSet<String>, value: Option<&Value>) {
    if let Some(value) = value.and_then(Value::as_str).filter(|v| !v.trim().is_empty()) {
        values.insert(value.to_string());
    }
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
        "BINDING_NODE_KIND" => "The binding has an entry for a node Praxis doesn't dispatch.",
        "BINDING_KIND_MISMATCH" => "A TASK entry's executionKind isn't its node's.",
        "DATA_SCHEMA" => "A TOOL entry's payload doesn't match its node's inputSchema.",
        "INVALID_EXPOSURE" => "An exposure's stop threshold is above its allowance.",
        _ => "Praxis refuses this binding.",
    }
}

/// The schema issues `error` stands for, as (path, message). A `oneOf` of tagged shapes (an
/// entry by its `executionKind`, an exposure by its `kind`) fails as a whole, so its error is
/// replaced by the errors of the one branch whose tag the value carries, each at its own field.
/// When no single branch matches the tag, the `oneOf` error stays, in plainer words.
fn located_schema_issues(error: &jsonschema::ValidationError<'_>, out: &mut Vec<(String, String)>) {
    let path = error.instance_path.as_str();
    if let jsonschema::error::ValidationErrorKind::OneOfNotValid { context } = &error.kind {
        let is_tag = |at: &str| at.strip_prefix(path).is_some_and(|rest| rest == "/executionKind" || rest == "/kind");
        let tagged: Vec<_> = context.iter().filter(|branch| !branch.iter().any(|e| is_tag(e.instance_path.as_str()))).collect();
        if let [branch] = tagged.as_slice() {
            for e in branch.iter() {
                located_schema_issues(e, out);
            }
            return;
        }
        out.push((path.to_string(), "This doesn't match any of the shapes the schema allows here.".to_string()));
        return;
    }
    out.push((path.to_string(), error.to_string()));
}

/// A canonical positive ledger amount as (digit count, digits), so two compare as numbers.
fn amount(v: Option<&Value>) -> Option<(usize, &str)> {
    let s = v?.as_str()?;
    (!s.is_empty() && !s.starts_with('0') && s.bytes().all(|c| c.is_ascii_digit())).then_some((s.len(), s))
}

/// The most characters of one schema error a message quotes: the error quotes the failing
/// value, which can be a whole payload.
const MAX_REASON_CHARS: usize = 200;

/// `text`, cut to `MAX_REASON_CHARS` characters with an ellipsis when it is longer.
fn clipped(text: &str) -> String {
    match text.char_indices().nth(MAX_REASON_CHARS) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_string(),
    }
}

/// The node with `id`, when the graph has one.
fn graph_node<'a>(graph: &'a Value, id: &str) -> Option<&'a Value> {
    graph_nodes(graph).find(|n| n.get("id").and_then(Value::as_str) == Some(id))
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
fn entry_issue(code: &str, severity: Severity, path: String, node_id: &str, message: String) -> Diagnostic {
    Diagnostic { code: code.to_string(), severity, message, path, node_id: Some(node_id.to_string()), field: None }
}

/// The builder's diagnostics and the SDK-style verdict: the code of the first error found.
struct Checked {
    found: Found,
    verdict: Option<String>,
}

impl Checked {
    fn push(&mut self, d: Diagnostic) {
        if d.severity == Severity::Error {
            self.verdict.get_or_insert_with(|| d.code.clone());
        }
        self.found.push(d);
    }
}

/// Validates a graph binding (#273, #274): its shape against the vendored PROVISIONAL schema,
/// the numbers canonical JSON refuses and each BOUNDED exposure's stop threshold against its
/// allowance. With `graph`, also the submission checks Praxis makes against the graph alone:
///
/// - each dispatchable node without an entry, and each entry for a node the graph lacks, is a
///   `BINDING_INCOMPLETE` error, an entry on another kind of node `BINDING_NODE_KIND`, and a TASK
///   entry whose `executionKind` isn't its node's `BINDING_KIND_MISMATCH`;
/// - a TOOL entry's `payload` must match its node's `inputSchema` (`DATA_SCHEMA`);
/// - a FUNCTION or HUMAN entry is an `EXECUTION_KIND_UNSUPPORTED` warning, since Praxis doesn't
///   run them yet, and a pinned `graphDigest` that isn't `graph`'s digest a `BINDING_STALE` one.
///
/// Warnings leave the verdict alone, so a binding with only warnings still saves. The attach
/// checks against the graph's contracts are `binding_attach::check_attach`'s.
pub fn validate_graph_binding(binding: &Value, graph: Option<&Value>) -> Validation {
    let mut checked = Checked { found: Found::default(), verdict: None };
    // A field can break more than one schema rule; one message per path and message is enough.
    let mut seen = std::collections::HashSet::new();
    for error in schema().iter_errors(binding) {
        let mut located = Vec::new();
        located_schema_issues(&error, &mut located);
        for (path, message) in located {
            if seen.insert((path.clone(), message.clone())) {
                checked.push(field_issue(&path, "INVALID_RECORD", message));
            }
        }
    }
    check_canonical(binding, "", 0, &mut |code, path, message| checked.push(field_issue(path, code, message)));
    let entries = binding.get("nodes").and_then(Value::as_object);
    for (id, entry) in entries.into_iter().flatten() {
        let threshold = entry.pointer("/exposure/stopThreshold");
        if let (Some(allowance), Some(stop)) = (amount(entry.pointer("/exposure/allowance")), amount(threshold))
            && stop > allowance
        {
            let path = format!("/nodes/{}/exposure/stopThreshold", escape(id));
            let message = format!("The stop threshold, {}, is above the allowance, {}.", stop.1, allowance.1);
            checked.push(entry_issue("INVALID_EXPOSURE", Severity::Error, path, id, message));
        }
    }
    if let (Some(graph), Some(entries)) = (graph, entries) {
        check_against_graph(binding, entries, graph, &mut checked);
    }
    with_verdict(checked.verdict, checked.found, describe)
}

/// The submission checks of `validate_graph_binding` that need the graph.
fn check_against_graph(binding: &Value, entries: &Map<String, Value>, graph: &Value, checked: &mut Checked) {
    let pinned = binding.get("graphDigest").and_then(Value::as_str).filter(|d| !d.is_empty());
    if let (Some(pinned), Ok(digest)) = (pinned, aiws_sdk::digest(graph))
        && pinned != digest
    {
        let revision = binding.get("graphRevision").and_then(Value::as_str).unwrap_or("");
        let message = format!(
            "The binding is pinned to graph revision {}, not to the graph as it is now. Save the graph, then Retarget to current graph.",
            revision
        );
        checked.push(Diagnostic { severity: Severity::Warning, ..field_issue("/graphDigest", "BINDING_STALE", message) });
    }
    for id in dispatchable_ids(graph) {
        if !entries.contains_key(id) {
            let message = format!("Node {} has no entry, so Praxis can't tell what it runs.", id);
            checked.push(entry_issue("BINDING_INCOMPLETE", Severity::Error, "/nodes".to_string(), id, message));
        }
    }
    for (id, entry) in entries {
        let at = |key: &str| format!("/nodes/{}{}", escape(id), key);
        let Some(node) = graph_node(graph, id) else {
            let message = format!("The graph has no node {}. Retarget to current graph drops this entry.", id);
            checked.push(entry_issue("BINDING_INCOMPLETE", Severity::Error, at(""), id, message));
            continue;
        };
        let kind = node.get("kind").and_then(Value::as_str).unwrap_or("");
        if !DISPATCHABLE_KINDS.contains(&kind) {
            let message = format!("{} is a {} node, which Praxis doesn't dispatch, so it has no entry. Retarget to current graph drops it.", id, kind);
            checked.push(entry_issue("BINDING_NODE_KIND", Severity::Error, at(""), id, message));
            continue;
        }
        let execution = entry.get("executionKind").and_then(Value::as_str);
        let wanted = node.pointer("/config/executionKind").and_then(Value::as_str);
        if kind == "TASK"
            && let (Some(execution), Some(wanted)) = (execution, wanted)
            && execution != wanted
        {
            let message = format!("Node {} runs as {} in the graph, so its entry must be a {} entry too.", id, wanted, wanted);
            checked.push(entry_issue("BINDING_KIND_MISMATCH", Severity::Error, at("/executionKind"), id, message));
        }
        if let Some(unsupported @ ("FUNCTION" | "HUMAN")) = execution {
            let message = format!("Praxis doesn't run {} entries yet, so it refuses a run with this binding.", unsupported);
            checked.push(entry_issue("EXECUTION_KIND_UNSUPPORTED", Severity::Warning, at("/executionKind"), id, message));
        }
        if let (Some("TOOL"), Some(payload), Some(input)) = (execution, entry.get("payload"), node.get("inputSchema").filter(|s| s.is_object())) {
            // The graph's own validation reports an inputSchema the SDK can't compile.
            let Ok(validator) = aiws_sdk::data_validator(input) else { continue };
            let reasons: Vec<String> = validator.iter_errors(payload).map(|e| clipped(&e.to_string())).take(3).collect();
            if !reasons.is_empty() {
                let message = format!("The payload doesn't match node {}'s inputSchema: {}.", id, reasons.join("; "));
                checked.push(entry_issue("DATA_SCHEMA", Severity::Error, at("/payload"), id, message));
            }
        }
    }
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
        assert_eq!(list.entries[0].cost_unit.as_deref(), Some("micro-USD"));
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

    // --- submission checks against the graph (#274) ----------------------------------

    /// Each issue as (code, severity, path, node).
    fn issues(v: &Validation) -> Vec<(String, Severity, String, Option<String>)> {
        v.diagnostics.iter().map(|d| (d.code.clone(), d.severity, d.path.clone(), d.node_id.clone())).collect()
    }

    fn issue(code: &str, severity: Severity, path: &str, node: &str) -> (String, Severity, String, Option<String>) {
        (code.to_string(), severity, path.to_string(), Some(node.to_string()))
    }

    fn graph_of(nodes: Value) -> Value {
        json!({"id": "g", "revision": "1", "nodes": nodes})
    }

    /// A binding pinned to `graph` as it is, so it isn't stale.
    fn pinned_to(id: &str, graph: &Value) -> Value {
        let mut record = pinned(id, graph["id"].as_str().unwrap());
        record["graphDigest"] = json!(aiws_sdk::digest(graph).unwrap());
        record
    }

    fn tool_entry(payload: Value) -> Value {
        json!({
            "executionKind": "TOOL", "role": "WORK", "protocolBindingId": "gh", "action": "merge", "resource": "repo",
            "payload": payload, "exposure": {"kind": "NOT_APPLICABLE", "justification": "no model"}, "maxTaskMs": 60000
        })
    }

    #[test]
    fn an_entry_on_a_node_praxis_doesn_t_dispatch_is_binding_node_kind() {
        let graph = graph_of(json!([
            {"id": "t", "kind": "TASK", "dependsOn": [], "config": {"executionKind": "AGENT"}},
            {"id": "v", "kind": "VERIFICATION", "dependsOn": ["t"], "config": {}},
            {"id": "end", "kind": "END", "dependsOn": ["v"], "config": {}}
        ]));
        let mut record = pinned_to("b", &graph);
        record["nodes"] = json!({"t": agent_entry(), "v": agent_entry()});
        let v = validate_graph_binding(&record, Some(&graph));
        assert_eq!(v.verdict.as_deref(), Some("BINDING_NODE_KIND"));
        assert_eq!(issues(&v), [issue("BINDING_NODE_KIND", Severity::Error, "/nodes/v", "v")]);
    }

    #[test]
    fn a_task_entry_of_another_kind_than_its_node_is_binding_kind_mismatch() {
        let graph = graph_of(json!([
            {"id": "t", "kind": "TASK", "dependsOn": [], "config": {"executionKind": "TOOL"}},
            {"id": "end", "kind": "END", "dependsOn": ["t"], "config": {}}
        ]));
        let mut record = pinned_to("b", &graph);
        record["nodes"] = json!({"t": agent_entry()});
        let v = validate_graph_binding(&record, Some(&graph));
        assert_eq!(v.verdict.as_deref(), Some("BINDING_KIND_MISMATCH"));
        assert_eq!(issues(&v), [issue("BINDING_KIND_MISMATCH", Severity::Error, "/nodes/t/executionKind", "t")]);
        assert!(v.diagnostics[0].message.contains("TOOL"), "{:?}", v.diagnostics[0]);
    }

    #[test]
    fn function_and_human_entries_are_warned_unsupported_but_the_binding_still_saves() {
        let graph = graph_of(json!([
            {"id": "l", "kind": "LOOP", "dependsOn": [], "config": {"maxIterations": "2"}},
            {"id": "c", "kind": "COMPENSATION", "dependsOn": ["l"], "config": {}},
            {"id": "end", "kind": "END", "dependsOn": ["c"], "config": {}}
        ]));
        let mut record = pinned_to("b", &graph);
        record["nodes"] = json!({"l": {"executionKind": "FUNCTION"}, "c": {"executionKind": "HUMAN"}});
        let v = validate_graph_binding(&record, Some(&graph));
        assert_eq!(v.verdict, None);
        assert_eq!(
            issues(&v),
            [
                issue("EXECUTION_KIND_UNSUPPORTED", Severity::Warning, "/nodes/l/executionKind", "l"),
                issue("EXECUTION_KIND_UNSUPPORTED", Severity::Warning, "/nodes/c/executionKind", "c"),
            ]
        );
    }

    #[test]
    fn a_pin_that_isn_t_this_graph_s_digest_is_a_stale_warning() {
        let graph = graph_of(json!([
            {"id": "t", "kind": "TASK", "dependsOn": [], "config": {"executionKind": "AGENT"}},
            {"id": "end", "kind": "END", "dependsOn": ["t"], "config": {}}
        ]));
        let mut record = pinned("b", "g");
        record["nodes"] = json!({"t": agent_entry()});
        let v = validate_graph_binding(&record, Some(&graph));
        assert_eq!(v.verdict, None);
        assert_eq!(issues(&v), [("BINDING_STALE".to_string(), Severity::Warning, "/graphDigest".to_string(), None)]);

        record["graphDigest"] = json!(aiws_sdk::digest(&graph).unwrap());
        assert_eq!(issues(&validate_graph_binding(&record, Some(&graph))), []);
        // A binding not pinned yet is pinned on its first save, so it isn't stale.
        record["graphRevision"] = json!("");
        record["graphDigest"] = json!("");
        let v = validate_graph_binding(&record, Some(&graph));
        assert!(!v.diagnostics.iter().any(|d| d.code == "BINDING_STALE"), "{:?}", v.diagnostics);
    }

    #[test]
    fn a_tool_payload_is_checked_against_its_node_s_input_schema() {
        let (graph, digest) = fixture_graph();
        let mut record = pinned("b", "release-review");
        record["graphDigest"] = json!(digest);
        record["nodes"] = json!({
            "build": agent_entry(), "test": agent_entry(), "fix": agent_entry(), "rollback": agent_entry(),
            "publish": tool_entry(json!({"Zone": "eu"}))
        });
        let v = validate_graph_binding(&record, Some(&graph));
        assert_eq!(v.verdict.as_deref(), Some("DATA_SCHEMA"));
        assert_eq!(issues(&v), [issue("DATA_SCHEMA", Severity::Error, "/nodes/publish/payload", "publish")]);
        assert!(v.diagnostics[0].message.contains("area"), "{:?}", v.diagnostics[0]);

        record["nodes"]["publish"] = tool_entry(json!({"Zone": "eu", "area": "web"}));
        assert_eq!(issues(&validate_graph_binding(&record, Some(&graph))), []);

        // The schema error quotes the failing value, so a long one is cut short.
        record["nodes"]["publish"] = tool_entry(json!({"Zone": ["x".repeat(5000)], "area": "web"}));
        let v = validate_graph_binding(&record, Some(&graph));
        assert_eq!(v.diagnostics[0].code, "DATA_SCHEMA");
        assert!(v.diagnostics[0].message.len() < 400, "{}", v.diagnostics[0].message.len());
        assert!(v.diagnostics[0].message.contains('…'));
    }

    #[test]
    fn a_stop_threshold_above_the_allowance_is_invalid_exposure() {
        let graph = graph_of(json!([
            {"id": "t", "kind": "TASK", "dependsOn": [], "config": {"executionKind": "AGENT"}},
            {"id": "end", "kind": "END", "dependsOn": ["t"], "config": {}}
        ]));
        let mut record = pinned("b", "g");
        record["graphDigest"] = json!(aiws_sdk::digest(&graph).unwrap());
        let mut entry = agent_entry();
        entry["exposure"] = json!({"kind": "BOUNDED", "allowance": "10", "stopThreshold": "11"});
        record["nodes"] = json!({"t": entry});
        let v = validate_graph_binding(&record, Some(&graph));
        assert_eq!(v.verdict.as_deref(), Some("INVALID_EXPOSURE"));
        assert_eq!(issues(&v), [issue("INVALID_EXPOSURE", Severity::Error, "/nodes/t/exposure/stopThreshold", "t")]);

        // Compared as numbers, not as text.
        record["nodes"]["t"]["exposure"] = json!({"kind": "BOUNDED", "allowance": "10", "stopThreshold": "9"});
        assert_eq!(issues(&validate_graph_binding(&record, Some(&graph))), []);
        record["nodes"]["t"]["exposure"] = json!({"kind": "BOUNDED", "allowance": "10", "stopThreshold": "10"});
        assert_eq!(issues(&validate_graph_binding(&record, Some(&graph))), []);
    }

    #[test]
    fn max_attempts_must_be_a_whole_number_of_at_least_one() {
        let mut record = pinned("b", "g");
        let mut entry = agent_entry();
        entry["maxAttempts"] = json!(0);
        record["nodes"] = json!({"t": entry});
        let v = validate_graph_binding(&record, None);
        assert_eq!(v.verdict.as_deref(), Some("INVALID_RECORD"));
        assert!(v.diagnostics.iter().any(|d| d.path == "/nodes/t/maxAttempts"), "{:?}", v.diagnostics);
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

    #[test]
    fn agent_suggestions_add_the_agent_of_every_saved_template() {
        let repo = temp_repo();
        write(
            &repo,
            ".praxis/graph-bindings/b.json",
            r#"{"graphBindingId": "b", "nodes": {"x": {"agentId": "codex", "protocolBindingId": "gh", "action": "merge", "resource": "repo"}}}"#,
        );
        write(
            &repo,
            ".praxis/templates/review.json",
            r#"{"agent": "claude-code", "protocolBindingId": "jira", "action": "close", "resource": "ticket"}"#,
        );
        write(&repo, ".praxis/templates/no-agent.json", r#"{"title": "no agent", "agent": " "}"#);
        write(&repo, ".praxis/templates/broken.json", "{");
        let found = binding_suggestions(&repo).unwrap();
        assert_eq!(found.agent_id, vec!["claude-code", "codex"]);
        assert_eq!(found.protocol_binding_id, vec!["gh"]);
        assert_eq!(found.action, vec!["merge"]);
        assert_eq!(found.resource, vec!["repo"]);
        // Templates alone, without a bindings folder.
        let repo = temp_repo();
        write(&repo, ".praxis/templates/review.json", r#"{"agent": "claude-code"}"#);
        assert_eq!(binding_suggestions(&repo).unwrap().agent_id, vec!["claude-code"]);
    }
}
