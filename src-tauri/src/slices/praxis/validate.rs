//! Validates Praxis definitions offline with the vendored AI-WS-SDK crate (#220).
//!
//! The SDK's `validate_graph` decides validity and stops at the first rule a graph breaks,
//! naming it with a bare code. The builder needs every issue and where it is, so a locator
//! here repeats each SDK rule over the whole graph and attaches a JSON Pointer, the node and
//! the field. The SDK's code stays the verdict: it always leads the list, and when the SDK
//! accepts a graph no error is reported. The tests hold the locator to the SDK's vectors.
//!
//! Contracts are checked the same way (#223): the verdict is what `Contract::from_value`
//! and then `create_mission` say, and the locator repeats the schema and both of
//! `create_mission`'s rules with a path to each field.
//!
//! A grant is checked twice. As a record, the verdict is `Grant::from_value`'s. On a scratch
//! mission under each contract that binds it (#220, #223), the verdict is what `reduce` says
//! of the `grant` command, and the locator repeats that command's rules against the contract
//! and the parent grant.
//!
//! A trigger is checked by `registerTrigger` on a scratch mission (#220): `create_mission`
//! under a stand-in contract that names the trigger's contract, allows triggers and has the
//! latest deadline the SDK can store, so only the trigger's own rules can refuse it. Whether
//! the real contract allows the trigger is a cross-record check.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::{json, Value};

use super::models::PraxisKind;
use super::revision::content_revision;
use super::store::MAX_FILE_BYTES;

/// The most nodes the SDK's schema allows in a graph. Past it the per-node rules are
/// skipped: the schema already refuses the graph, and they would only cost time.
const MAX_NODES: usize = 1000;

/// The most diagnostics a validation returns. The rest are counted in `omitted`, so a
/// broken file of thousands of nodes can't flood the webview.
pub const MAX_DIAGNOSTICS: usize = 500;

/// Validates a definition's content: a graph, contract, grant, trigger, graph binding (a binding without its
/// graph, so only its shape) or workflow template. Content over the size limit is refused.
pub fn validate_definition(kind: PraxisKind, content: &Value) -> Result<Validation, String> {
    check_size(content)?;
    match kind {
        PraxisKind::Graphs => Ok(validate_graph(content)),
        PraxisKind::Contracts => Ok(validate_contract(content)),
        PraxisKind::Grants => Ok(validate_grant(content)),
        PraxisKind::Triggers => Ok(validate_trigger(content)),
        PraxisKind::GraphBindings => Ok(super::graph_bindings::validate_graph_binding(content, None)),
        PraxisKind::Templates => Ok(super::template::validate_template(content)),
    }
}

/// Refuses content that serializes to more than a definition file may hold, so a check
/// never works through a payload larger than any file it could read.
pub fn check_size(content: &Value) -> Result<(), String> {
    if fits_in(content, MAX_FILE_BYTES) {
        Ok(())
    } else {
        Err(format!("The definition is larger than the {} bytes Quay validates.", MAX_FILE_BYTES))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// The SDK refuses the record.
    Error,
    /// The record saves, but Praxis would refuse a run with it as it stands (#274).
    Warning,
    /// Worth knowing, but the SDK accepts the record.
    Info,
}

/// One issue in a record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    /// The SDK's error code, or a Quay code such as `REVISION_MISMATCH` for an info issue.
    pub code: String,
    pub severity: Severity,
    pub message: String,
    /// A JSON Pointer to the value at fault, `""` for the record as a whole.
    pub path: String,
    /// The id of the graph node the issue is on, when it is on one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    /// The place inside that node, dotted (`config.then`, `dependsOn.1`), when the issue
    /// is on part of the node rather than the whole of it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

/// A record's validation result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Validation {
    /// The SDK's verdict: the code of the first rule the record breaks, or `None` when the
    /// SDK accepts it.
    pub verdict: Option<String>,
    /// The issues found, at most `MAX_DIAGNOSTICS`. When there is a verdict, the first
    /// diagnostic carries its code.
    pub diagnostics: Vec<Diagnostic>,
    /// How many more issues were found than `diagnostics` holds.
    pub omitted: Omitted,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Omitted {
    pub errors: usize,
    pub warnings: usize,
    pub info: usize,
}

impl Omitted {
    fn count(&mut self, severity: Severity) {
        match severity {
            Severity::Error => self.errors += 1,
            Severity::Warning => self.warnings += 1,
            Severity::Info => self.info += 1,
        }
    }
}

/// Diagnostics as the locator finds them: the first `MAX_DIAGNOSTICS` kept, the rest counted.
#[derive(Default)]
pub(super) struct Found {
    kept: Vec<Diagnostic>,
    omitted: Omitted,
}

impl Found {
    pub(super) fn push(&mut self, d: Diagnostic) {
        if self.kept.len() < MAX_DIAGNOSTICS {
            self.kept.push(d);
        } else {
            self.omitted.count(d.severity);
        }
    }
}

/// Whether `value` serializes to at most `limit` bytes. Serialization stops as soon as it
/// passes the limit, and nothing is kept.
fn fits_in(value: &Value, limit: u64) -> bool {
    struct Counter {
        written: u64,
        limit: u64,
    }
    impl std::io::Write for Counter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.written += buf.len() as u64;
            if self.written > self.limit {
                return Err(std::io::Error::other("over the limit"));
            }
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Counter { written: 0, limit }, value).is_ok()
}

/// Validates a graph. The verdict is `aiws_sdk::workflow::validate_graph`'s.
pub fn validate_graph(graph: &Value) -> Validation {
    let verdict = aiws_sdk::workflow::validate_graph(graph).err().map(|e| e.code);
    with_verdict(verdict, locate_graph(graph), describe)
}

/// Validates a contract. The verdict is the SDK's: the contract must be a valid record
/// that `create_mission` accepts.
pub fn validate_contract(contract: &Value) -> Validation {
    let verdict = aiws_sdk::Contract::from_value(contract.clone())
        .and_then(|c| aiws_sdk::create_mission(&c))
        .err()
        .map(|e| e.code);
    with_verdict(verdict, locate_contract(contract), describe_contract)
}

/// The stand-in contract a trigger is registered under: it names the trigger's contract,
/// allows triggers and has the latest deadline the SDK can store, so it refuses nothing the
/// trigger could fix.
fn scratch_contract(trigger: &Value) -> Value {
    let id = trigger.get("contractId").and_then(Value::as_str).filter(|id| !id.is_empty()).unwrap_or("scratch");
    json!({
        "id": id, "missionId": id, "aiwsEdition": "0.4", "profile": "finite-v1",
        "budget": "0", "deadline": "9".repeat(100), "criteria": ["scratch"],
        "actions": [], "resources": [], "requiresApproval": false,
        "maxAttempts": "1", "maxAuthorizationAgeMs": "0", "features": ["graphs", "triggers"]
    })
}

/// Validates a trigger. The verdict is the SDK's: the trigger must be a valid record that
/// `registerTrigger` accepts on a scratch mission.
pub fn validate_trigger(trigger: &Value) -> Validation {
    let verdict = aiws_sdk::TriggerDefinition::from_value(trigger.clone())
        .and_then(|_| aiws_sdk::Contract::from_value(scratch_contract(trigger)))
        .and_then(|contract| aiws_sdk::create_mission(&contract))
        .and_then(|mission| {
            let command = aiws_sdk::Command::from_value(json!({"type": "registerTrigger", "trigger": trigger}))?;
            aiws_sdk::reduce(&mission, &command, "0")
        })
        .err()
        .map(|e| e.code);
    with_verdict(verdict, locate_trigger(trigger), describe_trigger)
}

/// The validation for the SDK's `verdict` and what the locator `found`: the verdict's
/// issue leads, and when the SDK accepts the record no error is kept.
pub(super) fn with_verdict(verdict: Option<String>, found: Found, describe: fn(&str) -> &'static str) -> Validation {
    let Found { kept: mut diagnostics, mut omitted } = found;
    match &verdict {
        // The SDK accepts the graph, so nothing the locator found can be an error.
        None => {
            diagnostics.retain(|d| d.severity != Severity::Error);
            omitted.errors = 0;
        }
        Some(code) => match diagnostics.iter().position(|d| d.severity == Severity::Error && &d.code == code) {
            Some(0) => {}
            Some(i) => {
                let first = diagnostics.remove(i);
                diagnostics.insert(0, first);
            }
            None => {
                diagnostics.insert(0, record_issue(code, describe(code)));
                if diagnostics.len() > MAX_DIAGNOSTICS
                    && let Some(dropped) = diagnostics.pop()
                {
                    omitted.count(dropped.severity);
                }
            }
        },
    }
    Validation { verdict, diagnostics, omitted }
}

pub(super) fn describe(code: &str) -> &'static str {
    match code {
        "INVALID_RECORD" => "The graph doesn't match the Praxis graph schema.",
        "UNSAFE_NUMBER" => "A number isn't a whole number between -(2^53 - 1) and 2^53 - 1.",
        "INPUT_LIMIT" => "The graph is nested more deeply than Praxis allows.",
        "DUPLICATE_NODE" => "More than one node has the same id.",
        "MISSING_END" => "The graph has no END node.",
        "INVALID_DEPENDENCY" => "A dependency names no node in this graph, or the node itself.",
        "SCHEMA_UNSUPPORTED" => "A node schema uses a JSON Schema feature Praxis doesn't support.",
        "SCHEMA_INVALID" => "A node schema isn't a valid JSON Schema.",
        "NODE_CONFIG" => "A node's config doesn't fit its kind.",
        "GRAPH_CYCLE" => "The dependencies form a cycle.",
        "NO_END_PATH" => "A node doesn't lead to an END node.",
        _ => "Praxis refuses this graph.",
    }
}

/// The deepest nesting `aiws_sdk::canonical` accepts.
const MAX_DEPTH: usize = 64;
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// Every issue in a graph, in the order the SDK checks its rules, each with its location.
/// The SDK's rules are repeated here over the whole graph instead of stopping at the first.
fn locate_graph(graph: &Value) -> Found {
    let mut out = Found::default();
    let nodes: &[Value] = graph
        .get("nodes")
        .and_then(Value::as_array)
        .filter(|nodes| nodes.len() <= MAX_NODES)
        .map_or(&[], Vec::as_slice);
    let node_id = |i: usize| nodes.get(i).and_then(|n| n.get("id")).and_then(Value::as_str);

    // Schema rules, with the instance path of each failure.
    for error in record_schema("Graph").iter_errors(graph) {
        let path = error.instance_path.as_str().to_string();
        out.push(at(graph, &path, "INVALID_RECORD", Severity::Error, error.to_string()));
    }
    // Numbers and nesting the SDK's canonical JSON refuses.
    check_canonical(graph, "", 0, &mut |code, path, message| {
        out.push(at(graph, path, code, Severity::Error, message))
    });

    let mut ids: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, node) in nodes.iter().enumerate() {
        if let Some(id) = node.get("id").and_then(Value::as_str) {
            ids.entry(id).or_default().push(i);
        }
    }
    let unique_ids = ids.values().all(|at| at.len() == 1);
    for (i, id) in (0..nodes.len()).filter_map(|i| node_id(i).map(|id| (i, id))) {
        let copies = ids[id].len();
        if copies > 1 {
            out.push(node_issue(graph, i, "/id", "DUPLICATE_NODE", format!("{} nodes have the id \"{}\".", copies, id)));
        }
    }
    let has_end = nodes.iter().any(|n| n.get("kind") == Some(&json!("END")));
    if !has_end && !nodes.is_empty() {
        out.push(Diagnostic {
            path: "/nodes".to_string(),
            ..record_issue("MISSING_END", "The graph has no END node, so no run could finish.")
        });
    }

    for (i, node) in nodes.iter().enumerate() {
        let own_id = node.get("id");
        if let Some(deps) = node.get("dependsOn").and_then(Value::as_array) {
            for (j, dep) in deps.iter().enumerate() {
                let message = match dep.as_str() {
                    _ if Some(dep) == own_id => "A node can't depend on itself.".to_string(),
                    Some(d) if ids.contains_key(d) => continue,
                    Some(d) => format!("\"{}\" isn't a node in this graph.", d),
                    None => "A dependency must be a node id.".to_string(),
                };
                out.push(node_issue(graph, i, &format!("/dependsOn/{}", j), "INVALID_DEPENDENCY", message));
            }
        }
        for key in ["inputSchema", "outputSchema"] {
            if let Some(schema) = node.get(key).filter(|s| s.is_object())
                && let Err(e) = aiws_sdk::data_validator(schema)
            {
                let message = match e.code.as_str() {
                    "SCHEMA_UNSUPPORTED" => {
                        "Praxis doesn't support $async, format, $dynamicRef or a $ref outside this schema.".to_string()
                    }
                    "SCHEMA_INVALID" => "This isn't a valid JSON Schema.".to_string(),
                    other => describe(other).to_string(),
                };
                out.push(node_issue(graph, i, &format!("/{}", key), &e.code, message));
            }
        }
        for (field, message) in config_issues(node, &ids, nodes) {
            out.push(node_issue(graph, i, &field, "NODE_CONFIG", message));
        }
    }

    if unique_ids {
        let index: HashMap<&str, usize> = ids.iter().map(|(id, at)| (*id, at[0])).collect();
        let edges: Vec<Vec<usize>> = nodes
            .iter()
            .enumerate()
            .map(|(i, n)| {
                n.get("dependsOn")
                    .and_then(Value::as_array)
                    .map(|deps| {
                        deps.iter()
                            .filter_map(Value::as_str)
                            .filter_map(|d| index.get(d).copied())
                            .filter(|&j| j != i)
                            .collect()
                    })
                    .unwrap_or_default()
            })
            .collect();
        for cycle in cycles(&edges) {
            let mut names: Vec<&str> = cycle.iter().filter_map(|&i| node_id(i)).collect();
            names.sort_unstable();
            for &i in &cycle {
                out.push(node_issue(
                    graph,
                    i,
                    "/dependsOn",
                    "GRAPH_CYCLE",
                    format!("This node is on a dependency cycle with {}.", others(&names, node_id(i))),
                ));
            }
        }
        if has_end {
            let mut reached = vec![false; nodes.len()];
            let mut queue: Vec<usize> = (0..nodes.len())
                .filter(|&i| nodes[i].get("kind") == Some(&json!("END")))
                .collect();
            while let Some(i) = queue.pop() {
                if std::mem::replace(&mut reached[i], true) {
                    continue;
                }
                queue.extend(edges[i].iter().copied().filter(|&j| !reached[j]));
            }
            for i in (0..nodes.len()).filter(|&i| !reached[i]) {
                out.push(node_issue(
                    graph,
                    i,
                    "",
                    "NO_END_PATH",
                    "No END node depends on this node, directly or through other nodes.".to_string(),
                ));
            }
        }
    }

    if let Some(d) = revision_issue(graph, "graph") {
        out.push(d);
    }
    out
}

/// An info issue when the record's `revision` isn't the digest of its content (#222), which
/// the next save corrects.
fn revision_issue(record: &Value, noun: &str) -> Option<Diagnostic> {
    let revision = record.get("revision").and_then(Value::as_str)?;
    let expected = content_revision(record)?;
    (revision != expected).then(|| Diagnostic {
        code: "REVISION_MISMATCH".to_string(),
        severity: Severity::Info,
        message: format!("The revision doesn't match the {}'s content ({}). Saving sets it again.", noun, expected),
        path: "/revision".to_string(),
        node_id: None,
        field: None,
    })
}

/// The node config rules of `aiws_sdk::workflow::validate_graph`, each broken rule as a
/// path inside the node and a message.
fn config_issues(node: &Value, ids: &HashMap<&str, Vec<usize>>, nodes: &[Value]) -> Vec<(String, String)> {
    let Some(config) = node.get("config").and_then(Value::as_object) else {
        return Vec::new();
    };
    let kind = node.get("kind").and_then(Value::as_str).unwrap_or("");
    let keys: &[&str] = match kind {
        "TASK" => &["executionKind"],
        "DECISION" => &["field", "equals", "then", "else"],
        "JOIN" => &["mode"],
        "LOOP" => &["maxIterations"],
        _ => &[],
    };
    let kind_name = if kind.is_empty() { "this kind" } else { kind };
    let at_key = |key: &str, message: String| (format!("/config/{}", escape(key)), message);
    let mut issues = Vec::new();
    for key in config.keys().filter(|k| !keys.contains(&k.as_str())) {
        let message = if keys.is_empty() {
            format!("A {} node's config must be empty, so \"{}\" isn't allowed.", kind_name, key)
        } else {
            format!("A {} node's config doesn't take \"{}\".", kind_name, key)
        };
        issues.push(at_key(key, message));
    }
    for key in keys.iter().filter(|k| !config.contains_key(**k)) {
        issues.push(at_key(key, format!("A {} node's config needs \"{}\".", kind_name, key)));
    }
    let value = |key: &str| config.get(key);
    match kind {
        "TASK" => {
            if let Some(v) = value("executionKind").filter(|v| !matches!(v.as_str(), Some("AGENT" | "FUNCTION" | "TOOL" | "HUMAN"))) {
                issues.push(at_key("executionKind", format!("{} isn't AGENT, FUNCTION, TOOL or HUMAN.", v)));
            }
        }
        "JOIN" => {
            if let Some(v) = value("mode").filter(|v| !matches!(v.as_str(), Some("ALL" | "ANY"))) {
                issues.push(at_key("mode", format!("{} isn't ALL or ANY.", v)));
            }
            if node.get("dependsOn").and_then(Value::as_array).is_some_and(Vec::is_empty) {
                issues.push(("/dependsOn".to_string(), "A JOIN needs at least one dependency.".to_string()));
            }
        }
        "LOOP" => {
            if let Some(v) = value("maxIterations").filter(|v| !is_positive_decimal(v)) {
                issues.push(at_key(
                    "maxIterations",
                    format!("{} isn't a whole number of 1 or more written as a string, such as \"3\".", v),
                ));
            }
        }
        "DECISION" => {
            if let Some(v) = value("field").filter(|v| !v.is_string()) {
                issues.push(at_key("field", format!("{} isn't a string.", v)));
            }
            let own_id = node.get("id");
            for branch in ["then", "else"] {
                let Some(target) = value(branch) else { continue };
                let Some(target_id) = target.as_str().filter(|t| ids.contains_key(t)) else {
                    issues.push(at_key(branch, format!("{} isn't a node in this graph.", target)));
                    continue;
                };
                if branch == "else" && value("then") == Some(target) {
                    issues.push(at_key(branch, "then and else name the same node.".to_string()));
                    continue;
                }
                let listed = nodes
                    .iter()
                    .filter(|n| n.get("id").and_then(Value::as_str) == Some(target_id))
                    .all(|n| own_id.is_some_and(|me| n.get("dependsOn").and_then(Value::as_array).is_some_and(|d| d.contains(me))));
                if !listed {
                    issues.push(at_key(branch, format!("\"{}\" doesn't list this decision in dependsOn.", target_id)));
                }
            }
        }
        _ => {}
    }
    issues
}

/// The SDK's `positive`: a decimal string of 1 or more with no leading zero.
fn is_positive_decimal(v: &Value) -> bool {
    v.as_str()
        .is_some_and(|s| !s.is_empty() && !s.starts_with('0') && s.bytes().all(|b| b.is_ascii_digit()))
}

/// The numbers `aiws_sdk::canonical` refuses, and nesting deeper than it allows.
pub(super) fn check_canonical(v: &Value, path: &str, depth: usize, out: &mut impl FnMut(&'static str, &str, String)) {
    if depth > MAX_DEPTH {
        out("INPUT_LIMIT", path, format!("Nested more than {} levels deep.", MAX_DEPTH));
        return;
    }
    match v {
        Value::Number(n) => {
            let ok = n.as_f64().is_some_and(|x| x.is_finite() && x.fract() == 0.0 && x.abs() <= MAX_SAFE_INTEGER);
            if !ok {
                out("UNSAFE_NUMBER", path, format!("{} isn't a whole number between -(2^53 - 1) and 2^53 - 1.", n));
            }
        }
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                check_canonical(item, &format!("{}/{}", path, i), depth + 1, out);
            }
        }
        Value::Object(map) => {
            for (k, item) in map {
                check_canonical(item, &format!("{}/{}", path, escape(k)), depth + 1, out);
            }
        }
        _ => {}
    }
}

/// The node indexes on each dependency cycle: every strongly connected component of more
/// than one node (Tarjan's algorithm, iterative so a long chain can't overflow the stack).
/// Self-dependencies are left out of `edges`; the SDK reports them as INVALID_DEPENDENCY.
fn cycles(edges: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let n = edges.len();
    let mut index = vec![usize::MAX; n];
    let mut low = vec![0; n];
    let mut on_stack = vec![false; n];
    let mut stack = Vec::new();
    let mut next = 0;
    let mut found = Vec::new();
    for root in 0..n {
        if index[root] != usize::MAX {
            continue;
        }
        let mut work = vec![(root, 0usize)];
        while let Some(&mut (v, ref mut child)) = work.last_mut() {
            if *child == 0 {
                index[v] = next;
                low[v] = next;
                next += 1;
                stack.push(v);
                on_stack[v] = true;
            }
            if let Some(&w) = edges[v].get(*child) {
                *child += 1;
                if index[w] == usize::MAX {
                    work.push((w, 0));
                } else if on_stack[w] {
                    low[v] = low[v].min(index[w]);
                }
                continue;
            }
            work.pop();
            if let Some(&(parent, _)) = work.last() {
                low[parent] = low[parent].min(low[v]);
            }
            if low[v] == index[v] {
                let mut component = Vec::new();
                while let Some(w) = stack.pop() {
                    on_stack[w] = false;
                    component.push(w);
                    if w == v {
                        break;
                    }
                }
                if component.len() > 1 {
                    component.sort_unstable();
                    found.push(component);
                }
            }
        }
    }
    found
}

/// The names in `names` other than `me`, as "a, b and c".
fn others(names: &[&str], me: Option<&str>) -> String {
    let rest: Vec<String> = names.iter().filter(|n| Some(**n) != me).map(|n| format!("\"{}\"", n)).collect();
    match rest.as_slice() {
        [] => "itself".to_string(),
        [one] => one.clone(),
        [init @ .., last] => format!("{} and {}", init.join(", "), last),
    }
}

/// Escapes a key for a JSON Pointer segment (RFC 6901).
pub(super) fn escape(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

fn unescape(segment: &str) -> String {
    segment.replace("~1", "/").replace("~0", "~")
}

fn record_issue(code: &str, message: &str) -> Diagnostic {
    Diagnostic {
        code: code.to_string(),
        severity: Severity::Error,
        message: message.to_string(),
        path: String::new(),
        node_id: None,
        field: None,
    }
}

fn node_issue(graph: &Value, index: usize, rest: &str, code: &str, message: String) -> Diagnostic {
    at(graph, &format!("/nodes/{}{}", index, rest), code, Severity::Error, message)
}

/// A diagnostic at `path`, with the node and field read from the path when it points into
/// a node, and the node's id read from the graph.
fn at(graph: &Value, path: &str, code: &str, severity: Severity, message: String) -> Diagnostic {
    let mut segments = path.split('/').skip(1);
    let (mut node_id, mut field) = (None, None);
    if segments.next() == Some("nodes")
        && let Some(index) = segments.next().and_then(|s| s.parse::<usize>().ok())
    {
        node_id = graph["nodes"][index]["id"].as_str().map(str::to_string);
        let rest: Vec<String> = segments.map(unescape).collect();
        if node_id.is_some() && !rest.is_empty() {
            field = Some(rest.join("."));
        }
    }
    Diagnostic { code: code.to_string(), severity, message, path: path.to_string(), node_id, field }
}

/// The SDK's bundled schema with its root pointed at the `$defs` record `name`, as the SDK
/// builds it. Only the records the builder validates are built.
fn record_schema(name: &str) -> &'static jsonschema::Validator {
    type Validators = HashMap<&'static str, jsonschema::Validator>;
    static VALIDATORS: std::sync::OnceLock<Validators> = std::sync::OnceLock::new();
    let validators = VALIDATORS.get_or_init(|| {
        let base: Value = serde_json::from_str(include_str!("../../../vendor/aiws/crates/aiws/src/schema.json"))
            .expect("the vendored schema is JSON");
        ["Graph", "Contract", "Grant", "Trigger"]
            .into_iter()
            .map(|n| {
                let mut schema = base.clone();
                schema["$ref"] = json!(format!("#/$defs/{n}"));
                (n, jsonschema::validator_for(&schema).expect("the vendored schema compiles"))
            })
            .collect()
    });
    &validators[name]
}

fn describe_contract(code: &str) -> &'static str {
    match code {
        "INVALID_RECORD" => "The contract doesn't match the Praxis contract schema.",
        "UNSAFE_NUMBER" => "A number isn't a whole number between -(2^53 - 1) and 2^53 - 1.",
        "INPUT_LIMIT" => "The contract is nested more deeply than Praxis allows.",
        "INVALID_CONTRACT" => "Praxis can't open a mission under this contract.",
        _ => "Praxis refuses this contract.",
    }
}

/// The contract fields the SDK stores as decimal integer strings.
const CONTRACT_INTEGERS: &[&str] = &["budget", "deadline", "maxAttempts", "maxAuthorizationAgeMs"];

/// The grant fields the SDK stores as decimal integer strings, and those of them that are times.
const GRANT_INTEGERS: &[&str] = &["notBefore", "expiresAt", "limit", "depth"];
const GRANT_TIMES: &[&str] = &["notBefore", "expiresAt"];

/// A plainer message than the schema's for a field the SDK stores as a decimal integer string.
fn integer_message(field: &str, value: &Value, times: &[&str]) -> String {
    match value.as_str() {
        Some("") if field == "deadline" => "The deadline isn't set.".to_string(),
        Some("") if times.contains(&field) => "This time isn't set.".to_string(),
        Some("") => "This is empty.".to_string(),
        Some(s) if s.len() > 100 => "This is longer than the 100 digits Praxis allows.".to_string(),
        Some(_) => "This isn't a whole number of 0 or more written in digits, with no leading zero.".to_string(),
        None => format!("{} isn't a whole number written as a string, such as \"0\".", value),
    }
}

/// A plainer message than the schema's for a contract field, when there is one.
fn contract_message(contract: &Value, path: &str) -> Option<String> {
    let field = path.strip_prefix('/')?;
    let value = contract.get(field)?;
    if CONTRACT_INTEGERS.contains(&field) {
        return Some(integer_message(field, value, &["deadline"]));
    }
    match field {
        "aiwsEdition" => Some("The edition must be \"0.4\".".to_string()),
        "profile" => Some("The profile must be \"finite-v1\".".to_string()),
        _ => None,
    }
}

/// A plainer message than the schema's for a grant field, when there is one.
fn grant_message(grant: &Value, path: &str) -> Option<String> {
    let field = path.strip_prefix('/')?;
    let value = grant.get(field)?;
    if GRANT_INTEGERS.contains(&field) {
        return Some(integer_message(field, value, GRANT_TIMES));
    }
    match (field, value.as_str()) {
        ("subject", Some("")) => Some("The subject isn't set.".to_string()),
        ("parentId", Some("")) => Some("The parent id is empty. Leave it out for a root grant.".to_string()),
        _ => None,
    }
}

/// An error at `path` of a record that isn't a graph, so is on no node.
pub(super) fn field_issue(path: &str, code: &str, message: String) -> Diagnostic {
    Diagnostic { code: code.to_string(), severity: Severity::Error, message, path: path.to_string(), node_id: None, field: None }
}

/// The schema issues of the `$defs` record `name`, with `message`'s plainer wording where it
/// has one, and the numbers and nesting canonical JSON refuses.
fn locate_record(name: &str, record: &Value, message: fn(&Value, &str) -> Option<String>) -> Found {
    let mut out = Found::default();
    // A field can break more than one schema rule, such as a pattern and a length, which
    // the plainer message covers at once.
    let mut seen = std::collections::HashSet::new();
    for error in record_schema(name).iter_errors(record) {
        let path = error.instance_path.as_str().to_string();
        let message = message(record, &path).unwrap_or_else(|| error.to_string());
        if seen.insert((path.clone(), message.clone())) {
            out.push(field_issue(&path, "INVALID_RECORD", message));
        }
    }
    check_canonical(record, "", 0, &mut |code, path, message| out.push(field_issue(path, code, message)));
    out
}

/// Every issue in a contract, each with its location: the schema's, the numbers and
/// nesting canonical JSON refuses, and the rules of `create_mission`.
fn locate_contract(contract: &Value) -> Found {
    let mut out = locate_record("Contract", contract, contract_message);
    if contract.get("criteria").and_then(Value::as_array).is_some_and(Vec::is_empty) {
        out.push(field_issue("/criteria", "INVALID_CONTRACT", "A contract needs at least one acceptance criterion.".to_string()));
    }
    if contract.get("maxAttempts").and_then(Value::as_str) == Some("0") {
        out.push(field_issue("/maxAttempts", "INVALID_CONTRACT", "A contract must allow at least one attempt.".to_string()));
    }
    out
}

pub(super) fn describe_grant(code: &str) -> &'static str {
    match code {
        "INVALID_RECORD" => "The grant doesn't match the Praxis grant schema.",
        "UNSAFE_NUMBER" => "A number isn't a whole number between -(2^53 - 1) and 2^53 - 1.",
        "INPUT_LIMIT" => "The grant is nested more deeply than Praxis allows.",
        "AUTHORITY_INDETERMINATE" => "Praxis can't tell what this grant allows.",
        "AUTHORITY_DENIED" => "The grant reaches beyond its contract or its parent grant.",
        "NOT_FOUND" => "The parent grant isn't on the mission.",
        "DUPLICATE_ID" => "A grant with this id is already on the mission.",
        _ => "Praxis refuses this grant.",
    }
}

/// Validates a grant as a record. The verdict is `Grant::from_value`'s. The rules that need
/// a contract and the parent grant are `validate_grant_on_mission`'s.
pub fn validate_grant(grant: &Value) -> Validation {
    let verdict = aiws_sdk::Grant::from_value(grant.clone()).err().map(|e| e.code);
    with_verdict(verdict, locate_record("Grant", grant, grant_message), describe_grant)
}

/// How two canonical decimal strings compare by value. The callers pass only values the
/// SDK's schema has accepted, which have no leading zeros.
fn cmp_decimal(a: &Value, b: &Value) -> std::cmp::Ordering {
    let (a, b) = (a.as_str().unwrap_or(""), b.as_str().unwrap_or(""));
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

/// Checks a grant on a scratch mission (#220, #223): the mission is opened under `contract`
/// with `create_mission`, the grant's saved `ancestors` that the contract binds (`bound`) are
/// granted root first, and then the grant itself, at time 0, which the `grant` command doesn't read. The verdict is what
/// `reduce` says of the grant. A contract or an ancestor the SDK refuses is reported as info,
/// since the fault isn't in this grant; an ancestor refused leaves the grants below it off the
/// mission, so the grant's parent is then reported missing. So is an ancestor the contract
/// doesn't bind, which Praxis would never have granted under it.
pub fn validate_grant_on_mission(grant: &Value, contract: &Value, ancestors: &[Value], bound: &[&str]) -> Validation {
    let info = |path: &str, code: &str, message: String| Diagnostic { severity: Severity::Info, ..field_issue(path, code, message) };
    let mut found = Found::default();
    let opened = aiws_sdk::Contract::from_value(contract.clone()).and_then(|c| aiws_sdk::create_mission(&c));
    let mut mission = match opened {
        Ok(mission) => mission,
        Err(e) => {
            let message = format!("Praxis refuses the contract ({}), so the grant can't be checked on its mission.", e.code);
            found.push(info("", &e.code, message));
            return with_verdict(None, found, describe_grant);
        }
    };
    let grant_command = |g: &Value| aiws_sdk::Command::from_value(json!({"type": "grant", "grant": g}));
    for ancestor in ancestors {
        let id = ancestor.get("id").and_then(Value::as_str).unwrap_or("?");
        if !bound.contains(&id) {
            let message = format!("This contract doesn't bind grant {}, so it isn't on the mission.", id);
            found.push(info("/parentId", "NOT_BOUND", message));
            continue;
        }
        match grant_command(ancestor).and_then(|c| aiws_sdk::reduce(&mission, &c, "0")) {
            Ok(next) => mission = next,
            Err(e) => {
                let message =
                    format!("Praxis refuses grant {} on this mission ({}), so the grants below it aren't granted.", id, e.code);
                found.push(info("/parentId", &e.code, message));
                break;
            }
        }
    }
    let verdict = grant_command(grant).and_then(|c| aiws_sdk::reduce(&mission, &c, "0")).err().map(|e| e.code);
    if aiws_sdk::Grant::from_value(grant.clone()).is_ok() {
        locate_grant_on_mission(grant, mission.as_value(), &mut found);
    }
    with_verdict(verdict, found, describe_grant)
}

/// The rules of `reduce`'s `grant` command that `grant` breaks on `mission`, each with a path
/// to the grant's field. The cross-record check (#269) grants a contract's bound grants one
/// after another on one mission, and explains each refusal with these.
pub(super) fn grant_issues_on_mission(grant: &Value, mission: &Value) -> Vec<Diagnostic> {
    let mut found = Found::default();
    if aiws_sdk::Grant::from_value(grant.clone()).is_ok() {
        locate_grant_on_mission(grant, mission, &mut found);
    }
    found.kept
}

/// The rules of `reduce`'s `grant` command, each broken rule with a path to the grant's
/// field: the profile and times, the contract's actions, resources, budget and deadline, and
/// the parent grant's, which must be on the mission and contain this one.
fn locate_grant_on_mission(g: &Value, mission: &Value, out: &mut Found) {
    use std::cmp::Ordering::{Greater, Less};
    let c = &mission["contract"];
    let cid = c["id"].as_str().unwrap_or("?");
    if g["profile"] != "finite-v1" {
        out.push(field_issue("/profile", "AUTHORITY_INDETERMINATE", "Praxis checks only grants of the finite-v1 profile.".to_string()));
    }
    if cmp_decimal(&g["notBefore"], &g["expiresAt"]) != Less {
        out.push(field_issue("/expiresAt", "AUTHORITY_INDETERMINATE", "The grant must expire after it starts.".to_string()));
    }
    let outside = |out: &mut Found, key: &str, within: &Value, owner: &str| {
        let allowed = within.as_array().map(Vec::as_slice).unwrap_or(&[]);
        for (i, item) in g[key].as_array().into_iter().flatten().enumerate() {
            if !allowed.contains(item) {
                let message = format!("{} isn't one of {}'s {}.", item, owner, key);
                out.push(field_issue(&format!("/{}/{}", key, i), "AUTHORITY_DENIED", message));
            }
        }
    };
    let contract_name = format!("contract {}", cid);
    outside(out, "actions", &c["actions"], &contract_name);
    outside(out, "resources", &c["resources"], &contract_name);
    if cmp_decimal(&g["limit"], &c["budget"]) == Greater {
        let message = format!("The limit is more than contract {}'s budget of {}.", cid, c["budget"].as_str().unwrap_or("?"));
        out.push(field_issue("/limit", "AUTHORITY_DENIED", message));
    }
    if cmp_decimal(&g["expiresAt"], &c["deadline"]) == Greater {
        out.push(field_issue("/expiresAt", "AUTHORITY_DENIED", format!("The grant expires after contract {}'s deadline.", cid)));
    }
    let Some(pid) = g["parentId"].as_str() else { return };
    let Some(p) = mission["grants"].get(pid) else {
        out.push(field_issue("/parentId", "NOT_FOUND", format!("Grant {} isn't on this mission.", pid)));
        return;
    };
    let denied = |out: &mut Found, path: &str, message: String| out.push(field_issue(path, "AUTHORITY_DENIED", message));
    if p["profile"] != "finite-v1" {
        denied(out, "/parentId", format!("Grant {} isn't of the finite-v1 profile, so it can't delegate.", pid));
    }
    if p["canDelegate"] != true {
        denied(out, "/parentId", format!("Grant {} doesn't allow delegation.", pid));
    }
    if cmp_decimal(&g["depth"], &p["depth"]) != Less {
        let message = format!("The depth must be less than grant {}'s depth of {}.", pid, p["depth"].as_str().unwrap_or("?"));
        denied(out, "/depth", message);
    }
    let parent_name = format!("grant {}", pid);
    outside(out, "actions", &p["actions"], &parent_name);
    outside(out, "resources", &p["resources"], &parent_name);
    if cmp_decimal(&g["notBefore"], &p["notBefore"]) == Less {
        denied(out, "/notBefore", format!("The grant starts before grant {} does.", pid));
    }
    if cmp_decimal(&g["expiresAt"], &p["expiresAt"]) == Greater {
        denied(out, "/expiresAt", format!("The grant expires after grant {} does.", pid));
    }
    if cmp_decimal(&g["limit"], &p["limit"]) == Greater {
        let message = format!("The limit is more than grant {}'s limit of {}.", pid, p["limit"].as_str().unwrap_or("?"));
        denied(out, "/limit", message);
    }
}

pub(super) fn describe_trigger(code: &str) -> &'static str {
    match code {
        "INVALID_RECORD" => "The trigger doesn't match the Praxis trigger schema.",
        "UNSAFE_NUMBER" => "A number isn't a whole number between -(2^53 - 1) and 2^53 - 1.",
        "INPUT_LIMIT" => "The trigger is nested more deeply than Praxis allows.",
        "TRIGGER_CONTRACT" => "The trigger must expire after it starts.",
        "TRIGGER_LIMIT" => "The concurrency, rate limit and rate window must each be at least 1.",
        "TRIGGER_TARGET" => "A RESUME_WAIT trigger needs a wait id, and no other action has one.",
        "TRIGGER_CONDITION" => "A CONDITION trigger needs a filter and a condition mode.",
        "SCHEDULE_CONFIG" => "Only a SCHEDULED trigger has a schedule, and its interval and catch-up must be at least 1.",
        _ => "Praxis refuses this trigger.",
    }
}

/// The trigger's times, as JSON Pointers: decimal integer strings that read as "not set" when empty.
const TRIGGER_TIMES: &[&str] = &["/notBefore", "/expiresAt", "/schedule/startMs"];

/// The trigger's other decimal integer strings, as JSON Pointers.
const TRIGGER_COUNTS: &[&str] = &[
    "/maxAgeMs",
    "/maxConcurrent",
    "/rateLimit",
    "/rateWindowMs",
    "/maxDepth",
    "/schedule/intervalMs",
    "/schedule/maxCatchUp",
];

/// The trigger's string fields that must not be empty, with what the message calls each.
const TRIGGER_STRINGS: &[(&str, &str)] = &[
    ("/source", "source"),
    ("/eventType", "event type"),
    ("/contractId", "contract"),
    ("/waitId", "wait id"),
    ("/filter/field", "filter's field"),
];

/// A plainer message than the schema's for a trigger field, when there is one.
fn trigger_message(trigger: &Value, path: &str) -> Option<String> {
    let value = trigger.pointer(path)?;
    if TRIGGER_TIMES.contains(&path) {
        return Some(integer_message(path, value, TRIGGER_TIMES));
    }
    if TRIGGER_COUNTS.contains(&path) {
        return Some(integer_message(path, value, &[]));
    }
    let (_, name) = TRIGGER_STRINGS.iter().find(|(p, _)| *p == path)?;
    (value.as_str() == Some("")).then(|| format!("The {} isn't set.", name))
}

/// Every issue in a trigger, each with its location: the schema's, the numbers and nesting
/// canonical JSON refuses, the rules of `registerTrigger` that the trigger alone decides,
/// and a revision that doesn't match the content.
fn locate_trigger(trigger: &Value) -> Found {
    let mut out = locate_record("Trigger", trigger, trigger_message);
    let issue = |path: &str, code: &str, message: &str| field_issue(path, code, message.to_string());

    // `registerTrigger`'s rules. A comparison is skipped when either side isn't a number the
    // SDK accepts, since the schema has already said so.
    let field = |key: &str| trigger.get(key);
    if let (Some(start), Some(end)) = (canonical_key(field("notBefore")), canonical_key(field("expiresAt")))
        && start >= end
    {
        out.push(issue("/expiresAt", "TRIGGER_CONTRACT", "The trigger must expire after it starts."));
    }
    for key in ["maxConcurrent", "rateLimit", "rateWindowMs"] {
        if field(key).and_then(Value::as_str) == Some("0") {
            out.push(issue(&format!("/{key}"), "TRIGGER_LIMIT", "This must be at least 1."));
        }
    }
    let resumes = field("action").and_then(Value::as_str) == Some("RESUME_WAIT");
    match (resumes, field("waitId").is_some_and(Value::is_string)) {
        (true, false) => out.push(issue("/waitId", "TRIGGER_TARGET", "A RESUME_WAIT trigger needs the wait id it resumes.")),
        (false, true) => out.push(issue("/waitId", "TRIGGER_TARGET", "Only a RESUME_WAIT trigger has a wait id.")),
        _ => {}
    }
    let kind = field("kind").and_then(Value::as_str);
    if kind == Some("CONDITION") {
        if !field("filter").is_some_and(Value::is_object) {
            out.push(issue("/filter", "TRIGGER_CONDITION", "A CONDITION trigger needs a filter."));
        }
        if !field("conditionMode").is_some_and(Value::is_string) {
            out.push(issue("/conditionMode", "TRIGGER_CONDITION", "A CONDITION trigger needs a condition mode."));
        }
    } else if field("conditionMode").is_some() {
        // The SDK accepts it, but only a CONDITION trigger reads it, and the form doesn't show it.
        out.push(Diagnostic {
            severity: Severity::Info,
            ..issue("/conditionMode", "UNUSED_FIELD", "Only a CONDITION trigger uses a condition mode. Changing the kind removes it.")
        });
    }
    match (kind == Some("SCHEDULED"), field("schedule").filter(|s| s.is_object())) {
        (true, Some(schedule)) => {
            if schedule.get("intervalMs").and_then(Value::as_str) == Some("0") {
                out.push(issue("/schedule/intervalMs", "SCHEDULE_CONFIG", "The interval must be at least 1 ms."));
            }
            match canonical_key(schedule.get("maxCatchUp")) {
                Some(n) if n == decimal_key("0") => {
                    out.push(issue("/schedule/maxCatchUp", "SCHEDULE_CONFIG", "This must be at least 1."))
                }
                Some(n) if n > decimal_key("1000") => {
                    out.push(issue("/schedule/maxCatchUp", "SCHEDULE_CONFIG", "This must be at most 1000."))
                }
                _ => {}
            }
        }
        (true, None) => out.push(issue("/schedule", "SCHEDULE_CONFIG", "A SCHEDULED trigger needs a schedule.")),
        (false, Some(_)) => out.push(issue("/schedule", "SCHEDULE_CONFIG", "Only a SCHEDULED trigger has a schedule.")),
        (false, None) => {}
    }
    if let Some(d) = revision_issue(trigger, "trigger") {
        out.push(d);
    }
    out
}

/// The value as a key that orders as its number does, when it is the SDK's canonical decimal:
/// digits with no leading zero, at most 100 of them.
fn canonical_key(v: Option<&Value>) -> Option<(usize, &str)> {
    let s = v?.as_str()?;
    let canonical =
        !s.is_empty() && s.len() <= 100 && s.bytes().all(|b| b.is_ascii_digit()) && (s == "0" || !s.starts_with('0'));
    canonical.then(|| decimal_key(s))
}

/// A canonical decimal as a key that orders as its number does: a shorter one is smaller,
/// and ones of equal length compare digit by digit.
fn decimal_key(s: &str) -> (usize, &str) {
    (s.len(), s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn end(id: &str, deps: &[&str]) -> Value {
        json!({"id": id, "kind": "END", "dependsOn": deps, "config": {}})
    }

    fn task(id: &str, deps: &[&str]) -> Value {
        json!({"id": id, "kind": "TASK", "dependsOn": deps, "config": {"executionKind": "AGENT"}})
    }

    fn graph(nodes: Vec<Value>) -> Value {
        let mut g = json!({"id": "g", "revision": "r", "nodes": nodes});
        g["revision"] = json!(content_revision(&g).unwrap());
        g
    }

    fn codes_at(v: &Validation) -> Vec<(String, String)> {
        v.diagnostics.iter().map(|d| (d.code.clone(), d.path.clone())).collect()
    }

    fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter().map(|(c, p)| (c.to_string(), p.to_string())).collect()
    }

    // --- the SDK's shared vectors --------------------------------------------------

    /// Every `registerGraph` step in the SDK's shared fixtures, with the error it expects.
    fn graph_vectors() -> Vec<(String, Value, Option<String>)> {
        let fixtures: Value =
            serde_json::from_str(include_str!("../../../vendor/aiws/spec/fixtures.json")).unwrap();
        let mut vectors = Vec::new();
        for fixture in fixtures.as_array().unwrap() {
            for step in fixture["steps"].as_array().into_iter().flatten() {
                if step["command"]["type"] == "registerGraph" {
                    vectors.push((
                        fixture["name"].as_str().unwrap().to_string(),
                        step["command"]["graph"].clone(),
                        step["error"].as_str().map(str::to_string),
                    ));
                }
            }
        }
        vectors
    }

    #[test]
    fn the_sdk_vectors_are_all_there() {
        assert_eq!(graph_vectors().len(), 21);
    }

    #[test]
    fn the_verdict_is_the_vector_s_expected_error() {
        for (name, graph, expected) in graph_vectors() {
            let v = validate_graph(&graph);
            assert_eq!(v.verdict, expected, "{name}");
            assert_eq!(v.diagnostics.first().filter(|d| d.severity == Severity::Error).map(|d| d.code.clone()), expected, "{name}");
        }
    }

    #[test]
    fn the_locator_finds_each_vector_s_error_on_its_own_and_nothing_on_a_valid_graph() {
        for (name, graph, expected) in graph_vectors() {
            let errors: Vec<Diagnostic> =
                locate_graph(&graph).kept.into_iter().filter(|d| d.severity == Severity::Error).collect();
            match expected {
                None => assert!(errors.is_empty(), "{name}: {errors:?}"),
                Some(code) => {
                    let found = errors.iter().find(|d| d.code == code);
                    let found = found.unwrap_or_else(|| panic!("{name}: no {code} in {errors:?}"));
                    if code != "MISSING_END" {
                        assert!(found.node_id.is_some(), "{name}: {code} isn't on a node");
                    }
                }
            }
        }
    }

    // --- locations ------------------------------------------------------------------

    #[test]
    fn a_valid_graph_has_no_diagnostics() {
        let g = graph(vec![
            json!({"id": "d", "kind": "DECISION", "dependsOn": [], "config": {"field": "ok", "equals": true, "then": "a", "else": "b"}}),
            task("a", &["d"]),
            task("b", &["d"]),
            json!({"id": "j", "kind": "JOIN", "dependsOn": ["a", "b"], "config": {"mode": "ANY"}}),
            json!({"id": "l", "kind": "LOOP", "dependsOn": ["j"], "config": {"maxIterations": "3"}}),
            end("end", &["l"]),
        ]);
        assert_eq!(validate_graph(&g), Validation { verdict: None, diagnostics: vec![], omitted: Omitted::default() });
    }

    #[test]
    fn schema_errors_point_at_the_field() {
        let g = graph(vec![json!({"id": "a", "kind": "TSAK", "dependsOn": [], "config": {}}), end("end", &["a"])]);
        let v = validate_graph(&g);
        assert_eq!(v.verdict.as_deref(), Some("INVALID_RECORD"));
        let first = &v.diagnostics[0];
        assert_eq!((first.path.as_str(), first.node_id.as_deref(), first.field.as_deref()), ("/nodes/0/kind", Some("a"), Some("kind")));
    }

    #[test]
    fn reports_every_bad_dependency_not_just_the_first() {
        let g = graph(vec![task("a", &["ghost", "a"]), task("b", &["nope"]), end("end", &["a", "b"])]);
        let v = validate_graph(&g);
        assert_eq!(v.verdict.as_deref(), Some("INVALID_DEPENDENCY"));
        assert_eq!(
            codes_at(&v),
            pairs(&[
                ("INVALID_DEPENDENCY", "/nodes/0/dependsOn/0"),
                ("INVALID_DEPENDENCY", "/nodes/0/dependsOn/1"),
                ("INVALID_DEPENDENCY", "/nodes/1/dependsOn/0"),
            ])
        );
        assert_eq!(v.diagnostics[1].field.as_deref(), Some("dependsOn.1"));
        assert_eq!(v.diagnostics[1].message, "A node can't depend on itself.");
    }

    #[test]
    fn config_issues_point_at_the_key() {
        let g = graph(vec![
            json!({"id": "t", "kind": "TASK", "dependsOn": [], "config": {"executionKind": "ROBOT", "extra": 1}}),
            json!({"id": "w", "kind": "WAIT", "dependsOn": ["t"], "config": {"a/b": true}}),
            json!({"id": "l", "kind": "LOOP", "dependsOn": ["w"], "config": {"maxIterations": "03"}}),
            json!({"id": "j", "kind": "JOIN", "dependsOn": [], "config": {}}),
            end("end", &["l", "j"]),
        ]);
        let v = validate_graph(&g);
        assert_eq!(
            codes_at(&v),
            pairs(&[
                ("NODE_CONFIG", "/nodes/0/config/extra"),
                ("NODE_CONFIG", "/nodes/0/config/executionKind"),
                ("NODE_CONFIG", "/nodes/1/config/a~1b"),
                ("NODE_CONFIG", "/nodes/2/config/maxIterations"),
                ("NODE_CONFIG", "/nodes/3/config/mode"),
                ("NODE_CONFIG", "/nodes/3/dependsOn"),
            ])
        );
        assert_eq!(v.diagnostics[2].field.as_deref(), Some("config.a/b"));
    }

    #[test]
    fn decision_branches_are_checked_one_by_one() {
        let g = graph(vec![
            json!({"id": "d", "kind": "DECISION", "dependsOn": [], "config": {"field": 7, "equals": 1, "then": "a", "else": "ghost"}}),
            task("a", &[]),
            json!({"id": "e", "kind": "DECISION", "dependsOn": [], "config": {"field": "f", "equals": 1, "then": "a", "else": "a"}}),
            end("end", &["a", "d", "e"]),
        ]);
        let v = validate_graph(&g);
        assert_eq!(
            codes_at(&v),
            pairs(&[
                ("NODE_CONFIG", "/nodes/0/config/field"),
                ("NODE_CONFIG", "/nodes/0/config/then"),
                ("NODE_CONFIG", "/nodes/0/config/else"),
                ("NODE_CONFIG", "/nodes/2/config/then"),
                ("NODE_CONFIG", "/nodes/2/config/else"),
            ])
        );
        assert_eq!(v.diagnostics[1].message, "\"a\" doesn't list this decision in dependsOn.");
        assert_eq!(v.diagnostics[4].message, "then and else name the same node.");
    }

    #[test]
    fn every_node_on_a_cycle_is_reported() {
        let g = graph(vec![task("a", &["c"]), task("b", &["a"]), task("c", &["b"]), task("x", &[]), end("end", &["c", "x"])]);
        let v = validate_graph(&g);
        assert_eq!(v.verdict.as_deref(), Some("GRAPH_CYCLE"));
        assert_eq!(
            codes_at(&v),
            pairs(&[("GRAPH_CYCLE", "/nodes/0/dependsOn"), ("GRAPH_CYCLE", "/nodes/1/dependsOn"), ("GRAPH_CYCLE", "/nodes/2/dependsOn")])
        );
        assert_eq!(v.diagnostics[0].message, "This node is on a dependency cycle with \"b\" and \"c\".");
    }

    #[test]
    fn every_node_that_reaches_no_end_is_reported() {
        let g = graph(vec![task("a", &[]), task("b", &["a"]), task("c", &[]), end("end", &["c"])]);
        let v = validate_graph(&g);
        assert_eq!(codes_at(&v), pairs(&[("NO_END_PATH", "/nodes/0"), ("NO_END_PATH", "/nodes/1")]));
        assert_eq!((v.diagnostics[0].node_id.as_deref(), v.diagnostics[0].field.as_deref()), (Some("a"), None));
    }

    #[test]
    fn a_long_cycle_does_not_overflow_the_stack() {
        let mut nodes: Vec<Value> = (0..999).map(|i| task(&format!("n{i}"), &[])).collect();
        for (i, node) in nodes.iter_mut().enumerate() {
            node["dependsOn"] = json!([format!("n{}", (i + 998) % 999)]);
        }
        nodes.push(end("end", &["n998"]));
        let v = validate_graph(&graph(nodes));
        assert_eq!(v.verdict.as_deref(), Some("GRAPH_CYCLE"));
        assert_eq!((v.diagnostics.len(), v.omitted.errors), (MAX_DIAGNOSTICS, 999 - MAX_DIAGNOSTICS));
    }

    #[test]
    fn duplicate_ids_are_reported_on_every_copy_and_skip_the_path_checks() {
        let g = graph(vec![task("a", &[]), task("a", &[]), end("end", &["a"])]);
        let v = validate_graph(&g);
        assert_eq!(codes_at(&v), pairs(&[("DUPLICATE_NODE", "/nodes/0/id"), ("DUPLICATE_NODE", "/nodes/1/id")]));
    }

    #[test]
    fn a_graph_without_an_end_reports_it_once_on_the_node_list() {
        let v = validate_graph(&graph(vec![task("a", &[])]));
        assert_eq!(codes_at(&v), pairs(&[("MISSING_END", "/nodes")]));
        assert_eq!(v.diagnostics[0].node_id, None);
    }

    #[test]
    fn node_schemas_are_checked_with_the_sdk() {
        let mut a = task("a", &[]);
        a["inputSchema"] = json!({"type": "string", "format": "email"});
        a["outputSchema"] = json!({"type": 5});
        let v = validate_graph(&graph(vec![a, end("end", &["a"])]));
        assert_eq!(v.verdict.as_deref(), Some("SCHEMA_UNSUPPORTED"));
        assert_eq!(
            codes_at(&v),
            pairs(&[("SCHEMA_UNSUPPORTED", "/nodes/0/inputSchema"), ("SCHEMA_INVALID", "/nodes/0/outputSchema")])
        );
    }

    #[test]
    fn unsafe_numbers_are_located() {
        let d = json!({"id": "d", "kind": "DECISION", "dependsOn": [], "config": {"field": "f", "equals": 1.5, "then": "a", "else": "b"}});
        let g = graph_without_revision(vec![d, task("a", &["d"]), task("b", &["d"]), end("end", &["a", "b"])]);
        let v = validate_graph(&g);
        assert_eq!(v.verdict.as_deref(), Some("UNSAFE_NUMBER"));
        assert_eq!(codes_at(&v), pairs(&[("UNSAFE_NUMBER", "/nodes/0/config/equals")]));
    }

    fn graph_without_revision(nodes: Vec<Value>) -> Value {
        json!({"id": "g", "revision": "r", "nodes": nodes})
    }

    #[test]
    fn reports_different_issues_on_one_node_with_the_verdict_first() {
        let g = graph(vec![
            json!({"id": "w", "kind": "WAIT", "dependsOn": ["ghost"], "config": {"x": 1}}),
            end("end", &["w"]),
        ]);
        let v = validate_graph(&g);
        assert_eq!(v.verdict.as_deref(), Some("INVALID_DEPENDENCY"));
        assert_eq!(codes_at(&v), pairs(&[("INVALID_DEPENDENCY", "/nodes/0/dependsOn/0"), ("NODE_CONFIG", "/nodes/0/config/x")]));
    }

    // --- bounds ---------------------------------------------------------------------

    #[test]
    fn keeps_the_first_500_diagnostics_and_counts_the_rest() {
        let mut nodes: Vec<Value> = (0..700).map(|i| task(&format!("t{i}"), &["ghost"])).collect();
        nodes.push(end("end", &["t0"]));
        let v = validate_graph(&graph(nodes));
        assert_eq!(v.verdict.as_deref(), Some("INVALID_DEPENDENCY"));
        assert_eq!(v.diagnostics.len(), MAX_DIAGNOSTICS);
        assert_eq!(v.diagnostics[0].code, "INVALID_DEPENDENCY");
        // 700 bad dependencies and 699 tasks no END depends on.
        assert_eq!(v.omitted, Omitted { errors: 700 + 699 - 500, warnings: 0, info: 0 });
    }

    #[test]
    fn refuses_content_over_the_size_limit() {
        let big = json!({"id": "g", "revision": "r", "nodes": [], "pad": "x".repeat(MAX_FILE_BYTES as usize)});
        let err = validate_definition(PraxisKind::Graphs, &big).unwrap_err();
        assert!(err.contains("larger than"), "{err}");
        assert!(validate_definition(PraxisKind::Graphs, &graph(vec![end("end", &[])])).is_ok());
    }

    #[test]
    fn grants_and_triggers_can_be_validated() {
        assert!(validate_definition(PraxisKind::Grants, &json!({})).is_ok());
        assert!(validate_definition(PraxisKind::Triggers, &json!({})).is_ok());
    }

    // --- revision -------------------------------------------------------------------

    #[test]
    fn a_stale_revision_is_an_info_issue_that_doesn_t_make_the_graph_invalid() {
        let g = graph_without_revision(vec![end("end", &[])]);
        let v = validate_graph(&g);
        assert_eq!(v.verdict, None);
        assert_eq!(v.diagnostics.len(), 1);
        let d = &v.diagnostics[0];
        assert_eq!((d.code.as_str(), d.severity, d.path.as_str()), ("REVISION_MISMATCH", Severity::Info, "/revision"));
        assert!(d.message.contains("sha256:"), "{}", d.message);
    }

    #[test]
    fn serializes_for_the_frontend() {
        let d = &validate_graph(&graph(vec![task("a", &["a"]), end("end", &["a"])])).diagnostics[0];
        assert_eq!(
            serde_json::to_value(d).unwrap(),
            json!({
                "code": "INVALID_DEPENDENCY",
                "severity": "error",
                "message": "A node can't depend on itself.",
                "path": "/nodes/0/dependsOn/0",
                "nodeId": "a",
                "field": "dependsOn.0"
            })
        );
    }

    // --- contracts ---------------------------------------------------------------------

    fn contract() -> Value {
        json!({
            "id": "c", "missionId": "c", "aiwsEdition": "0.4", "profile": "finite-v1",
            "budget": "0", "deadline": "1893456000000", "criteria": ["Tests pass"],
            "actions": [], "resources": [], "requiresApproval": true,
            "maxAttempts": "1", "maxAuthorizationAgeMs": "0", "features": ["graphs"]
        })
    }

    #[test]
    fn a_contract_the_sdk_accepts_has_no_issues() {
        let v = validate_definition(PraxisKind::Contracts, &contract()).unwrap();
        assert_eq!(v.verdict, None);
        assert!(v.diagnostics.is_empty(), "{:?}", v.diagnostics);
    }

    #[test]
    fn an_unset_deadline_is_flagged_on_its_field() {
        let mut c = contract();
        c["deadline"] = json!("");
        let v = validate_contract(&c);
        assert_eq!(v.verdict.as_deref(), Some("INVALID_RECORD"));
        assert_eq!(codes_at(&v), pairs(&[("INVALID_RECORD", "/deadline")]));
        assert_eq!(v.diagnostics[0].message, "The deadline isn't set.");
    }

    #[test]
    fn every_bad_integer_is_reported_once_on_its_field() {
        let mut c = contract();
        c["budget"] = json!("01");
        c["maxAttempts"] = json!("x".repeat(101));
        c["maxAuthorizationAgeMs"] = json!(5);
        let v = validate_contract(&c);
        assert_eq!(
            codes_at(&v),
            pairs(&[("INVALID_RECORD", "/budget"), ("INVALID_RECORD", "/maxAttempts"), ("INVALID_RECORD", "/maxAuthorizationAgeMs")])
        );
    }

    #[test]
    fn create_missions_rules_are_located() {
        let mut c = contract();
        c["criteria"] = json!([]);
        c["maxAttempts"] = json!("0");
        let v = validate_contract(&c);
        assert_eq!(v.verdict.as_deref(), Some("INVALID_CONTRACT"));
        assert_eq!(codes_at(&v), pairs(&[("INVALID_CONTRACT", "/criteria"), ("INVALID_CONTRACT", "/maxAttempts")]));
    }

    #[test]
    fn a_wrong_constant_or_an_unknown_key_is_invalid() {
        let mut c = contract();
        c["aiwsEdition"] = json!("0.3");
        c["extra"] = json!(1);
        let v = validate_contract(&c);
        assert_eq!(v.verdict.as_deref(), Some("INVALID_RECORD"));
        assert!(v.diagnostics.iter().any(|d| d.path == "/aiwsEdition" && d.message.contains("0.4")));
        assert!(v.diagnostics.iter().any(|d| d.path.is_empty()));
    }

    // --- grants ------------------------------------------------------------------------

    fn grant(id: &str) -> Value {
        json!({
            "id": id, "subject": "agent", "profile": "finite-v1",
            "actions": ["read"], "resources": ["repo"],
            "notBefore": "0", "expiresAt": "1000", "limit": "10",
            "canDelegate": true, "depth": "2"
        })
    }

    fn mission_contract() -> Value {
        let mut c = contract();
        c["actions"] = json!(["read", "write"]);
        c["resources"] = json!(["repo"]);
        c["budget"] = json!("100");
        c["deadline"] = json!("5000");
        c
    }

    #[test]
    fn a_grant_record_the_sdk_accepts_has_no_issues() {
        let v = validate_definition(PraxisKind::Grants, &grant("a")).unwrap();
        assert_eq!(v, Validation { verdict: None, diagnostics: vec![], omitted: Omitted::default() });
    }

    #[test]
    fn a_new_grant_s_unset_fields_are_flagged_plainly() {
        let mut g = grant("a");
        g["subject"] = json!("");
        g["notBefore"] = json!("");
        g["limit"] = json!("01");
        let v = validate_grant(&g);
        assert_eq!(v.verdict.as_deref(), Some("INVALID_RECORD"));
        let messages: Vec<(&str, &str)> = v.diagnostics.iter().map(|d| (d.path.as_str(), d.message.as_str())).collect();
        assert_eq!(
            messages,
            vec![
                ("/subject", "The subject isn't set."),
                ("/notBefore", "This time isn't set."),
                ("/limit", "This isn't a whole number of 0 or more written in digits, with no leading zero."),
            ]
        );
    }

    #[test]
    fn a_grant_within_its_contract_and_parent_is_accepted_on_the_mission() {
        let mut child = grant("b");
        child["parentId"] = json!("a");
        child["depth"] = json!("1");
        let v = validate_grant_on_mission(&child, &mission_contract(), &[grant("a")], &["a"]);
        assert_eq!(v, Validation { verdict: None, diagnostics: vec![], omitted: Omitted::default() });
    }

    #[test]
    fn a_grant_beyond_its_contract_is_located_on_each_field() {
        let mut g = grant("a");
        g["actions"] = json!(["read", "deploy"]);
        g["limit"] = json!("101");
        g["expiresAt"] = json!("6000");
        let v = validate_grant_on_mission(&g, &mission_contract(), &[], &[]);
        assert_eq!(v.verdict.as_deref(), Some("AUTHORITY_DENIED"));
        assert_eq!(
            codes_at(&v),
            pairs(&[("AUTHORITY_DENIED", "/actions/1"), ("AUTHORITY_DENIED", "/limit"), ("AUTHORITY_DENIED", "/expiresAt")])
        );
        assert_eq!(v.diagnostics[1].message, "The limit is more than contract c's budget of 100.");
    }

    #[test]
    fn a_grant_that_expires_before_it_starts_is_indeterminate() {
        let mut g = grant("a");
        g["notBefore"] = json!("1000");
        let v = validate_grant_on_mission(&g, &mission_contract(), &[], &[]);
        assert_eq!(v.verdict.as_deref(), Some("AUTHORITY_INDETERMINATE"));
        assert_eq!(codes_at(&v), pairs(&[("AUTHORITY_INDETERMINATE", "/expiresAt")]));
    }

    #[test]
    fn a_grant_beyond_its_parent_is_located_on_each_field() {
        let mut parent = grant("a");
        parent["canDelegate"] = json!(false);
        parent["limit"] = json!("5");
        let mut child = grant("b");
        child["parentId"] = json!("a");
        let v = validate_grant_on_mission(&child, &mission_contract(), &[parent], &["a"]);
        assert_eq!(v.verdict.as_deref(), Some("AUTHORITY_DENIED"));
        assert_eq!(
            codes_at(&v),
            pairs(&[("AUTHORITY_DENIED", "/parentId"), ("AUTHORITY_DENIED", "/depth"), ("AUTHORITY_DENIED", "/limit")])
        );
        assert_eq!(v.diagnostics[2].message, "The limit is more than grant a's limit of 5.");
    }

    #[test]
    fn a_parent_that_isn_t_on_the_mission_is_not_found() {
        let mut child = grant("b");
        child["parentId"] = json!("ghost");
        let v = validate_grant_on_mission(&child, &mission_contract(), &[], &[]);
        assert_eq!(v.verdict.as_deref(), Some("NOT_FOUND"));
        assert_eq!(codes_at(&v), pairs(&[("NOT_FOUND", "/parentId")]));
    }

    #[test]
    fn a_refused_ancestor_is_info_and_leaves_the_parent_off_the_mission() {
        let mut parent = grant("a");
        parent["limit"] = json!("1000");
        let mut child = grant("b");
        child["parentId"] = json!("a");
        child["depth"] = json!("1");
        let v = validate_grant_on_mission(&child, &mission_contract(), &[parent], &["a"]);
        assert_eq!(v.verdict.as_deref(), Some("NOT_FOUND"));
        assert_eq!(codes_at(&v), pairs(&[("NOT_FOUND", "/parentId"), ("AUTHORITY_DENIED", "/parentId")]));
        assert_eq!(v.diagnostics[1].severity, Severity::Info);
    }

    #[test]
    fn a_refused_contract_is_info_and_no_verdict_on_the_grant() {
        let mut c = mission_contract();
        c["criteria"] = json!([]);
        let v = validate_grant_on_mission(&grant("a"), &c, &[], &[]);
        assert_eq!(v.verdict, None);
        assert_eq!(codes_at(&v), pairs(&[("INVALID_CONTRACT", "")]));
        assert_eq!(v.diagnostics[0].severity, Severity::Info);
    }

    #[test]
    fn an_ancestor_the_contract_doesn_t_bind_is_left_off_the_mission() {
        let mut child = grant("b");
        child["parentId"] = json!("a");
        child["depth"] = json!("1");
        let v = validate_grant_on_mission(&child, &mission_contract(), &[grant("a")], &["b"]);
        assert_eq!(v.verdict.as_deref(), Some("NOT_FOUND"));
        assert_eq!(codes_at(&v), pairs(&[("NOT_FOUND", "/parentId"), ("NOT_BOUND", "/parentId")]));
        assert_eq!(v.diagnostics[1].severity, Severity::Info);
    }

    // --- triggers ----------------------------------------------------------------------

    fn trigger() -> Value {
        let mut t = json!({
            "id": "t", "revision": "1", "kind": "MANUAL", "source": "quay", "eventType": "manual",
            "contractId": "c", "action": "START_RUN", "enabled": false,
            "notBefore": "0", "expiresAt": "1893456000000", "maxAgeMs": "0",
            "maxConcurrent": "1", "rateLimit": "1", "rateWindowMs": "1", "maxDepth": "0"
        });
        stamped(&mut t);
        t
    }

    /// Sets the trigger's revision to match its content, as a save does, so a test sees only
    /// the issues its edits cause.
    fn stamped(t: &mut Value) -> &Value {
        t["revision"] = json!(content_revision(t).unwrap());
        t
    }

    /// Each `registerTrigger` command in the SDK's fixtures, with the error it expects.
    fn trigger_vectors() -> Vec<(String, Value, Option<String>)> {
        let fixtures: Value =
            serde_json::from_str(include_str!("../../../vendor/aiws/spec/fixtures.json")).unwrap();
        let mut vectors = Vec::new();
        for fixture in fixtures.as_array().unwrap() {
            for step in fixture["steps"].as_array().into_iter().flatten() {
                if step["command"]["type"] == "registerTrigger" {
                    vectors.push((
                        fixture["name"].as_str().unwrap().to_string(),
                        step["command"]["trigger"].clone(),
                        step["error"].as_str().map(str::to_string),
                    ));
                }
            }
        }
        vectors
    }

    /// The vectors that fail on the contract's side: a trigger naming another contract, and
    /// a contract without the triggers feature. The scratch mission can't see either.
    const CONTRACT_SIDE: &[&str] = &["trigger-outside-contract", "trigger-feature-required"];

    #[test]
    fn the_trigger_verdict_is_the_vector_s_expected_error_on_the_trigger_s_side() {
        let vectors = trigger_vectors();
        assert_eq!(vectors.len(), 22);
        for (name, t, expected) in vectors {
            let expected = if CONTRACT_SIDE.contains(&name.as_str()) { None } else { expected };
            let v = validate_trigger(&t);
            assert_eq!(v.verdict, expected, "{name}");
            let errors: Vec<&Diagnostic> = v.diagnostics.iter().filter(|d| d.severity == Severity::Error).collect();
            match &expected {
                None => assert!(errors.is_empty(), "{name}: {errors:?}"),
                Some(code) => assert_eq!(&errors[0].code, code, "{name}"),
            }
        }
    }

    #[test]
    fn a_trigger_the_sdk_accepts_has_no_issues() {
        let v = validate_definition(PraxisKind::Triggers, &trigger()).unwrap();
        assert_eq!(v.verdict, None);
        assert!(v.diagnostics.is_empty(), "{:?}", v.diagnostics);
    }

    #[test]
    fn a_new_trigger_s_empty_fields_are_flagged_on_each_field() {
        let mut t = trigger();
        for key in ["source", "eventType", "contractId", "notBefore", "expiresAt"] {
            t[key] = json!("");
        }
        let v = validate_trigger(stamped(&mut t));
        assert_eq!(v.verdict.as_deref(), Some("INVALID_RECORD"));
        let mut found: Vec<(&str, &str)> =
            v.diagnostics.iter().map(|d| (d.path.as_str(), d.message.as_str())).collect();
        found.sort();
        assert_eq!(
            found,
            vec![
                ("/contractId", "The contract isn't set."),
                ("/eventType", "The event type isn't set."),
                ("/expiresAt", "This time isn't set."),
                ("/notBefore", "This time isn't set."),
                ("/source", "The source isn't set."),
            ]
        );
    }

    #[test]
    fn register_trigger_s_rules_are_located_on_their_fields() {
        let mut t = trigger();
        t["expiresAt"] = json!("0");
        t["rateLimit"] = json!("0");
        t["action"] = json!("RESUME_WAIT");
        t["kind"] = json!("CONDITION");
        let v = validate_trigger(stamped(&mut t));
        assert_eq!(v.verdict.as_deref(), Some("TRIGGER_CONTRACT"));
        assert_eq!(
            codes_at(&v),
            pairs(&[
                ("TRIGGER_CONTRACT", "/expiresAt"),
                ("TRIGGER_LIMIT", "/rateLimit"),
                ("TRIGGER_TARGET", "/waitId"),
                ("TRIGGER_CONDITION", "/filter"),
                ("TRIGGER_CONDITION", "/conditionMode"),
            ])
        );
    }

    #[test]
    fn a_schedule_must_belong_to_a_scheduled_trigger_and_fit_its_limits() {
        let mut t = trigger();
        t["kind"] = json!("SCHEDULED");
        assert_eq!(codes_at(&validate_trigger(stamped(&mut t))), pairs(&[("SCHEDULE_CONFIG", "/schedule")]));
        t["schedule"] = json!({"startMs": "0", "intervalMs": "0", "catchUp": "SKIP", "maxCatchUp": "1001"});
        let v = validate_trigger(stamped(&mut t));
        assert_eq!(v.verdict.as_deref(), Some("SCHEDULE_CONFIG"));
        assert_eq!(
            codes_at(&v),
            pairs(&[("SCHEDULE_CONFIG", "/schedule/intervalMs"), ("SCHEDULE_CONFIG", "/schedule/maxCatchUp")])
        );
        t["kind"] = json!("MANUAL");
        t["schedule"]["intervalMs"] = json!("1");
        t["schedule"]["maxCatchUp"] = json!("1");
        assert_eq!(codes_at(&validate_trigger(stamped(&mut t))), pairs(&[("SCHEDULE_CONFIG", "/schedule")]));
    }

    #[test]
    fn a_wait_id_belongs_only_to_resume_wait() {
        let mut t = trigger();
        t["waitId"] = json!("w");
        let v = validate_trigger(stamped(&mut t));
        assert_eq!(v.verdict.as_deref(), Some("TRIGGER_TARGET"));
        assert_eq!(v.diagnostics[0].message, "Only a RESUME_WAIT trigger has a wait id.");
    }

    #[test]
    fn a_condition_mode_on_another_kind_is_an_info_issue() {
        let mut t = trigger();
        t["conditionMode"] = json!("EDGE");
        let v = validate_trigger(stamped(&mut t));
        assert_eq!(v.verdict, None);
        let d = &v.diagnostics[0];
        assert_eq!((d.code.as_str(), d.severity, d.path.as_str()), ("UNUSED_FIELD", Severity::Info, "/conditionMode"));
    }

    #[test]
    fn a_trigger_s_stale_revision_is_an_info_issue() {
        let mut t = trigger();
        t["revision"] = json!("1");
        let v = validate_trigger(&t);
        assert_eq!(v.verdict, None);
        let d = &v.diagnostics[0];
        assert_eq!((d.code.as_str(), d.severity, d.path.as_str()), ("REVISION_MISMATCH", Severity::Info, "/revision"));
        assert!(d.message.contains("trigger's content"), "{}", d.message);
    }
}
