//! A graph trigger as `praxis triggers check` and `submit` take it (#469, #474): its name, the
//! graph workflow its saved target file names, and the path of its saved trigger file, which
//! `praxis` reads itself. Only a saved trigger with a saved Starts target goes, so an unsaved draft
//! never does, and the caller never names the target: it is always the one the target file holds.
//! The same files give the digest the host reports on each of the trigger's revisions (#475), so
//! the builder can tell when they differ from the admitted one.

use std::path::Path;

use serde_json::{json, Value};

use super::bundle::read_strict;

use crate::slices::praxis::models::PraxisKind;
use crate::slices::praxis::store::{definition_path, display_path, read_record, shown_path, target_graph_workflow, TRIGGER_TARGETS_DIR};
use crate::slices::praxis::template_name::{check_graph_workflow_name, check_trigger_name};
use crate::slices::praxis::trigger_target::check_trigger_target;
use crate::slices::praxis::validate::Severity;

/// The operands of `praxis triggers check` and `submit` for the graph trigger `name` saved in
/// `repo`: its name, then `--workflow` with the graph workflow its target file names, then
/// `--trigger` with the path of its file. Refused, naming the cause, when the name breaks the
/// host's rule, the trigger isn't saved, it has no saved target file naming a graph workflow, that
/// name breaks the host's rule, or the saved files break any rule the trigger form checks
/// ([`check_trigger_target`]), which the first such error states.
pub fn trigger_operands(repo: &Path, name: &str) -> Result<Vec<String>, String> {
    check_trigger_name(name)?;
    let folder = PraxisKind::Triggers.folder();
    let trigger = read_record(repo, folder, name)
        .map_err(|why| format!("Trigger {name} can't be read: {why}"))?
        .ok_or_else(|| format!("{} doesn't exist.", shown_path(folder, name)))?;
    let target = read_record(repo, TRIGGER_TARGETS_DIR, name).map_err(|why| format!("Trigger {name}'s target file can't be read: {why}"))?;
    let workflow = target.as_ref().and_then(|t| t.get("graphWorkflow")).and_then(Value::as_str).filter(|w| !w.is_empty());
    let Some(workflow) = workflow else {
        return Err(format!("Trigger {name} has no Starts target, so it stays a local record and can't go to the host."));
    };
    check_graph_workflow_name(workflow)?;
    let checked = check_trigger_target(repo, &trigger, Some(workflow))?;
    if let Some(error) = checked.diagnostics.iter().find(|d| d.severity == Severity::Error) {
        return Err(format!("Trigger {name} isn't valid: {}", error.message));
    }
    Ok(vec![
        name.to_string(),
        "--workflow".into(),
        workflow.to_string(),
        "--trigger".into(),
        display_path(&definition_path(repo, PraxisKind::Triggers, name)?)?,
    ])
}

/// The digest the host gives revision `revision` of the graph trigger `name` saved in `repo`, had
/// that revision been submitted from the saved files (AI-WS-SDK `engine/src/graph-triggers.ts`,
/// `graphTriggerDigest`): the SDK `digest` of `{purpose, workflow, trigger}`, where `workflow` is
/// the graph workflow its saved target file names and `trigger` the record its saved file holds
/// with `revision` set to the revision in decimal, as the host stores it. Each revision of the
/// same files so has its own digest. `None` when the name breaks the host's rule, the trigger has
/// no saved file or no saved target, or its file can't be read, is larger than the builder reads,
/// isn't strict JSON or holds no record: Quay then can't tell whether a revision has these files.
pub fn trigger_digest(repo: &Path, name: &str, revision: u32) -> Option<String> {
    check_trigger_name(name).ok()?;
    let workflow = target_graph_workflow(repo, name)?;
    let mut trigger = read_strict(&definition_path(repo, PraxisKind::Triggers, name).ok()?)?;
    trigger.as_object_mut()?.insert("revision".into(), Value::String(revision.to_string()));
    aiws_sdk::digest(&json!({ "purpose": "aiws-graph-trigger/1", "workflow": workflow, "trigger": trigger })).ok()
}
