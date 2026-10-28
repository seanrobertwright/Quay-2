//! Cross-record checks (#223, #269). For each contract, a scratch mission is opened from the
//! saved contract with `create_mission`, and then, as Praxis would, its bound grants are
//! granted (each parent before its children), its bound graphs registered, and the triggers
//! that name it registered. Whatever `reduce` refuses is reported on the record it is about,
//! and so is a binding, `parentId` or `contractId` that names no record. Every record is read
//! as saved, so the builder runs the check when a record is opened or saved.
//!
//! `costUnit` disagreement across a contract's graphs (#231) needs the per-node binding records
//! of AI-WS-SDK #249, which don't exist yet, so it isn't checked.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use serde_json::{json, Value};

use super::grants::read_record;
use super::lifecycle::MAX_SCANNED;
use super::models::{ContextCheck, ContractContext, PraxisKind, RecordIssue, RecordRef};
use super::store::{confined_dir, json_ids, validate_id, BINDINGS_DIR, MAX_TRIGGERS_SCANNED, PRAXIS_DIR};
use super::validate::{describe, describe_grant, describe_trigger, grant_issues_on_mission, Diagnostic, Severity, MAX_DIAGNOSTICS};

/// The graphs and grants a contract's bindings file lists, in file order.
#[derive(Default)]
struct Bound {
    graphs: Vec<String>,
    grants: Vec<String>,
}

/// The records every contract's check needs from the whole project, read once: each bindings
/// file by contract id, each trigger by its id, and the files that couldn't be read or weren't
/// searched.
struct Project {
    bindings: BTreeMap<String, Bound>,
    triggers: BTreeMap<String, Value>,
    unchecked: Vec<String>,
}

/// Every `.praxis/<folder>/*.json` file that parses as an object, by id, up to `cap` of them.
/// The rest, and those that can't be read, are named in `unchecked`.
fn read_folder(repo: &Path, folder: &str, cap: usize, unchecked: &mut Vec<String>) -> Result<BTreeMap<String, Value>, String> {
    let mut out = BTreeMap::new();
    let Some(dir) = confined_dir(repo, folder)? else { return Ok(out) };
    let ids = json_ids(&dir, folder)?;
    if ids.len() > cap {
        unchecked.push(format!("{}/{}/: the {} files after the first {} weren't searched.", PRAXIS_DIR, folder, ids.len() - cap, cap));
    }
    for id in ids.into_iter().take(cap) {
        match read_record(repo, folder, &id) {
            Ok(Some(record)) => {
                out.insert(id, record);
            }
            Ok(None) => {}
            Err(why) => unchecked.push(format!("{}/{}/{}.json: {}", PRAXIS_DIR, folder, id, why)),
        }
    }
    Ok(out)
}

/// The strings in a JSON array, or none when it isn't one.
fn strings(v: &Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
}

impl Project {
    /// Reads every bindings file and trigger in the project.
    fn read(repo: &Path) -> Result<Project, String> {
        let mut unchecked = Vec::new();
        let bindings = read_folder(repo, BINDINGS_DIR, MAX_SCANNED, &mut unchecked)?
            .into_iter()
            .map(|(id, b)| (id, Bound { graphs: strings(&b["graphs"]), grants: strings(&b["grants"]) }))
            .collect();
        let triggers = read_folder(repo, PraxisKind::Triggers.folder(), MAX_TRIGGERS_SCANNED, &mut unchecked)?;
        Ok(Project { bindings, triggers, unchecked })
    }

    /// The contract a trigger names, when it is an id a file could have.
    fn trigger_contract(trigger: &Value) -> Option<&str> {
        trigger.get("contractId").and_then(Value::as_str).filter(|id| validate_id(id).is_ok())
    }

    /// The contracts whose bindings file lists `id` in its `graphs` or `grants`.
    fn binders(&self, kind: PraxisKind, id: &str) -> impl Iterator<Item = &String> {
        self.bindings.iter().filter_map(move |(cid, b)| {
            let list = if kind == PraxisKind::Graphs { &b.graphs } else { &b.grants };
            list.iter().any(|x| x == id).then_some(cid)
        })
    }

    /// The triggers that name the contract `cid`, in id order.
    fn triggers_of(&self, cid: &str) -> Vec<(&String, &Value)> {
        self.triggers.iter().filter(|(_, t)| Project::trigger_contract(t) == Some(cid)).collect()
    }
}

/// Checks the contracts `record` affects across records, and the contracts in `also`: every
/// contract when `record` is `None`, the contract itself, the contracts whose bindings list a
/// graph or grant, or the contract a trigger names.
pub fn check_context(repo: &Path, record: Option<&RecordRef>, also: &[String]) -> Result<ContextCheck, String> {
    let mut project = Project::read(repo)?;
    let mut ids: BTreeSet<String> = also.iter().filter(|id| validate_id(id).is_ok()).cloned().collect();
    match record {
        None => {
            let contracts = PraxisKind::Contracts.folder();
            if let Some(dir) = confined_dir(repo, contracts)? {
                let files = json_ids(&dir, contracts)?;
                if files.len() > MAX_SCANNED {
                    let skipped = files.len() - MAX_SCANNED;
                    project.unchecked.push(format!(
                        "{}/{}/: the {} files after the first {} weren't checked.",
                        PRAXIS_DIR, contracts, skipped, MAX_SCANNED
                    ));
                }
                ids.extend(files.into_iter().take(MAX_SCANNED));
            }
            ids.extend(project.bindings.keys().cloned());
            ids.extend(project.triggers.values().filter_map(Project::trigger_contract).map(str::to_string));
        }
        Some(r) => {
            validate_id(&r.id)?;
            match r.kind {
                PraxisKind::Contracts => {
                    ids.insert(r.id.clone());
                }
                PraxisKind::Graphs | PraxisKind::Grants => ids.extend(project.binders(r.kind, &r.id).cloned()),
                PraxisKind::Triggers => {
                    ids.extend(project.triggers.get(&r.id).and_then(Project::trigger_contract).map(str::to_string))
                }
                // A binding's checks against its contracts are #274's; it affects no mission yet.
                PraxisKind::GraphBindings => {}
                // A template refers to no other record, and nothing refers to it (#224).
                PraxisKind::Templates => {}
            }
        }
    }
    let contracts = ids.iter().map(|cid| check_contract(repo, &project, cid)).collect();
    Ok(ContextCheck { contracts, unchecked: project.unchecked })
}

/// The cross-record issues one contract's check finds: the first `MAX_DIAGNOSTICS` kept, the rest counted.
struct Found<'a> {
    contract: &'a str,
    kept: Vec<RecordIssue>,
    omitted: usize,
}

impl Found<'_> {
    fn push(&mut self, kind: PraxisKind, id: &str, diagnostic: Diagnostic) {
        if self.kept.len() < MAX_DIAGNOSTICS {
            self.kept.push(RecordIssue { kind, id: id.to_string(), contract: self.contract.to_string(), diagnostic });
        } else {
            self.omitted += 1;
        }
    }

    /// The context with these issues as its own.
    fn into_context(self, context: ContractContext) -> ContractContext {
        ContractContext { issues: self.kept, omitted: self.omitted, ..context }
    }

    fn issue(&mut self, kind: PraxisKind, id: &str, path: &str, code: &str, message: String) {
        let diagnostic =
            Diagnostic { code: code.to_string(), severity: Severity::Error, message, path: path.to_string(), node_id: None, field: None };
        self.push(kind, id, diagnostic);
    }
}

/// Whether one canonical decimal string is greater than another. A value that isn't one
/// compares as not greater, since the record's own check reports it.
fn greater(a: &Value, b: &Value) -> bool {
    let digits = |v: &Value| v.as_str().filter(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit())).map(|s| (s.len(), s.to_string()));
    matches!((digits(a), digits(b)), (Some(a), Some(b)) if a > b)
}

/// The indexes of `grants` in an order that grants each bound parent before its children,
/// otherwise keeping the bindings file's order. A parent loop is broken where it repeats.
fn parents_first(grants: &[String], records: &[Option<Value>]) -> Vec<usize> {
    let mut index: HashMap<&str, usize> = HashMap::new();
    for (i, id) in grants.iter().enumerate() {
        index.entry(id.as_str()).or_insert(i);
    }
    let parent_of = |i: usize| {
        let record = records[i].as_ref()?;
        index.get(record.get("parentId")?.as_str()?).copied()
    };
    let mut placed = vec![false; grants.len()];
    let mut order = Vec::with_capacity(grants.len());
    for start in 0..grants.len() {
        let mut chain = Vec::new();
        let mut at = Some(start);
        while let Some(i) = at {
            if placed[i] || chain.contains(&i) {
                break;
            }
            chain.push(i);
            at = parent_of(i);
        }
        for i in chain.into_iter().rev() {
            placed[i] = true;
            order.push(i);
        }
    }
    order
}

/// The record a binding entry `/bindings/<list>/<i>` names, as `read`. When there is no such
/// record, or it can't be read, that is an issue on the contract and there is no record.
fn bound_record(found: &mut Found, cid: &str, list: &str, i: usize, noun: &str, id: &str, read: Result<Option<Value>, String>) -> Option<Value> {
    let path = format!("/bindings/{}/{}", list, i);
    match read {
        Ok(Some(record)) => return Some(record),
        Ok(None) => found.issue(PraxisKind::Contracts, cid, &path, "NOT_FOUND", format!("No {} has the id {}.", noun, id)),
        Err(why) => found.issue(PraxisKind::Contracts, cid, &path, "UNREADABLE", format!("{} {} can't be read: {}", capitalized(noun), id, why)),
    }
    None
}

/// The noun with its first letter in upper case, to start a message.
fn capitalized(noun: &str) -> String {
    let mut chars = noun.chars();
    chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

/// Applies `command` to the scratch mission, if one opened, at time 0, which none of the commands
/// the check sends reads. `None` when there is no mission; the mission moves on only when
/// `reduce` accepts the command.
fn apply(mission: &mut Option<aiws_sdk::Snapshot>, command: Value) -> Option<Result<(), aiws_sdk::AiwsError>> {
    let current = mission.as_ref()?;
    let result = aiws_sdk::Command::from_value(command).and_then(|c| aiws_sdk::reduce(current, &c, "0"));
    Some(result.map(|next| *mission = Some(next)))
}

/// One contract's check: its scratch mission, with its bound grants granted, its bound graphs
/// registered, then the triggers that name it registered. When Praxis refuses the contract no
/// mission opens, but the references and trigger deadlines, which need none, are still checked.
fn check_contract(repo: &Path, project: &Project, cid: &str) -> ContractContext {
    let bound = project.bindings.get(cid);
    let (graphs, grants) = bound.map(|b| (b.graphs.clone(), b.grants.clone())).unwrap_or_default();
    let triggers = project.triggers_of(cid);
    let mut found = Found { contract: cid, kept: Vec::new(), omitted: 0 };
    let mut context = ContractContext {
        id: cid.to_string(),
        missing: false,
        problem: None,
        graphs: graphs.clone(),
        grants: grants.clone(),
        triggers: triggers.iter().map(|(id, _)| id.to_string()).collect(),
        issues: Vec::new(),
        omitted: 0,
    };
    let contract = match read_record(repo, PraxisKind::Contracts.folder(), cid) {
        Ok(Some(contract)) => contract,
        Ok(None) => {
            context.missing = true;
            for (tid, _) in &triggers {
                found.issue(PraxisKind::Triggers, tid, "/contractId", "NOT_FOUND", format!("No contract has the id {}.", cid));
            }
            return found.into_context(context);
        }
        Err(why) => {
            context.problem = Some(why);
            return context;
        }
    };
    let mut mission = match aiws_sdk::Contract::from_value(contract.clone()).and_then(|c| aiws_sdk::create_mission(&c)) {
        Ok(mission) => Some(mission),
        Err(e) => {
            let message = format!(
                "Praxis can't open a mission under this contract ({}), so only its references and trigger deadlines are checked.",
                e.code
            );
            found.issue(PraxisKind::Contracts, cid, "", &e.code, message);
            None
        }
    };
    let has_feature = |f: &str| contract["features"].as_array().is_some_and(|a| a.contains(&json!(f)));
    if mission.is_some() && !graphs.is_empty() && !has_feature("graphs") {
        let message = "Graphs are bound to this contract, but its features don't include graphs.".to_string();
        found.issue(PraxisKind::Contracts, cid, "/features", "UNSUPPORTED_FEATURE", message);
    }
    if mission.is_some() && !triggers.is_empty() && !has_feature("triggers") {
        let message = "Triggers name this contract, but its features don't include triggers.".to_string();
        found.issue(PraxisKind::Contracts, cid, "/features", "UNSUPPORTED_FEATURE", message);
    }

    let grant_folder = PraxisKind::Grants.folder();
    let records: Vec<Option<Value>> = grants
        .iter()
        .enumerate()
        .map(|(i, gid)| bound_record(&mut found, cid, "grants", i, "grant", gid, read_record(repo, grant_folder, gid)))
        .collect();
    for i in parents_first(&grants, &records) {
        let (gid, Some(grant)) = (&grants[i], &records[i]) else { continue };
        let parent = grant.get("parentId").and_then(Value::as_str).filter(|p| validate_id(p).is_ok());
        // Whether a problem with the parent has been said, so `reduce`'s NOT_FOUND isn't said again.
        let mut parent_said = false;
        if let Some(pid) = parent {
            let said = match read_record(repo, grant_folder, pid) {
                Ok(None) => Some(("NOT_FOUND", format!("No grant has the id {}.", pid))),
                Err(why) => Some(("UNREADABLE", format!("Grant {} can't be read: {}", pid, why))),
                Ok(Some(_)) if !grants.iter().any(|g| g == pid) => {
                    Some(("NOT_BOUND", format!("Contract {} doesn't bind grant {}, so this grant can't be granted under it.", cid, pid)))
                }
                Ok(Some(_)) => None,
            };
            if let Some((code, message)) = said {
                found.issue(PraxisKind::Grants, gid, "/parentId", code, message);
                parent_said = true;
            }
        }
        if let Some(Err(e)) = apply(&mut mission, json!({"type": "grant", "grant": grant})) {
            // A refused command leaves the mission as it was, so the rules are read against it.
            let at = mission.as_ref().map_or(&Value::Null, |m| m.as_value());
            let located: Vec<Diagnostic> = grant_issues_on_mission(grant, at)
                .into_iter()
                .filter(|d| !(parent_said && d.path == "/parentId" && d.code == "NOT_FOUND"))
                .collect();
            let explained = located.iter().any(|d| d.code == e.code) || (parent_said && e.code == "NOT_FOUND");
            for d in located {
                found.push(PraxisKind::Grants, gid, d);
            }
            if !explained {
                let message = format!("Praxis refuses this grant on contract {}'s mission: {}", cid, describe_grant(&e.code));
                found.issue(PraxisKind::Grants, gid, "", &e.code, message);
            }
        }
    }

    for (i, gid) in graphs.iter().enumerate() {
        let read = read_record(repo, PraxisKind::Graphs.folder(), gid);
        let Some(graph) = bound_record(&mut found, cid, "graphs", i, "graph", gid, read) else { continue };
        if let Some(Err(e)) = apply(&mut mission, json!({"type": "registerGraph", "graph": graph})) {
            let message = match e.code.as_str() {
                "UNSUPPORTED_FEATURE" => format!("Contract {}'s features don't include graphs, so this graph can't run under it.", cid),
                "DUPLICATE_ID" => format!("Contract {} binds a graph with this id more than once.", cid),
                code => format!("Praxis refuses this graph on contract {}'s mission: {}", cid, describe(code)),
            };
            found.issue(PraxisKind::Graphs, gid, "", &e.code, message);
        }
    }

    for (tid, trigger) in &triggers {
        // Said here, not left to `reduce`, which checks the feature first and would hide it.
        let late = greater(&trigger["expiresAt"], &contract["deadline"]);
        if late {
            let message = format!("The trigger expires after contract {}'s deadline.", cid);
            found.issue(PraxisKind::Triggers, tid, "/expiresAt", "TRIGGER_CONTRACT", message);
        }
        if let Some(Err(e)) = apply(&mut mission, json!({"type": "registerTrigger", "trigger": trigger})) {
            let message = match e.code.as_str() {
                "TRIGGER_CONTRACT" if late => continue,
                "UNSUPPORTED_FEATURE" => format!("Contract {}'s features don't include triggers, so this trigger can't fire under it.", cid),
                code => format!("Praxis refuses this trigger on contract {}'s mission: {}", cid, describe_trigger(code)),
            };
            found.issue(PraxisKind::Triggers, tid, "", &e.code, message);
        }
    }

    found.into_context(context)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;
    use crate::slices::praxis::models::{ContractContext, PraxisKind};
    use crate::slices::praxis::revision::content_revision;

    fn temp_repo() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quay2-praxis-context-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    fn write(repo: &Path, rel: &str, value: &Value) {
        let path = repo.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, value.to_string()).unwrap();
    }

    fn contract(id: &str, features: &[&str]) -> Value {
        json!({
            "id": id, "missionId": id, "aiwsEdition": "0.4", "profile": "finite-v1",
            "budget": "100", "deadline": "5000", "criteria": ["done"], "actions": ["read"], "resources": ["repo"],
            "requiresApproval": true, "maxAttempts": "1", "maxAuthorizationAgeMs": "0", "features": features
        })
    }

    fn bindings(repo: &Path, contract: &str, graphs: &[&str], grants: &[&str]) {
        write(repo, &format!(".praxis/bindings/{contract}.json"), &json!({"version": 1, "graphs": graphs, "grants": grants}));
    }

    fn grant(id: &str, parent: Option<&str>, limit: &str) -> Value {
        let mut g = json!({
            "id": id, "subject": "agent", "profile": "finite-v1", "actions": ["read"], "resources": ["repo"],
            "notBefore": "0", "expiresAt": "1000", "limit": limit, "canDelegate": true, "depth": "3"
        });
        if let Some(p) = parent {
            g["parentId"] = json!(p);
            g["depth"] = json!("1");
        }
        g
    }

    fn graph(id: &str) -> Value {
        let mut g = json!({"id": id, "revision": "r", "nodes": [
            {"id": "a", "kind": "TASK", "dependsOn": [], "config": {"executionKind": "AGENT"}},
            {"id": "done", "kind": "END", "dependsOn": ["a"], "config": {}}
        ]});
        g["revision"] = json!(content_revision(&g).unwrap());
        g
    }

    fn trigger(id: &str, contract: &str, expires: &str) -> Value {
        let mut t = json!({
            "id": id, "revision": "1", "kind": "MANUAL", "source": "quay", "eventType": "manual",
            "contractId": contract, "action": "START_RUN", "enabled": false,
            "notBefore": "0", "expiresAt": expires, "maxAgeMs": "0",
            "maxConcurrent": "1", "rateLimit": "1", "rateWindowMs": "1", "maxDepth": "0"
        });
        t["revision"] = json!(content_revision(&t).unwrap());
        t
    }

    /// Each issue as (record, path, code), the record written `kind/id`.
    fn found(c: &ContractContext) -> Vec<(String, &str, &str)> {
        c.issues
            .iter()
            .map(|i| (format!("{}/{}", i.kind.folder(), i.id), i.diagnostic.path.as_str(), i.diagnostic.code.as_str()))
            .collect()
    }

    fn all(repo: &Path) -> ContextCheck {
        check_context(repo, None, &[]).unwrap()
    }

    fn only<'a>(check: &'a ContextCheck, id: &str) -> &'a ContractContext {
        check.contracts.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("{id} wasn't checked: {check:?}"))
    }

    /// A contract that binds a root grant and its child, a graph, and is named by a trigger.
    fn sound_project() -> PathBuf {
        let repo = temp_repo();
        write(&repo, ".praxis/contracts/c.json", &contract("c", &["graphs", "triggers"]));
        // The child is listed before its parent, so the check must grant the parent first.
        bindings(&repo, "c", &["g"], &["child", "root"]);
        write(&repo, ".praxis/grants/root.json", &grant("root", None, "50"));
        write(&repo, ".praxis/grants/child.json", &grant("child", Some("root"), "5"));
        write(&repo, ".praxis/graphs/g.json", &graph("g"));
        write(&repo, ".praxis/triggers/t.json", &trigger("t", "c", "4000"));
        repo
    }

    #[test]
    fn a_contract_whose_records_all_fit_has_no_issues_and_lists_what_it_binds() {
        let check = all(&sound_project());
        assert_eq!(check.contracts.len(), 1);
        let c = only(&check, "c");
        assert_eq!(found(c), vec![]);
        assert!(!c.missing);
        assert_eq!(c.graphs, vec!["g"]);
        assert_eq!(c.grants, vec!["child", "root"]);
        assert_eq!(c.triggers, vec!["t"]);
        assert!(check.unchecked.is_empty());
    }

    #[test]
    fn missing_features_are_reported_on_the_contract_and_on_each_record_they_stop() {
        let repo = sound_project();
        write(&repo, ".praxis/contracts/c.json", &contract("c", &[]));
        let check = all(&repo);
        assert_eq!(
            found(only(&check, "c")),
            vec![
                ("contracts/c".to_string(), "/features", "UNSUPPORTED_FEATURE"),
                ("contracts/c".to_string(), "/features", "UNSUPPORTED_FEATURE"),
                ("graphs/g".to_string(), "", "UNSUPPORTED_FEATURE"),
                ("triggers/t".to_string(), "", "UNSUPPORTED_FEATURE"),
            ]
        );
        let c = only(&check, "c");
        assert!(c.issues[2].diagnostic.message.contains("Contract c's features don't include graphs"), "{:?}", c.issues[2]);
    }

    #[test]
    fn a_trigger_that_expires_after_the_contract_deadline_is_located_on_its_expiry() {
        let repo = sound_project();
        write(&repo, ".praxis/triggers/t.json", &trigger("t", "c", "6000"));
        let check = all(&repo);
        let c = only(&check, "c");
        assert_eq!(found(c), vec![("triggers/t".to_string(), "/expiresAt", "TRIGGER_CONTRACT")]);
        assert_eq!(c.issues[0].diagnostic.message, "The trigger expires after contract c's deadline.");
        assert_eq!(c.issues[0].contract, "c");
    }

    #[test]
    fn bindings_and_parents_that_name_no_record_are_reported() {
        let repo = sound_project();
        bindings(&repo, "c", &["g", "gone"], &["child", "lost", "orphan", "root"]);
        write(&repo, ".praxis/grants/orphan.json", &grant("orphan", Some("nobody"), "5"));
        let check = all(&repo);
        assert_eq!(
            found(only(&check, "c")),
            vec![
                ("contracts/c".to_string(), "/bindings/grants/1", "NOT_FOUND"),
                ("grants/orphan".to_string(), "/parentId", "NOT_FOUND"),
                ("contracts/c".to_string(), "/bindings/graphs/1", "NOT_FOUND"),
            ]
        );
        let c = only(&check, "c");
        assert_eq!(c.issues[0].diagnostic.message, "No grant has the id lost.");
        assert_eq!(c.issues[1].diagnostic.message, "No grant has the id nobody.");
        assert_eq!(c.issues[2].diagnostic.message, "No graph has the id gone.");
    }

    #[test]
    fn a_parent_the_contract_doesn_t_bind_is_named_on_the_child() {
        let repo = sound_project();
        bindings(&repo, "c", &["g"], &["child"]);
        let c = only(&all(&repo), "c").clone();
        assert_eq!(found(&c), vec![("grants/child".to_string(), "/parentId", "NOT_BOUND")]);
        assert_eq!(c.issues[0].diagnostic.message, "Contract c doesn't bind grant root, so this grant can't be granted under it.");
    }

    #[test]
    fn what_reduce_refuses_of_a_grant_is_located_on_its_fields() {
        let repo = sound_project();
        write(&repo, ".praxis/grants/root.json", &grant("root", None, "500"));
        let c = only(&all(&repo), "c").clone();
        // The root's limit is over the budget, so it isn't granted, and its child's parent isn't on the mission.
        assert_eq!(
            found(&c),
            vec![("grants/root".to_string(), "/limit", "AUTHORITY_DENIED"), ("grants/child".to_string(), "/parentId", "NOT_FOUND")]
        );
    }

    #[test]
    fn a_graph_praxis_refuses_is_reported_with_the_sdk_s_code() {
        let repo = sound_project();
        let mut g = graph("g");
        g["nodes"] = json!([{"id": "a", "kind": "TASK", "dependsOn": [], "config": {"executionKind": "AGENT"}}]);
        write(&repo, ".praxis/graphs/g.json", &g);
        assert_eq!(found(only(&all(&repo), "c")), vec![("graphs/g".to_string(), "", "MISSING_END")]);
    }

    #[test]
    fn a_contract_praxis_refuses_still_has_its_references_and_trigger_deadlines_checked() {
        let repo = sound_project();
        let mut c = contract("c", &["graphs", "triggers"]);
        c["criteria"] = json!([]);
        write(&repo, ".praxis/contracts/c.json", &c);
        assert_eq!(found(only(&all(&repo), "c")), vec![("contracts/c".to_string(), "", "INVALID_CONTRACT")]);

        // No mission opens, but what doesn't need one is still said.
        bindings(&repo, "c", &["g", "gone"], &["child", "root", "orphan"]);
        write(&repo, ".praxis/grants/orphan.json", &grant("orphan", Some("nobody"), "5"));
        write(&repo, ".praxis/triggers/t.json", &trigger("t", "c", "6000"));
        assert_eq!(
            found(only(&all(&repo), "c")),
            vec![
                ("contracts/c".to_string(), "", "INVALID_CONTRACT"),
                ("grants/orphan".to_string(), "/parentId", "NOT_FOUND"),
                ("contracts/c".to_string(), "/bindings/graphs/1", "NOT_FOUND"),
                ("triggers/t".to_string(), "/expiresAt", "TRIGGER_CONTRACT"),
            ]
        );
    }

    #[test]
    fn a_trigger_past_the_deadline_is_reported_even_when_the_feature_is_missing_too() {
        let repo = sound_project();
        write(&repo, ".praxis/contracts/c.json", &contract("c", &["graphs"]));
        write(&repo, ".praxis/triggers/t.json", &trigger("t", "c", "6000"));
        assert_eq!(
            found(only(&all(&repo), "c")),
            vec![
                ("contracts/c".to_string(), "/features", "UNSUPPORTED_FEATURE"),
                ("triggers/t".to_string(), "/expiresAt", "TRIGGER_CONTRACT"),
                ("triggers/t".to_string(), "", "UNSUPPORTED_FEATURE"),
            ]
        );
    }

    #[test]
    fn a_parent_that_can_t_be_read_is_said_so_not_called_unbound() {
        let repo = sound_project();
        bindings(&repo, "c", &["g"], &["child"]);
        std::fs::write(repo.join(".praxis/grants/root.json"), "{nope").unwrap();
        let c = only(&all(&repo), "c").clone();
        assert_eq!(found(&c), vec![("grants/child".to_string(), "/parentId", "UNREADABLE")]);
        assert!(c.issues[0].diagnostic.message.starts_with("Grant root can't be read: Not valid JSON"), "{:?}", c.issues[0]);
    }

    #[test]
    fn a_trigger_naming_a_missing_contract_is_reported_on_its_contract_id() {
        let repo = sound_project();
        write(&repo, ".praxis/triggers/stray.json", &trigger("stray", "nowhere", "4000"));
        let check = all(&repo);
        let nowhere = only(&check, "nowhere");
        assert!(nowhere.missing);
        assert_eq!(nowhere.triggers, vec!["stray"]);
        assert_eq!(found(nowhere), vec![("triggers/stray".to_string(), "/contractId", "NOT_FOUND")]);
        assert_eq!(nowhere.issues[0].diagnostic.message, "No contract has the id nowhere.");
    }

    #[test]
    fn a_record_checks_only_the_contracts_it_affects_and_those_asked_for() {
        let repo = sound_project();
        write(&repo, ".praxis/contracts/d.json", &contract("d", &["graphs"]));
        bindings(&repo, "d", &[], &[]);
        write(&repo, ".praxis/contracts/e.json", &contract("e", &["graphs"]));
        bindings(&repo, "e", &["g"], &[]);
        let ids = |record: RecordRef, also: &[&str]| {
            let also: Vec<String> = also.iter().map(|s| s.to_string()).collect();
            check_context(&repo, Some(&record), &also).unwrap().contracts.into_iter().map(|c| c.id).collect::<Vec<_>>()
        };
        let at = |kind, id: &str| RecordRef { kind, id: id.to_string() };
        assert_eq!(ids(at(PraxisKind::Graphs, "g"), &[]), vec!["c", "e"]);
        assert_eq!(ids(at(PraxisKind::Grants, "root"), &[]), vec!["c"]);
        assert_eq!(ids(at(PraxisKind::Triggers, "t"), &[]), vec!["c"]);
        assert_eq!(ids(at(PraxisKind::Contracts, "d"), &[]), vec!["d"]);
        assert_eq!(ids(at(PraxisKind::Triggers, "t"), &["d", "../bad"]), vec!["c", "d"]);
        assert_eq!(ids(at(PraxisKind::Graphs, "unbound"), &[]), Vec::<String>::new());
        assert_eq!(all(&repo).contracts.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), vec!["c", "d", "e"]);
    }

    #[test]
    fn unreadable_bindings_and_triggers_are_named_as_unchecked() {
        let repo = sound_project();
        std::fs::write(repo.join(".praxis/bindings/broken.json"), "{nope").unwrap();
        std::fs::write(repo.join(".praxis/triggers/broken.json"), "{nope").unwrap();
        let check = all(&repo);
        assert_eq!(check.unchecked.len(), 2, "{:?}", check.unchecked);
        assert!(check.unchecked[0].starts_with(".praxis/bindings/broken.json"));
        assert!(check.unchecked[1].starts_with(".praxis/triggers/broken.json"));
    }

    #[test]
    fn an_unreadable_contract_says_why_and_opens_no_mission() {
        let repo = sound_project();
        std::fs::write(repo.join(".praxis/contracts/c.json"), "{nope").unwrap();
        let check = all(&repo);
        let c = only(&check, "c");
        assert!(c.problem.as_deref().unwrap().starts_with("Not valid JSON"), "{:?}", c.problem);
        assert!(c.issues.is_empty());
    }
}
