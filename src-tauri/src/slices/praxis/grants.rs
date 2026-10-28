//! Checks a grant against the saved records around it (#223, #231): the delegation chain from
//! the root grant down to its parent, read from `.praxis/grants/`, and a scratch mission under
//! each contract whose bindings file lists it, holding the ancestors that contract binds too.
//! The grant itself is the draft's content, so an
//! unsaved edit is checked; every other record is read as saved.

use std::path::Path;

use serde_json::Value;

use super::lifecycle::MAX_SCANNED;
use super::models::{BoundContract, ChainBreak, ChainLink, GrantCheck, PraxisKind};
use super::store::{confined_dir, confined_file, json_ids, parse_object, read_capped, validate_id, BINDINGS_DIR, PRAXIS_DIR};
use super::validate::validate_grant_on_mission;

/// The most ancestors a chain walk reads. A deeper chain stops with a break.
pub const MAX_CHAIN: usize = 1000;

/// `.praxis/<folder>/<id>.json` as one JSON object: `Ok(None)` when there is no such file,
/// and `Err` with the reason when it can't be read or isn't an object.
pub(super) fn read_record(repo: &Path, folder: &str, id: &str) -> Result<Option<Value>, String> {
    validate_id(id)?;
    let Some(dir) = confined_dir(repo, folder)? else { return Ok(None) };
    let Some(path) = confined_file(repo, &dir, id)? else { return Ok(None) };
    read_capped(&path).and_then(|bytes| parse_object(&bytes)).map(Some).map_err(|p| p.message)
}

/// The saved ancestors of the grant `id` whose parent is `parent`, root first, and the grant
/// that stopped the walk, when one did.
fn walk_chain(repo: &Path, id: &str, parent: Option<&str>) -> (Vec<Value>, Option<ChainBreak>) {
    let grants = PraxisKind::Grants.folder();
    let mut seen = vec![id.to_string()];
    let mut ancestors: Vec<Value> = Vec::new();
    let mut next = parent.map(str::to_string);
    let mut stop = None;
    while let Some(pid) = next.take() {
        let broken = |message: String| Some(ChainBreak { id: pid.clone(), message });
        if seen.contains(&pid) {
            stop = broken(if pid == id {
                "The chain leads back to this grant.".to_string()
            } else {
                format!("Grant {} is its own ancestor, so the chain loops.", pid)
            });
            break;
        }
        if ancestors.len() >= MAX_CHAIN {
            stop = broken(format!("The chain is longer than the {} grants Quay follows.", MAX_CHAIN));
            break;
        }
        match read_record(repo, grants, &pid) {
            Ok(Some(record)) => {
                next = record.get("parentId").and_then(Value::as_str).map(str::to_string);
                seen.push(pid);
                ancestors.push(record);
            }
            Ok(None) => stop = broken("No grant has this id.".to_string()),
            Err(why) => stop = broken(why),
        }
    }
    ancestors.reverse();
    (ancestors, stop)
}

/// A contract whose bindings file lists a grant, and every grant id that file lists.
struct Binder {
    contract: String,
    grants: Vec<String>,
}

/// The contracts whose bindings file lists the grant `id`, in id order, and the bindings files
/// that couldn't be read or weren't searched.
fn binding_contracts(repo: &Path, id: &str) -> Result<(Vec<Binder>, Vec<String>), String> {
    let mut ids = Vec::new();
    let mut unchecked = Vec::new();
    let Some(dir) = confined_dir(repo, BINDINGS_DIR)? else { return Ok((ids, unchecked)) };
    let files = json_ids(&dir, BINDINGS_DIR)?;
    if files.len() > MAX_SCANNED {
        unchecked.push(format!(
            "{}/{}/: the {} files after the first {} weren't searched.",
            PRAXIS_DIR,
            BINDINGS_DIR,
            files.len() - MAX_SCANNED,
            MAX_SCANNED
        ));
    }
    for contract in files.into_iter().take(MAX_SCANNED) {
        match read_record(repo, BINDINGS_DIR, &contract) {
            Ok(Some(record)) => {
                let grants: Vec<String> = record
                    .get("grants")
                    .and_then(Value::as_array)
                    .map(|g| g.iter().filter_map(Value::as_str).map(str::to_string).collect())
                    .unwrap_or_default();
                if grants.iter().any(|g| g == id) {
                    ids.push(Binder { contract, grants });
                }
            }
            Ok(None) => {}
            Err(why) => unchecked.push(format!("{}/{}/{}.json: {}", PRAXIS_DIR, BINDINGS_DIR, contract, why)),
        }
    }
    Ok((ids, unchecked))
}

/// Checks the grant `id`, with `content` as its record, against the saved records around it:
/// its chain of ancestors, and a scratch mission under each contract that binds it, on which
/// the ancestors that contract also binds are granted first.
pub fn check_grant(repo: &Path, id: &str, content: &Value) -> Result<GrantCheck, String> {
    validate_id(id)?;
    let parent = content.get("parentId").and_then(Value::as_str);
    let (ancestors, chain_break) = walk_chain(repo, id, parent);
    let chain = ancestors
        .iter()
        .map(|g| ChainLink {
            id: g.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
            limit: g.get("limit").and_then(Value::as_str).map(str::to_string),
        })
        .collect();
    let (binders, unchecked) = binding_contracts(repo, id)?;
    let contracts = binders
        .into_iter()
        .map(|Binder { contract: cid, grants }| match read_record(repo, PraxisKind::Contracts.folder(), &cid) {
            Ok(Some(contract)) => {
                let bound: Vec<&str> = grants.iter().map(String::as_str).collect();
                BoundContract {
                    budget: contract.get("budget").and_then(Value::as_str).map(str::to_string),
                    problem: None,
                    validation: Some(validate_grant_on_mission(content, &contract, &ancestors, &bound)),
                    id: cid,
                }
            }
            Ok(None) => BoundContract { id: cid, budget: None, problem: Some("The contract file doesn't exist.".to_string()), validation: None },
            Err(why) => BoundContract { id: cid, budget: None, problem: Some(why), validation: None },
        })
        .collect();
    Ok(GrantCheck { chain, chain_break, contracts, unchecked })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;

    fn temp_repo() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quay2-praxis-grants-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    fn write(repo: &Path, rel: &str, value: &Value) {
        let path = repo.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, value.to_string()).unwrap();
    }

    fn grant(id: &str, parent: Option<&str>, limit: &str, depth: &str) -> Value {
        let mut g = json!({
            "id": id, "subject": "agent", "profile": "finite-v1", "actions": ["read"], "resources": ["repo"],
            "notBefore": "0", "expiresAt": "1000", "limit": limit, "canDelegate": true, "depth": depth
        });
        if let Some(p) = parent {
            g["parentId"] = json!(p);
        }
        g
    }

    fn contract(id: &str, budget: &str) -> Value {
        json!({
            "id": id, "missionId": id, "aiwsEdition": "0.4", "profile": "finite-v1",
            "budget": budget, "deadline": "5000", "criteria": ["done"], "actions": ["read"], "resources": ["repo"],
            "requiresApproval": true, "maxAttempts": "1", "maxAuthorizationAgeMs": "0", "features": ["graphs"]
        })
    }

    fn ids(check: &GrantCheck) -> Vec<(&str, Option<&str>)> {
        check.chain.iter().map(|l| (l.id.as_str(), l.limit.as_deref())).collect()
    }

    #[test]
    fn the_chain_runs_from_the_root_down_to_the_parent() {
        let repo = temp_repo();
        write(&repo, ".praxis/grants/root.json", &grant("root", None, "500", "3"));
        write(&repo, ".praxis/grants/p.json", &grant("p", Some("root"), "50", "2"));
        let check = check_grant(&repo, "a", &grant("a", Some("p"), "5", "1")).unwrap();
        assert_eq!(ids(&check), vec![("root", Some("500")), ("p", Some("50"))]);
        assert_eq!(check.chain_break, None);
    }

    #[test]
    fn a_root_grant_has_an_empty_chain() {
        let check = check_grant(&temp_repo(), "a", &grant("a", None, "5", "1")).unwrap();
        assert!(check.chain.is_empty());
        assert_eq!(check.chain_break, None);
        assert!(check.contracts.is_empty());
    }

    #[test]
    fn a_missing_or_unreadable_ancestor_stops_the_chain_and_is_named() {
        let repo = temp_repo();
        write(&repo, ".praxis/grants/p.json", &grant("p", Some("gone"), "50", "2"));
        let check = check_grant(&repo, "a", &grant("a", Some("p"), "5", "1")).unwrap();
        assert_eq!(ids(&check), vec![("p", Some("50"))]);
        assert_eq!(check.chain_break, Some(ChainBreak { id: "gone".into(), message: "No grant has this id.".into() }));

        std::fs::write(repo.join(".praxis/grants/gone.json"), "{nope").unwrap();
        let check = check_grant(&repo, "a", &grant("a", Some("p"), "5", "1")).unwrap();
        assert!(check.chain_break.unwrap().message.starts_with("Not valid JSON"));
    }

    #[test]
    fn a_chain_that_loops_stops_where_it_repeats() {
        let repo = temp_repo();
        write(&repo, ".praxis/grants/p.json", &grant("p", Some("q"), "50", "2"));
        write(&repo, ".praxis/grants/q.json", &grant("q", Some("p"), "50", "2"));
        let check = check_grant(&repo, "a", &grant("a", Some("p"), "5", "1")).unwrap();
        assert_eq!(ids(&check), vec![("q", Some("50")), ("p", Some("50"))]);
        assert_eq!(check.chain_break.unwrap().message, "Grant p is its own ancestor, so the chain loops.");

        write(&repo, ".praxis/grants/q.json", &grant("q", Some("a"), "50", "2"));
        let check = check_grant(&repo, "a", &grant("a", Some("p"), "5", "1")).unwrap();
        assert_eq!(check.chain_break.unwrap().message, "The chain leads back to this grant.");
    }

    #[test]
    fn each_contract_that_binds_the_grant_checks_it_on_a_scratch_mission() {
        let repo = temp_repo();
        write(&repo, ".praxis/grants/p.json", &grant("p", None, "50", "2"));
        write(&repo, ".praxis/contracts/big.json", &contract("big", "100"));
        write(&repo, ".praxis/contracts/small.json", &contract("small", "20"));
        write(&repo, ".praxis/bindings/big.json", &json!({"version": 1, "graphs": [], "grants": ["p", "a"]}));
        write(&repo, ".praxis/contracts/loose.json", &contract("loose", "100"));
        write(&repo, ".praxis/bindings/loose.json", &json!({"version": 1, "graphs": [], "grants": ["a"]}));
        write(&repo, ".praxis/bindings/small.json", &json!({"version": 1, "graphs": [], "grants": ["p", "a"]}));
        write(&repo, ".praxis/bindings/other.json", &json!({"version": 1, "graphs": ["a"], "grants": ["p"]}));
        write(&repo, ".praxis/bindings/gone.json", &json!({"version": 1, "graphs": [], "grants": ["a"]}));
        std::fs::write(repo.join(".praxis/bindings/broken.json"), "{nope").unwrap();

        let check = check_grant(&repo, "a", &grant("a", Some("p"), "10", "1")).unwrap();
        let shown: Vec<(&str, Option<&str>, Option<&str>)> = check
            .contracts
            .iter()
            .map(|c| (c.id.as_str(), c.budget.as_deref(), c.validation.as_ref().and_then(|v| v.verdict.as_deref())))
            .collect();
        // The parent's limit of 50 is over small's budget too, so it never reaches the mission.
        // loose doesn't bind the parent, so the parent isn't on its mission.
        assert_eq!(
            shown,
            vec![
                ("big", Some("100"), None),
                ("gone", None, None),
                ("loose", Some("100"), Some("NOT_FOUND")),
                ("small", Some("20"), Some("NOT_FOUND")),
            ]
        );
        assert_eq!(check.contracts[1].problem.as_deref(), Some("The contract file doesn't exist."));
        assert_eq!(check.unchecked.len(), 1);
        assert!(check.unchecked[0].starts_with(".praxis/bindings/broken.json"), "{:?}", check.unchecked);
    }

    #[test]
    fn an_unsafe_id_is_refused() {
        assert!(check_grant(&temp_repo(), "../a", &json!({})).is_err());
    }
}
