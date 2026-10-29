//! The attach checks of a graph binding that need only local data (#247, #274), run once per
//! contract whose bindings file lists the binding's graph. Praxis makes them when a run is
//! attached, and the contract is chosen then, so here each is a warning named after its
//! contract, and a graph under no contract gets none:
//!
//! - `maxTotalCost` against `Contract.budget`, and each entry's `maxAttempts` against
//!   `Contract.maxAttempts` (`LIMIT_CONFIGURATION_INVALID`);
//! - `costUnit` agreement with the saved bindings of the contract's other graphs, since a run's
//!   cost unit must be the installation's one ledger unit (#231);
//! - `CRITERIA_UNKNOWN` for a Validation entry's criterion the contract lacks, and
//!   `CRITERIA_UNCOVERED` for a contract criterion with no Validation ancestor at some
//!   VERIFICATION node, with the coverage table that shows it.
//!
//! The binding and graph are passed in, so a draft is checked; contracts and other bindings are
//! read as saved. Left to Praxis: `COST_UNIT_MISMATCH` against the ledger unit, catalog agents,
//! protocol bindings and readiness.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::Serialize;
use serde_json::{Map, Value};

use super::grants::{binding_contracts, read_record};
use super::graph_bindings::{saved_bindings, MAX_BINDINGS_SCANNED};
use super::models::PraxisKind;
use super::store::{validate_id, PRAXIS_DIR};
use super::validate::{escape, Diagnostic, Severity, MAX_DIAGNOSTICS};

/// One contract criterion at a VERIFICATION node, and the Validation ancestors whose entries list it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionCoverage {
    pub criterion: String,
    /// The ancestors' ids, in graph order; empty when the criterion is uncovered there.
    pub covered_by: Vec<String>,
}

/// A VERIFICATION node's coverage of one contract's criteria, in the contract's order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCoverage {
    pub node_id: String,
    pub criteria: Vec<CriterionCoverage>,
}

/// One contract whose bindings list the graph: the figures the builder shows against it, the
/// coverage of its criteria, and the warnings its attach checks found. `problem` says why the
/// contract couldn't be read, and then nothing was checked against it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachContract {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
    /// `Contract.budget`, when it is a string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget: Option<String>,
    /// `Contract.maxAttempts`, when it is a string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_attempts: Option<String>,
    pub coverage: Vec<VerificationCoverage>,
    /// At most `MAX_DIAGNOSTICS` warnings.
    pub diagnostics: Vec<Diagnostic>,
    /// How many more warnings were found than `diagnostics` holds.
    pub omitted: usize,
}

/// `praxis_check_binding`: the attach checks of a binding under each contract that lists its
/// graph, in contract id order. `unchecked` names the files that couldn't be read or weren't searched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingAttach {
    pub contracts: Vec<AttachContract>,
    pub unchecked: Vec<String>,
}

/// A canonical unsigned decimal as (digit count, digits), so two compare as numbers. `None` for
/// anything else, which the record's own checks report.
fn decimal(v: Option<&Value>) -> Option<(usize, &str)> {
    let s = v?.as_str()?;
    let canonical = s == "0" || (!s.is_empty() && !s.starts_with('0') && s.bytes().all(|c| c.is_ascii_digit()));
    canonical.then_some((s.len(), s))
}

/// A warning on the binding found by contract `cid`'s attach checks.
fn warning(code: &str, path: String, node_id: Option<&str>, message: String) -> Diagnostic {
    Diagnostic { code: code.to_string(), severity: Severity::Warning, message, path, node_id: node_id.map(str::to_string), field: None }
}

/// The strings of a JSON array, in order; none when it isn't one.
fn strings(v: Option<&Value>) -> Vec<&str> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default()
}

/// Checks `binding`, with `graph` as its graph, against every contract whose bindings file lists
/// the binding's `graphId`.
pub fn check_attach(repo: &Path, binding: &Value, graph: &Value) -> Result<BindingAttach, String> {
    let Some(graph_id) = binding.get("graphId").and_then(Value::as_str).filter(|id| validate_id(id).is_ok()) else {
        return Ok(BindingAttach { contracts: Vec::new(), unchecked: Vec::new() });
    };
    let (binders, mut unchecked) = binding_contracts(repo, "graphs", graph_id)?;
    if binders.is_empty() {
        return Ok(BindingAttach { contracts: Vec::new(), unchecked });
    }
    let (saved, skipped) = saved_bindings(repo, MAX_BINDINGS_SCANNED)?;
    if skipped > 0 {
        unchecked.push(format!(
            "{}/{}/: the {} files after the first {} weren't searched.",
            PRAXIS_DIR,
            PraxisKind::GraphBindings.folder(),
            skipped,
            MAX_BINDINGS_SCANNED
        ));
    }
    let coverage_of = Coverage::of(binding, graph);
    let contracts = binders
        .into_iter()
        .map(|binder| {
            let unread = |problem: String| AttachContract {
                id: binder.contract.clone(),
                problem: Some(problem),
                budget: None,
                max_attempts: None,
                coverage: Vec::new(),
                diagnostics: Vec::new(),
                omitted: 0,
            };
            match read_record(repo, PraxisKind::Contracts.folder(), &binder.contract) {
                Ok(Some(contract)) => check_contract(&binder.contract, &contract, binding, &binder.listed, &saved, &coverage_of),
                Ok(None) => unread("The contract file doesn't exist.".to_string()),
                Err(why) => unread(why),
            }
        })
        .collect();
    Ok(BindingAttach { contracts, unchecked })
}

/// One contract's attach checks of the binding. `graphs` are the graphs its bindings file lists,
/// and `saved` every saved graph binding by id.
fn check_contract(
    cid: &str,
    contract: &Value,
    binding: &Value,
    graphs: &[String],
    saved: &[(String, Value)],
    coverage_of: &Coverage,
) -> AttachContract {
    let mut found = Vec::new();
    let budget = contract.get("budget");
    if let (Some(cost), Some(limit)) = (decimal(binding.get("maxTotalCost")), decimal(budget))
        && cost > limit
    {
        let message = format!(
            "Under contract {}, the max total cost, {}, is above the contract's budget, {}, so Praxis refuses to attach a run.",
            cid, cost.1, limit.1
        );
        found.push(warning("LIMIT_CONFIGURATION_INVALID", "/maxTotalCost".to_string(), None, message));
    }

    let none = Map::new();
    let entries = binding.get("nodes").and_then(Value::as_object).unwrap_or(&none);
    if let Some(limit) = decimal(contract.get("maxAttempts")) {
        for (id, entry) in entries {
            let Some(attempts) = entry.get("maxAttempts").and_then(Value::as_u64) else { continue };
            let attempts = attempts.to_string();
            if (attempts.len(), attempts.as_str()) > limit {
                let message = format!(
                    "Under contract {}, max attempts {} is above the contract's maxAttempts, {}, so Praxis refuses to attach a run.",
                    cid, attempts, limit.1
                );
                let path = format!("/nodes/{}/maxAttempts", escape(id));
                found.push(warning("LIMIT_CONFIGURATION_INVALID", path, Some(id), message));
            }
        }
    }

    let own_id = binding.get("graphBindingId").and_then(Value::as_str);
    if let Some(unit) = binding.get("costUnit").and_then(Value::as_str).filter(|u| !u.is_empty()) {
        let others: Vec<String> = saved
            .iter()
            .filter(|(id, _)| Some(id.as_str()) != own_id)
            .filter(|(_, b)| b.get("graphId").and_then(Value::as_str).is_some_and(|g| graphs.iter().any(|x| x == g)))
            .filter_map(|(id, b)| {
                let other = b.get("costUnit").and_then(Value::as_str).filter(|u| !u.is_empty() && *u != unit)?;
                Some(format!("{} ({})", id, other))
            })
            .collect();
        if !others.is_empty() {
            let message = format!(
                "Under contract {}, the cost unit {} disagrees with other bindings of its graphs: {}. A run's cost unit must be the ledger's one unit.",
                cid,
                unit,
                others.join(", ")
            );
            found.push(warning("COST_UNIT_DISAGREEMENT", "/costUnit".to_string(), None, message));
        }
    }

    let criteria = strings(contract.get("criteria"));
    for (id, entry) in entries {
        if entry.get("role").and_then(Value::as_str) != Some("VALIDATION") {
            continue;
        }
        for (i, name) in strings(entry.get("criteria")).into_iter().enumerate() {
            if !criteria.contains(&name) {
                let message = format!("Contract {} has no criterion {}, so Praxis refuses to attach a run under it.", cid, name);
                found.push(warning("CRITERIA_UNKNOWN", format!("/nodes/{}/criteria/{}", escape(id), i), Some(id), message));
            }
        }
    }
    let coverage = coverage_of.table(&criteria);
    for at in &coverage {
        for row in at.criteria.iter().filter(|r| r.covered_by.is_empty()) {
            let message = format!(
                "Under contract {}, no Validation node before {} covers the criterion {}, so Praxis refuses to attach a run.",
                cid, at.node_id, row.criterion
            );
            found.push(warning("CRITERIA_UNCOVERED", String::new(), Some(&at.node_id), message));
        }
    }

    let omitted = found.len().saturating_sub(MAX_DIAGNOSTICS);
    found.truncate(MAX_DIAGNOSTICS);
    AttachContract {
        id: cid.to_string(),
        problem: None,
        budget: budget.and_then(Value::as_str).map(str::to_string),
        max_attempts: contract.get("maxAttempts").and_then(Value::as_str).map(str::to_string),
        coverage,
        diagnostics: found,
        omitted,
    }
}

/// The criteria a VERIFICATION node's Validation ancestors list, each with the ancestors that list it.
type Covered = Vec<(String, Vec<String>)>;

/// What each VERIFICATION node can verify, which doesn't depend on the contract: for each, in
/// graph order, the criteria its Validation ancestors list and which ancestors list each.
pub struct Coverage {
    nodes: Vec<(String, Covered)>,
}

impl Coverage {
    /// The Validation ancestors of each VERIFICATION node of `graph`, by the criteria the
    /// binding's entries for them list. An ancestor is any node the VERIFICATION node depends on,
    /// directly or not; a loop in `dependsOn`, which the graph's validation refuses, ends the walk.
    pub fn of(binding: &Value, graph: &Value) -> Coverage {
        let empty = Map::new();
        let entries = binding.get("nodes").and_then(Value::as_object).unwrap_or(&empty);
        let nodes: Vec<&Value> = graph.get("nodes").and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default();
        let id_of = |n: &Value| n.get("id").and_then(Value::as_str).map(str::to_string);
        let parents: HashMap<String, Vec<&str>> =
            nodes.iter().filter_map(|n| Some((id_of(n)?, strings(n.get("dependsOn"))))).collect();
        let lists = |id: &str| -> Vec<&str> {
            let entry = entries.get(id);
            if entry.and_then(|e| e.get("role")).and_then(Value::as_str) == Some("VALIDATION") {
                strings(entry.and_then(|e| e.get("criteria")))
            } else {
                Vec::new()
            }
        };
        let verifications = nodes.iter().filter(|n| n.get("kind").and_then(Value::as_str) == Some("VERIFICATION")).filter_map(|n| id_of(n));
        let nodes = verifications
            .map(|v| {
                let mut seen: HashSet<&str> = HashSet::new();
                let mut stack: Vec<&str> = parents.get(&v).cloned().unwrap_or_default();
                while let Some(id) = stack.pop() {
                    if seen.insert(id) {
                        stack.extend(parents.get(id).into_iter().flatten().copied());
                    }
                }
                let mut by_criterion: Covered = Vec::new();
                let ancestors = nodes.iter().filter_map(|n| id_of(n)).filter(|id| seen.contains(id.as_str()));
                for ancestor in ancestors {
                    for name in lists(&ancestor) {
                        match by_criterion.iter_mut().find(|(c, _)| c == name) {
                            Some((_, ids)) => ids.push(ancestor.clone()),
                            None => by_criterion.push((name.to_string(), vec![ancestor.clone()])),
                        }
                    }
                }
                (v, by_criterion)
            })
            .collect();
        Coverage { nodes }
    }

    /// The coverage table of a contract's `criteria`, in its order, at each VERIFICATION node.
    pub fn table(&self, criteria: &[&str]) -> Vec<VerificationCoverage> {
        self.nodes
            .iter()
            .map(|(node_id, covered)| VerificationCoverage {
                node_id: node_id.clone(),
                criteria: criteria
                    .iter()
                    .map(|c| CriterionCoverage {
                        criterion: c.to_string(),
                        covered_by: covered.iter().find(|(name, _)| name == c).map(|(_, ids)| ids.clone()).unwrap_or_default(),
                    })
                    .collect(),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;

    fn temp_repo() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quay2-praxis-attach-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    fn write(repo: &Path, rel: &str, value: &Value) {
        let path = repo.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, value.to_string()).unwrap();
    }

    fn contract(id: &str, budget: &str, max_attempts: &str, criteria: &[&str]) -> Value {
        json!({
            "id": id, "missionId": id, "aiwsEdition": "0.4", "profile": "finite-v1",
            "budget": budget, "deadline": "5000", "criteria": criteria, "actions": ["read"], "resources": ["repo"],
            "requiresApproval": true, "maxAttempts": max_attempts, "maxAuthorizationAgeMs": "0", "features": ["graphs"]
        })
    }

    fn lists(repo: &Path, contract: &str, graphs: &[&str]) {
        write(repo, &format!(".praxis/bindings/{contract}.json"), &json!({"version": 1, "graphs": graphs, "grants": []}));
    }

    /// build -> check (Validation of `tests`) -> verify -> lint (Validation of `style`) -> late -> end.
    fn graph() -> Value {
        json!({"id": "g", "revision": "1", "nodes": [
            {"id": "build", "kind": "TASK", "dependsOn": [], "config": {"executionKind": "AGENT"}},
            {"id": "check", "kind": "TASK", "dependsOn": ["build"], "config": {"executionKind": "AGENT"}},
            {"id": "verify", "kind": "VERIFICATION", "dependsOn": ["check"], "config": {}},
            {"id": "lint", "kind": "TASK", "dependsOn": ["verify"], "config": {"executionKind": "AGENT"}},
            {"id": "late", "kind": "VERIFICATION", "dependsOn": ["lint"], "config": {}},
            {"id": "end", "kind": "END", "dependsOn": ["late"], "config": {}}
        ]})
    }

    fn entry(role: &str, criteria: &[&str]) -> Value {
        let mut e = json!({"executionKind": "AGENT", "role": role});
        if role == "VALIDATION" {
            e["criteria"] = json!(criteria);
        }
        e
    }

    fn binding(id: &str, graph_id: &str) -> Value {
        json!({
            "graphBindingId": id, "graphId": graph_id, "costUnit": "micro-USD",
            "nodes": {
                "build": entry("WORK", &[]),
                "check": entry("VALIDATION", &["tests"]),
                "lint": entry("VALIDATION", &["tests"])
            }
        })
    }

    /// Each warning as (code, path, node).
    fn found(c: &AttachContract) -> Vec<(&str, &str, Option<&str>)> {
        c.diagnostics.iter().map(|d| (d.code.as_str(), d.path.as_str(), d.node_id.as_deref())).collect()
    }

    fn covered<'a>(c: &'a AttachContract, node: &str) -> Vec<(&'a str, Vec<&'a str>)> {
        let at = c.coverage.iter().find(|v| v.node_id == node).unwrap();
        at.criteria.iter().map(|r| (r.criterion.as_str(), r.covered_by.iter().map(String::as_str).collect())).collect()
    }

    #[test]
    fn a_graph_under_no_contract_gets_no_attach_checks() {
        let repo = temp_repo();
        lists(&repo, "c", &["other"]);
        write(&repo, ".praxis/contracts/c.json", &contract("c", "1", "1", &["tests"]));
        let attach = check_attach(&repo, &binding("b", "g"), &graph()).unwrap();
        assert_eq!(attach, BindingAttach { contracts: vec![], unchecked: vec![] });
    }

    #[test]
    fn the_coverage_table_lists_each_criterion_s_validation_ancestors_at_each_verification_node() {
        let repo = temp_repo();
        lists(&repo, "c", &["g"]);
        write(&repo, ".praxis/contracts/c.json", &contract("c", "100", "3", &["tests", "style"]));
        let mut b = binding("b", "g");
        b["nodes"]["lint"] = entry("VALIDATION", &["style", "tests"]);
        let attach = check_attach(&repo, &b, &graph()).unwrap();
        let c = &attach.contracts[0];
        assert_eq!(c.id, "c");
        assert_eq!((c.budget.as_deref(), c.max_attempts.as_deref()), (Some("100"), Some("3")));
        // lint runs after verify, so only late sees it.
        assert_eq!(covered(c, "verify"), vec![("tests", vec!["check"]), ("style", vec![])]);
        assert_eq!(covered(c, "late"), vec![("tests", vec!["check", "lint"]), ("style", vec!["lint"])]);
        assert_eq!(found(c), vec![("CRITERIA_UNCOVERED", "", Some("verify"))]);
        assert_eq!(
            c.diagnostics[0].message,
            "Under contract c, no Validation node before verify covers the criterion style, so Praxis refuses to attach a run."
        );
        assert_eq!(c.diagnostics[0].severity, Severity::Warning);
    }

    #[test]
    fn a_criterion_the_contract_lacks_is_criteria_unknown_once_per_contract() {
        let repo = temp_repo();
        lists(&repo, "c", &["g"]);
        lists(&repo, "d", &["g"]);
        write(&repo, ".praxis/contracts/c.json", &contract("c", "100", "3", &["tests", "style"]));
        write(&repo, ".praxis/contracts/d.json", &contract("d", "100", "3", &["tests"]));
        let mut b = binding("b", "g");
        b["nodes"]["check"] = entry("VALIDATION", &["tests", "style"]);
        let attach = check_attach(&repo, &b, &graph()).unwrap();
        assert_eq!(attach.contracts.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["c", "d"]);
        assert_eq!(found(&attach.contracts[0]), vec![]);
        assert_eq!(found(&attach.contracts[1]), vec![("CRITERIA_UNKNOWN", "/nodes/check/criteria/1", Some("check"))]);
        assert_eq!(attach.contracts[1].diagnostics[0].message, "Contract d has no criterion style, so Praxis refuses to attach a run under it.");
    }

    #[test]
    fn max_total_cost_and_max_attempts_are_checked_against_each_contract() {
        let repo = temp_repo();
        lists(&repo, "c", &["g"]);
        write(&repo, ".praxis/contracts/c.json", &contract("c", "100", "3", &["tests"]));
        let mut b = binding("b", "g");
        b["maxTotalCost"] = json!("101");
        b["nodes"]["build"]["maxAttempts"] = json!(4);
        b["nodes"]["check"]["maxAttempts"] = json!(3);
        let attach = check_attach(&repo, &b, &graph()).unwrap();
        assert_eq!(
            found(&attach.contracts[0]),
            vec![
                ("LIMIT_CONFIGURATION_INVALID", "/maxTotalCost", None),
                ("LIMIT_CONFIGURATION_INVALID", "/nodes/build/maxAttempts", Some("build")),
            ]
        );
        // Compared as numbers, not text: 99 is under 100.
        b["maxTotalCost"] = json!("99");
        b["nodes"]["build"]["maxAttempts"] = json!(3);
        assert_eq!(found(&check_attach(&repo, &b, &graph()).unwrap().contracts[0]), vec![]);
    }

    #[test]
    fn a_cost_unit_that_disagrees_with_the_contract_s_other_graphs_is_named() {
        let repo = temp_repo();
        lists(&repo, "c", &["g", "h"]);
        write(&repo, ".praxis/contracts/c.json", &contract("c", "100", "3", &["tests"]));
        let mut other = binding("h-1", "h");
        other["costUnit"] = json!("cents");
        write(&repo, ".praxis/graph-bindings/h-1.json", &other);
        write(&repo, ".praxis/graph-bindings/h-2.json", &binding("h-2", "h"));
        // This binding's saved copy says cents too, but the draft passed in is what is checked.
        let mut saved_self = binding("b", "g");
        saved_self["costUnit"] = json!("cents");
        write(&repo, ".praxis/graph-bindings/b.json", &saved_self);
        // A graph the contract doesn't list doesn't count.
        let mut unrelated = binding("x-1", "x");
        unrelated["costUnit"] = json!("tokens");
        write(&repo, ".praxis/graph-bindings/x-1.json", &unrelated);
        let attach = check_attach(&repo, &binding("b", "g"), &graph()).unwrap();
        let c = &attach.contracts[0];
        assert_eq!(found(c), vec![("COST_UNIT_DISAGREEMENT", "/costUnit", None)]);
        assert!(c.diagnostics[0].message.contains("h-1 (cents)"), "{:?}", c.diagnostics[0]);
        assert!(!c.diagnostics[0].message.contains("x-1"), "{:?}", c.diagnostics[0]);
    }

    #[test]
    fn a_contract_that_can_t_be_read_is_named_with_why_and_not_checked() {
        let repo = temp_repo();
        lists(&repo, "gone", &["g"]);
        lists(&repo, "bad", &["g"]);
        std::fs::create_dir_all(repo.join(".praxis/contracts")).unwrap();
        std::fs::write(repo.join(".praxis/contracts/bad.json"), "{nope").unwrap();
        let attach = check_attach(&repo, &binding("b", "g"), &graph()).unwrap();
        assert_eq!(attach.contracts.len(), 2);
        assert!(attach.contracts[0].problem.as_deref().unwrap().starts_with("Not valid JSON"), "{:?}", attach.contracts[0]);
        assert_eq!(attach.contracts[1].problem.as_deref(), Some("The contract file doesn't exist."));
        assert!(attach.contracts.iter().all(|c| c.diagnostics.is_empty() && c.coverage.is_empty()));
    }

    #[test]
    fn a_dependency_loop_ends_the_ancestor_walk() {
        let g = json!({"id": "g", "nodes": [
            {"id": "a", "kind": "TASK", "dependsOn": ["v"], "config": {}},
            {"id": "v", "kind": "VERIFICATION", "dependsOn": ["a"], "config": {}}
        ]});
        let b = json!({"nodes": {"a": entry("VALIDATION", &["tests"])}});
        let table = Coverage::of(&b, &g).table(&["tests"]);
        assert_eq!(table[0].criteria[0].covered_by, vec!["a"]);
    }
}
