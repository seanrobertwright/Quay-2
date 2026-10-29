//! The canonical on-disk form of a Praxis definition (#222): UTF-8, LF, 2-space indent,
//! keys in the SDK schema's property order, array order kept, and a trailing newline. The
//! same content always gives the same bytes, so a save that changes nothing makes no diff.
//!
//! Keys the schema doesn't name (a hand-edited file may hold them) follow the known keys
//! in the order the file had them. Objects whose keys the schema leaves open, such as a
//! node's `config` or its JSON schemas, keep the file's order throughout.

use serde_json::{Map, Value};

use super::graph_bindings::binding_revision;
use super::models::PraxisKind;
use super::revision::content_revision;
use super::template;
use crate::slices::machina::vault::sha256_hex;

// Property orders from the SDK's `spec/schema.json` `$defs`. A template's comes from the
// coding-plan schema, in `template.rs`.
const GRAPH_KEYS: &[&str] = &["id", "revision", "nodes"];
const NODE_KEYS: &[&str] = &["id", "kind", "dependsOn", "config", "inputSchema", "outputSchema"];
const TRIGGER_KEYS: &[&str] = &[
    "id",
    "revision",
    "kind",
    "source",
    "eventType",
    "contractId",
    "action",
    "waitId",
    "enabled",
    "notBefore",
    "expiresAt",
    "maxAgeMs",
    "maxConcurrent",
    "rateLimit",
    "rateWindowMs",
    "maxDepth",
    "conditionMode",
    "schedule",
    "filter",
];
const TRIGGER_SCHEDULE_KEYS: &[&str] = &["startMs", "intervalMs", "catchUp", "maxCatchUp"];
const TRIGGER_FILTER_KEYS: &[&str] = &["field", "equals"];
const CONTRACT_KEYS: &[&str] = &[
    "id",
    "missionId",
    "aiwsEdition",
    "profile",
    "budget",
    "deadline",
    "criteria",
    "actions",
    "resources",
    "requiresApproval",
    "maxAttempts",
    "maxAuthorizationAgeMs",
    "features",
];
const GRANT_KEYS: &[&str] = &[
    "id",
    "parentId",
    "subject",
    "profile",
    "actions",
    "resources",
    "notBefore",
    "expiresAt",
    "limit",
    "canDelegate",
    "depth",
];

// Property orders from the vendored `spec/engine-v1/graph-binding.schema.json` (#273).
const GRAPH_BINDING_KEYS: &[&str] = &[
    "format",
    "graphBindingId",
    "graphBindingRevision",
    "graphId",
    "graphRevision",
    "graphDigest",
    "costUnit",
    "maxTotalCost",
    "maxTotalActiveMs",
    "contextPolicy",
    "nodes",
];
const BINDING_ENTRY_KEYS: &[&str] = &[
    "executionKind",
    "role",
    "criteria",
    "agentId",
    "protocolBindingId",
    "action",
    "resource",
    "payload",
    "commands",
    "outputPaths",
    "exposure",
    "maxAttempts",
    "maxTaskMs",
    "requirements",
];
const EXPOSURE_KEYS: &[&str] = &["kind", "allowance", "stopThreshold", "justification"];
const CONTEXT_POLICY_KEYS: &[&str] = &["format", "instructions", "retainedEvidence", "summary", "maxBytes"];

/// `map` with the keys in `order` first, in that order, and every other key after them
/// in its existing order.
fn ordered(mut map: Map<String, Value>, order: &[&str]) -> Map<String, Value> {
    let mut out = Map::new();
    for key in order {
        if let Some(value) = map.shift_remove(*key) {
            out.insert((*key).to_string(), value);
        }
    }
    out.extend(map);
    out
}

/// Orders the keys of `value` as the schema does at `order`, when `value` is an object.
fn ordered_value(value: Value, order: &[&str]) -> Value {
    match value {
        Value::Object(map) => Value::Object(ordered(map, order)),
        other => other,
    }
}

/// `record` with its keys, and those of the nested objects the schema describes, in
/// schema property order.
fn order_record(kind: PraxisKind, record: Map<String, Value>) -> Map<String, Value> {
    match kind {
        PraxisKind::Graphs => {
            let mut map = ordered(record, GRAPH_KEYS);
            if let Some(Value::Array(nodes)) = map.get_mut("nodes") {
                for node in nodes.iter_mut() {
                    *node = ordered_value(node.take(), NODE_KEYS);
                }
            }
            map
        }
        PraxisKind::Triggers => {
            let mut map = ordered(record, TRIGGER_KEYS);
            for (key, order) in [("schedule", TRIGGER_SCHEDULE_KEYS), ("filter", TRIGGER_FILTER_KEYS)] {
                if let Some(value) = map.get_mut(key) {
                    *value = ordered_value(value.take(), order);
                }
            }
            map
        }
        PraxisKind::Contracts => ordered(record, CONTRACT_KEYS),
        PraxisKind::Grants => ordered(record, GRANT_KEYS),
        PraxisKind::GraphBindings => {
            let mut map = ordered(record, GRAPH_BINDING_KEYS);
            if let Some(policy) = map.get_mut("contextPolicy") {
                *policy = ordered_value(policy.take(), CONTEXT_POLICY_KEYS);
            }
            // Entries stay in the file's node order; only the keys inside each are ordered.
            if let Some(Value::Object(nodes)) = map.get_mut("nodes") {
                for entry in nodes.values_mut() {
                    *entry = ordered_value(entry.take(), BINDING_ENTRY_KEYS);
                    if let Some(exposure) = entry.get_mut("exposure") {
                        *exposure = ordered_value(exposure.take(), EXPOSURE_KEYS);
                    }
                }
            }
            map
        }
        PraxisKind::Templates => ordered(record, template::template_keys()),
    }
}

/// Pretty JSON with 2-space indent, LF line ends and a trailing newline.
pub fn to_canonical_text(value: &Value) -> String {
    // serde_json's pretty printer indents by two spaces and writes `\n`, never `\r\n`.
    let mut text = serde_json::to_string_pretty(value).expect("a JSON value always serializes");
    text.push('\n');
    text
}

/// Whether records of this kind carry a content-digest `revision`.
fn has_revision(kind: PraxisKind) -> bool {
    matches!(kind, PraxisKind::Graphs | PraxisKind::Triggers)
}

/// The record as it is written: keys in schema order and, for graphs and triggers,
/// `revision` set from the content by `content_revision`, the same digest the validator
/// checks it against. A graph binding's `graphBindingRevision` is set the same way, by
/// `binding_revision`. Content the SDK can't digest (an unsafe number, say) keeps the
/// revision it has, and the validator then has nothing to compare it with either.
pub fn canonical_record(kind: PraxisKind, record: Map<String, Value>) -> Map<String, Value> {
    let mut map = order_record(kind, record);
    if has_revision(kind) {
        if let Some(revision) = content_revision(&Value::Object(map.clone())) {
            map.insert("revision".to_string(), Value::String(revision));
            map = order_record(kind, map);
        }
    }
    if kind == PraxisKind::GraphBindings
        && let Some(revision) = binding_revision(&Value::Object(map.clone()))
    {
        map.insert("graphBindingRevision".to_string(), Value::from(revision));
        map = order_record(kind, map);
    }
    map
}

/// The hash a draft records for the file it loaded, and that a save checks before it
/// overwrites the file: the SHA-256 of the file's bytes, in hex.
pub fn content_hash(bytes: &[u8]) -> String {
    sha256_hex(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn object(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => panic!("not an object"),
        }
    }

    fn canonical_text(kind: PraxisKind, value: Value) -> String {
        to_canonical_text(&Value::Object(canonical_record(kind, object(value))))
    }

    fn parse(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn writes_two_space_indent_lf_and_a_trailing_newline() {
        let text = to_canonical_text(&json!({"a": [1, {"b": "é"}], "c": {}}));
        assert_eq!(text, "{\n  \"a\": [\n    1,\n    {\n      \"b\": \"é\"\n    }\n  ],\n  \"c\": {}\n}\n");
    }

    #[test]
    fn orders_graph_and_node_keys_by_the_schema_and_keeps_node_order() {
        let graph = parse(
            r#"{"nodes":[
                {"config":{"z":1,"a":2},"dependsOn":[],"kind":"END","id":"end-1"},
                {"outputSchema":{},"id":"a","inputSchema":{},"kind":"TASK","config":{},"dependsOn":["end-1"]}
            ],"revision":"x","id":"g"}"#,
        );
        let text = canonical_text(PraxisKind::Graphs, graph);
        let value = parse(&text);
        let keys = |v: &Value| v.as_object().unwrap().keys().cloned().collect::<Vec<_>>();
        assert_eq!(keys(&value), ["id", "revision", "nodes"]);
        assert_eq!(keys(&value["nodes"][0]), ["id", "kind", "dependsOn", "config"]);
        assert_eq!(keys(&value["nodes"][1]), ["id", "kind", "dependsOn", "config", "inputSchema", "outputSchema"]);
        // Node order and the order of keys inside config are the file's.
        assert_eq!(value["nodes"][0]["id"], "end-1");
        assert_eq!(keys(&value["nodes"][0]["config"]), ["z", "a"]);
    }

    #[test]
    fn keeps_unknown_keys_after_the_known_ones_in_file_order() {
        let text = canonical_text(PraxisKind::Grants, json!({"zeta": 1, "subject": "s", "alpha": 2, "id": "g"}));
        let keys: Vec<String> = parse(&text).as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["id", "subject", "zeta", "alpha"]);
    }

    #[test]
    fn orders_a_trigger_schedule_and_filter() {
        let text = canonical_text(
            PraxisKind::Triggers,
            json!({"schedule": {"catchUp": "SKIP", "startMs": "0"}, "filter": {"equals": 1, "field": "f"}, "kind": "SCHEDULED", "id": "t"}),
        );
        let value = parse(&text);
        let keys = |v: &Value| v.as_object().unwrap().keys().cloned().collect::<Vec<_>>();
        assert_eq!(keys(&value), ["id", "revision", "kind", "schedule", "filter"]);
        assert_eq!(keys(&value["schedule"]), ["startMs", "catchUp"]);
        assert_eq!(keys(&value["filter"]), ["field", "equals"]);
    }

    #[test]
    fn a_canonical_file_round_trips_to_the_same_bytes() {
        let graph = json!({"id": "g", "nodes": [{"id": "e", "kind": "END", "dependsOn": [], "config": {"b": 1.5, "a": null}}]});
        let first = canonical_text(PraxisKind::Graphs, graph);
        let second = canonical_text(PraxisKind::Graphs, parse(&first));
        assert_eq!(first, second);
    }

    // --- the revision digest ---------------------------------------------------------

    #[test]
    fn a_saved_graph_carries_the_revision_the_validator_expects() {
        let graph = json!({"nodes": [{"id": "end", "kind": "END", "dependsOn": [], "config": {}}], "id": "g", "revision": "1"});
        let saved = Value::Object(canonical_record(PraxisKind::Graphs, object(graph)));
        // The value revision.rs pins for this graph's content.
        assert_eq!(saved["revision"], "sha256:e05c3dd2ee43378d");
        assert_eq!(content_revision(&saved).as_deref(), saved["revision"].as_str());
    }

    #[test]
    fn content_the_sdk_cant_digest_keeps_its_revision() {
        let graph = object(json!({"id": "g", "revision": "hand", "nodes": [], "n": 1.5}));
        assert_eq!(canonical_record(PraxisKind::Graphs, graph)["revision"], "hand");
    }

    #[test]
    fn graphs_and_triggers_get_a_revision_and_contracts_and_grants_do_not() {
        let graph = canonical_record(PraxisKind::Graphs, object(json!({"id": "g", "revision": "1", "nodes": []})));
        assert!(graph["revision"].as_str().unwrap().starts_with("sha256:"));
        let trigger = canonical_record(PraxisKind::Triggers, object(json!({"id": "t"})));
        assert!(trigger["revision"].as_str().unwrap().starts_with("sha256:"));
        let contract = canonical_record(PraxisKind::Contracts, object(json!({"id": "c"})));
        assert!(!contract.contains_key("revision"));
        let grant = canonical_record(PraxisKind::Grants, object(json!({"id": "g", "revision": "kept"})));
        assert_eq!(grant["revision"], "kept");
    }

    #[test]
    fn a_template_follows_the_coding_plan_schema_order_and_gets_no_id_or_revision() {
        let template = canonical_record(
            PraxisKind::Templates,
            object(json!({"agent": "a", "extra": 1, "maxAttempts": 2, "description": "d"})),
        );
        assert_eq!(template.keys().collect::<Vec<_>>(), ["description", "maxAttempts", "agent", "extra"]);
    }

    #[test]
    fn saving_a_saved_record_again_changes_nothing() {
        let once = canonical_record(PraxisKind::Graphs, object(json!({"nodes": [], "id": "g"})));
        let twice = canonical_record(PraxisKind::Graphs, once.clone());
        assert_eq!(to_canonical_text(&Value::Object(once)), to_canonical_text(&Value::Object(twice)));
    }
}
