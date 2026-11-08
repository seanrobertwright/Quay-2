//! The Praxis host's workflow template name rule (#362, #363): `^[a-z][a-z0-9-]{0,62}$`, and
//! not a Windows reserved device name. It is the read-models schema's `$defs/TemplateName` at
//! the SDK pin, and it is narrower than #222's filename-safe ids, so only `templates/` ids
//! follow it (#224), and `graph-workflows/` ids, which are host names too (#444). New and
//! renamed templates and graph workflows must follow it, the list flags a file whose name
//! breaks it, and the runner refuses to give `praxis` such a template name.
//!
//! A graph trigger name follows the same rule with the name `check` refused too, as AI-WS-SDK
//! `spec/engine-v1/GRAPH-WORKFLOWS.md`, "Names", states it, since the host's check endpoint holds
//! that path segment. It binds only a trigger with a Starts target (#473), the only trigger the
//! host will see.

/// The longest name the rule allows.
pub const MAX_TEMPLATE_NAME_LEN: usize = 63;

/// The rule as a refusal states it, for a name of the kind `$noun` names.
macro_rules! name_rule {
    ($noun:literal) => {
        concat!(
            "A ",
            $noun,
            " name is a lowercase letter, then at most 62 lowercase letters, digits and hyphens, \
             and isn't a Windows device name such as con, nul, com1 or lpt1. \
             The Praxis host refuses any other name."
        )
    };
}

/// The rule, as every refusal of a workflow template name states it.
pub const TEMPLATE_NAME_RULE: &str = name_rule!("workflow template");

/// The rule as a refusal of a graph workflow name states it. A graph workflow's file name is
/// its name on the host too, and follows the same rule as a template's (#444).
pub const GRAPH_WORKFLOW_NAME_RULE: &str = name_rule!("graph workflow");

/// The rule as a refusal of a graph trigger name states it (#473). It names `check` as well.
pub const TRIGGER_NAME_RULE: &str = concat!(
    "A graph trigger name is a lowercase letter, then at most 62 lowercase letters, digits and hyphens, ",
    "and isn't check or a Windows device name such as con, nul, com1 or lpt1. ",
    "The Praxis host refuses any other name."
);

/// The Windows reserved device names the rule refuses, in the lowercase the pattern allows.
const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2",
    "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Whether the host's rule admits `name`.
pub fn is_template_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.first().is_some_and(u8::is_ascii_lowercase)
        && bytes.len() <= MAX_TEMPLATE_NAME_LEN
        && bytes.iter().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
        && !RESERVED.contains(&name)
}

/// Refuses a name the host's rule doesn't admit, with a message stating the rule.
pub fn check_template_name(name: &str) -> Result<(), String> {
    if is_template_name(name) { Ok(()) } else { Err(TEMPLATE_NAME_RULE.to_string()) }
}

/// Refuses a graph trigger name the host's rule doesn't admit, with a message stating the rule.
/// Only a trigger with a Starts target has to pass it.
pub fn check_trigger_name(name: &str) -> Result<(), String> {
    if is_template_name(name) && name != "check" { Ok(()) } else { Err(TRIGGER_NAME_RULE.to_string()) }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;
    use crate::slices::praxis::models::PraxisKind;

    fn vectors() -> Vec<(String, bool)> {
        let file: Value = serde_json::from_str(include_str!("template_names.vectors.json")).unwrap();
        file["cases"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| (c["name"].as_str().unwrap().to_string(), c["valid"].as_bool().unwrap()))
            .collect()
    }

    fn read_models() -> Value {
        serde_json::from_str(include_str!("../../../vendor/aiws/spec/engine-v1/read-models.schema.json")).unwrap()
    }

    /// The vendored schema's `TemplateName`, compiled on its own.
    fn schema_rule() -> jsonschema::Validator {
        let mut schema = read_models();
        schema["$ref"] = json!("#/$defs/TemplateName");
        jsonschema::validator_for(&schema).unwrap()
    }

    #[test]
    fn every_vector_gets_its_recorded_verdict() {
        for (name, valid) in vectors() {
            assert_eq!(is_template_name(&name), valid, "{name:?}");
            assert_eq!(check_template_name(&name).is_ok(), valid, "{name:?}");
        }
    }

    #[test]
    fn a_graph_workflow_name_follows_the_same_vectors_and_its_refusal_names_a_graph_workflow() {
        for (name, valid) in vectors() {
            let why = PraxisKind::GraphWorkflows.name_problem(&name, false);
            assert_eq!(why.is_none(), valid, "{name:?}");
            assert!(why.is_none_or(|why| why == GRAPH_WORKFLOW_NAME_RULE), "{name:?}");
        }
        let file: Value = serde_json::from_str(include_str!("template_names.vectors.json")).unwrap();
        let rule = file["rule"].as_str().unwrap();
        assert_eq!(GRAPH_WORKFLOW_NAME_RULE, rule.replace("A workflow template name", "A graph workflow name"));
    }

    #[test]
    fn the_vectors_agree_with_the_vendored_schema() {
        let schema = schema_rule();
        for (name, valid) in vectors() {
            assert_eq!(schema.is_valid(&json!(name)), valid, "the schema's verdict on {name:?}");
        }
    }

    /// The pin carries no vectors of its own for the rule. Its read-model fixtures do name
    /// templates, and two refused detail records are refused for their names. A catalog entry
    /// is left out: it is listed under whatever name its file gives, even a refused one.
    #[test]
    fn the_names_in_the_read_model_fixtures_get_the_schemas_verdict() {
        let fixtures: Value =
            serde_json::from_str(include_str!("../../../vendor/aiws/spec/engine-v1/read-models.fixtures.json")).unwrap();
        let schema = schema_rule();
        let mut names = Vec::new();
        for case in fixtures["cases"].as_array().unwrap() {
            let record = &case["record"];
            let pointers: &[&str] = match case["def"].as_str().unwrap() {
                "WorkflowTemplateDetail" => &["/name"],
                _ => &["/template", "/template/name"],
            };
            for pointer in pointers {
                if let Some(name) = record.pointer(pointer).and_then(Value::as_str) {
                    names.push(name.to_string());
                }
            }
        }
        for name in ["con", "Review", "review-code"] {
            assert!(names.iter().any(|n| n == name), "{name} in {names:?}");
        }
        for name in names {
            assert_eq!(is_template_name(&name), schema.is_valid(&json!(name)), "{name:?}");
        }
    }

    fn trigger_vectors() -> (String, Vec<(String, bool)>) {
        let file: Value = serde_json::from_str(include_str!("trigger_names.vectors.json")).unwrap();
        let cases = file["cases"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| (c["name"].as_str().unwrap().to_string(), c["valid"].as_bool().unwrap()))
            .collect();
        (file["rule"].as_str().unwrap().to_string(), cases)
    }

    #[test]
    fn a_trigger_name_gets_its_recorded_verdict_and_the_refusal_states_the_rule() {
        let (rule, cases) = trigger_vectors();
        for (name, valid) in cases {
            assert_eq!(check_trigger_name(&name).err(), (!valid).then(|| rule.clone()), "{name:?}");
        }
    }

    /// The SDK gives a graph trigger name the template rule, with `check` refused as well.
    #[test]
    fn a_trigger_name_follows_every_template_vector() {
        for (name, valid) in vectors() {
            assert_eq!(check_trigger_name(&name).is_ok(), valid, "{name:?}");
        }
        assert!(is_template_name("check"));
    }

    #[test]
    fn the_refusal_states_the_rule_the_builder_shows() {
        let why = check_template_name("Review_Code").unwrap_err();
        assert!(why.contains("lowercase letter") && why.contains("62") && why.contains("hyphens"), "{why}");
        let file: Value = serde_json::from_str(include_str!("template_names.vectors.json")).unwrap();
        assert_eq!(file["rule"], why);
    }
}
