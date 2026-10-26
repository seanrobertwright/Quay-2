//! Validates Praxis definitions offline with the vendored AI-WS-SDK crate (#220).
//!
//! The SDK's `validate_graph` decides validity and stops at the first rule a graph breaks,
//! naming it with a bare code. The builder needs every issue and where it is, so a locator
//! here repeats each SDK rule over the whole graph and attaches a JSON Pointer, the node and
//! the field. The SDK's code stays the verdict: it always leads the list, and when the SDK
//! accepts a graph no error is reported. The tests hold the locator to the SDK's vectors.

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

/// Validates a definition's content. Only graphs can be validated so far.
pub fn validate_definition(kind: PraxisKind, content: &Value) -> Result<Validation, String> {
    if !fits_in(content, MAX_FILE_BYTES) {
        return Err(format!(
            "The definition is larger than the {} bytes Quay validates.",
            MAX_FILE_BYTES
        ));
    }
    match kind {
        PraxisKind::Graphs => Ok(validate_graph(content)),
        other => Err(format!("Quay can't validate {} yet.", other.folder())),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// The SDK refuses the record.
    Error,
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
    pub info: usize,
}

impl Omitted {
    fn count(&mut self, severity: Severity) {
        match severity {
            Severity::Error => self.errors += 1,
            Severity::Info => self.info += 1,
        }
    }
}

/// Diagnostics as the locator finds them: the first `MAX_DIAGNOSTICS` kept, the rest counted.
#[derive(Default)]
struct Found {
    kept: Vec<Diagnostic>,
    omitted: Omitted,
}

impl Found {
    fn push(&mut self, d: Diagnostic) {
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
    let Found { kept: mut diagnostics, mut omitted } = locate_graph(graph);
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
                diagnostics.insert(0, graph_issue(code, describe(code)));
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

fn describe(code: &str) -> &'static str {
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
    for error in graph_schema().iter_errors(graph) {
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
            ..graph_issue("MISSING_END", "The graph has no END node, so no run could finish.")
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

    if let (Some(revision), Some(expected)) =
        (graph.get("revision").and_then(Value::as_str), content_revision(graph))
        && revision != expected
    {
        out.push(Diagnostic {
            code: "REVISION_MISMATCH".to_string(),
            severity: Severity::Info,
            message: format!(
                "The revision doesn't match the graph's content ({}). Saving sets it again.",
                expected
            ),
            path: "/revision".to_string(),
            node_id: None,
            field: None,
        });
    }
    out
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
fn check_canonical(v: &Value, path: &str, depth: usize, out: &mut impl FnMut(&'static str, &str, String)) {
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
fn escape(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

fn unescape(segment: &str) -> String {
    segment.replace("~1", "/").replace("~0", "~")
}

fn graph_issue(code: &str, message: &str) -> Diagnostic {
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

/// The SDK's bundled schema, with its root pointed at `Graph`, as the SDK builds it.
fn graph_schema() -> &'static jsonschema::Validator {
    static VALIDATOR: std::sync::OnceLock<jsonschema::Validator> = std::sync::OnceLock::new();
    VALIDATOR.get_or_init(|| {
        let mut schema: Value =
            serde_json::from_str(include_str!("../../../vendor/aiws/crates/aiws/src/schema.json"))
                .expect("the vendored schema is JSON");
        schema["$ref"] = json!("#/$defs/Graph");
        jsonschema::validator_for(&schema).expect("the vendored schema compiles")
    })
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
        assert_eq!(v.omitted, Omitted { errors: 700 + 699 - 500, info: 0 });
    }

    #[test]
    fn refuses_content_over_the_size_limit() {
        let big = json!({"id": "g", "revision": "r", "nodes": [], "pad": "x".repeat(MAX_FILE_BYTES as usize)});
        let err = validate_definition(PraxisKind::Graphs, &big).unwrap_err();
        assert!(err.contains("larger than"), "{err}");
        assert!(validate_definition(PraxisKind::Graphs, &graph(vec![end("end", &[])])).is_ok());
    }

    #[test]
    fn only_graphs_can_be_validated() {
        assert!(validate_definition(PraxisKind::Contracts, &json!({})).is_err());
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
}
