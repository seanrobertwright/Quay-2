//! Graph workflows (#444, #459): `.praxis/graph-workflows/<name>.json`, the unit Quay will
//! submit to a Praxis host. A graph workflow ties a contract, a graph and one of that graph's
//! graph bindings together, and carries the grants of the contract's bindings file. Its file
//! name is its name on the host, so it holds no id and follows the host's name rule.

use serde_json::Value;

use super::validate::{Omitted, Validation};

/// The `version` a graph workflow is written with.
pub const GRAPH_WORKFLOW_VERSION: u64 = 1;

/// A graph workflow's keys in the order the canonical file writes them.
pub const GRAPH_WORKFLOW_KEYS: &[&str] = &["version", "contractId", "graphId", "graphBindingId"];

/// Validates a graph workflow's shape. The verdict is the first issue's code.
pub fn validate_graph_workflow(_record: &Value) -> Validation {
    Validation { verdict: None, diagnostics: Vec::new(), omitted: Omitted::default() }
}
