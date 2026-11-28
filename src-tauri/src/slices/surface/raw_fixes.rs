//! How to fix the mistakes agents make most often in a `quay_surface` call, told from the errors found in it.
//! The engine's words this reads are held by the webview's contract tests.

use super::rejection::CallError;

const NO_ROOT: &str = "Give one component of the surface the id `root`.";

const NESTED: &str =
    "Name each child by its id in `children` or `child`, and write the child as a component of its own in `components`.";

const NOT_IN_CATALOG: &str = "Set `component` to one of the components of Quay's catalog that the error lists.";

const NOT_A_NAME: &str = "Write `component` as the component's name, such as `\"Column\"`, with its properties beside it.";

const NOT_ON_ITS_LINE: &str =
    "Give each component only the properties on its line in quay_surface_guide, each of the type the line gives: where it says string, 3 is \"3\".";

const NO_VERSION: &str = "Give each message `\"version\": \"1.0\"`.";

const BARE_CHECKS: &str = "Write `checks` as `@checks`, with the @.";

const BARE_ACCESSIBILITY: &str = "Write `accessibility` as `@accessibility`, with the @.";

/// The fix for each of `errors` that is of a mistake made often, each once, in the order they are first found.
pub fn fixes(errors: &[CallError]) -> Vec<&'static str> {
    let mut fixes = Vec::new();
    for fix in errors.iter().filter_map(fix) {
        if !fixes.contains(&fix) {
            fixes.push(fix);
        }
    }
    fixes
}

/// The fix for `error`, when it is of a mistake made often.
fn fix(error: &CallError) -> Option<&'static str> {
    if error.code == "INTEGRITY_ERROR" && error.message.starts_with("Missing root component") {
        return Some(NO_ROOT);
    }
    if error.code != "VALIDATION_FAILED" {
        return None;
    }
    if is_version(&error.path) {
        return Some(NO_VERSION);
    }
    match in_component(&error.path)?.as_slice() {
        ["children"] | ["child"] => Some(NESTED),
        ["children", child] if is_index(child) => Some(NESTED),
        ["component"] if error.message.ends_with("component: Expected string, received object") => Some(NOT_A_NAME),
        ["component"] => Some(NOT_IN_CATALOG),
        ["checks"] => Some(BARE_CHECKS),
        ["accessibility"] => Some(BARE_ACCESSIBILITY),
        _ if error.message.starts_with("Validation failed for component") => Some(NOT_ON_ITS_LINE),
        _ => None,
    }
}

/// The steps of `path` after the component it is in, when it is in a component of a message.
fn in_component(path: &str) -> Option<Vec<&str>> {
    let steps: Vec<&str> = path.split('/').collect();
    match steps.as_slice() {
        ["", "messages", message, "createSurface" | "updateComponents", "components", component, rest @ ..]
            if is_index(message) && is_index(component) =>
        {
            Some(rest.to_vec())
        }
        _ => None,
    }
}

/// Whether `path` is to the version of a message.
fn is_version(path: &str) -> bool {
    matches!(path.split('/').collect::<Vec<_>>().as_slice(), ["", "messages", message, "version"] if is_index(message))
}

fn is_index(step: &str) -> bool {
    !step.is_empty() && step.bytes().all(|byte| byte.is_ascii_digit())
}
