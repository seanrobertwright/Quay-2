//! Checks workflow templates (#224) against the SDK's `PROVISIONAL` coding-plan schema,
//! vendored from `spec/engine-v1` at the pinned commit. A template is the schema's
//! `$defs/Template`: a coding plan without `workOrderId` and `runId`.
//!
//! This is a shape check only. The cross-field rules, warnings, readiness and agent
//! selectability come from the host's authoring preview, which Quay doesn't call yet, so
//! nothing here claims more than the schema says. Each schema error becomes one diagnostic,
//! coded the way the SDK's fixture vectors record it: `UNKNOWN_FIELD` for a field the
//! template doesn't have, `UNSUPPORTED_FEATURE` for a field it refuses, `INVALID_FIELD` for
//! the rest, and `INVALID_DOCUMENT` when the template isn't an object.

use std::sync::OnceLock;

use jsonschema::error::ValidationErrorKind;
use serde_json::{json, Value};

use super::validate::{Diagnostic, Omitted, Severity, Validation, MAX_DIAGNOSTICS};

/// The vendored coding-plan schema.
fn schema() -> &'static Value {
    static SCHEMA: OnceLock<Value> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        serde_json::from_str(include_str!("../../../vendor/aiws/spec/engine-v1/coding-plan.schema.json"))
            .expect("the vendored coding-plan schema is JSON")
    })
}

/// The schema with its root pointed at the `$defs` entry `name`.
fn validator(name: &str) -> &'static jsonschema::Validator {
    static PLAN: OnceLock<jsonschema::Validator> = OnceLock::new();
    static TEMPLATE: OnceLock<jsonschema::Validator> = OnceLock::new();
    let cell = match name {
        "Plan" => &PLAN,
        "Template" => &TEMPLATE,
        _ => panic!("the coding-plan schema has no {name} the builder checks"),
    };
    cell.get_or_init(|| {
        let mut schema = schema().clone();
        schema["$ref"] = json!(format!("#/$defs/{name}"));
        jsonschema::validator_for(&schema).expect("the vendored coding-plan schema compiles")
    })
}

/// A template's keys in the schema's property order, which the canonical file follows.
pub fn template_keys() -> &'static [&'static str] {
    static KEYS: OnceLock<Vec<&'static str>> = OnceLock::new();
    KEYS.get_or_init(|| {
        schema()["$defs"]["Template"]["properties"]
            .as_object()
            .expect("the coding-plan schema lists the template's properties")
            .keys()
            .map(String::as_str)
            .collect()
    })
}

/// Whether the schema refuses `field` whatever its value, as `UNSUPPORTED_FEATURE`.
fn is_refused(def: &str, field: &str) -> bool {
    schema()["$defs"][def]["properties"][field]["$ref"] == "#/$defs/UnsupportedFeature"
}

/// Validates a workflow template's shape. The verdict is the first issue's code.
pub fn validate_template(template: &Value) -> Validation {
    check(template, "Template")
}

fn check(document: &Value, def: &str) -> Validation {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let mut omitted = Omitted::default();
    let mut push = |code: &str, path: String, message: String| {
        if diagnostics.iter().any(|d| d.code == code && d.path == path && d.message == message) {
            return;
        }
        if diagnostics.len() < MAX_DIAGNOSTICS {
            diagnostics.push(issue(code, path, message));
        } else {
            omitted.errors += 1;
        }
    };
    for error in validator(def).iter_errors(document) {
        let path = error.instance_path.as_str().to_string();
        let field = path.split('/').nth(1).map(unescape);
        match (&error.kind, field) {
            (ValidationErrorKind::Type { .. }, None) => {
                push("INVALID_DOCUMENT", String::new(), "A workflow template must be a JSON object.".to_string())
            }
            (ValidationErrorKind::AdditionalProperties { unexpected }, None) => {
                for key in unexpected {
                    push("UNKNOWN_FIELD", format!("/{}", escape(key)), unknown_message(key));
                }
            }
            (ValidationErrorKind::Required { property }, None) => {
                let key = property.as_str().unwrap_or_default();
                push("INVALID_FIELD", format!("/{}", escape(key)), required_message(key));
            }
            (_, Some(field)) if is_refused(def, &field) => {
                push("UNSUPPORTED_FEATURE", format!("/{}", escape(&field)), refused_message(&field))
            }
            (kind, Some(field)) => {
                let message = field_message(&field, &path, kind).unwrap_or_else(|| error.to_string());
                push("INVALID_FIELD", path, message)
            }
            (_, None) => push("INVALID_DOCUMENT", String::new(), error.to_string()),
        }
    }
    let verdict = diagnostics.first().map(|d| d.code.clone());
    Validation { verdict, diagnostics, omitted }
}

fn issue(code: &str, path: String, message: String) -> Diagnostic {
    Diagnostic { code: code.to_string(), severity: Severity::Error, message, path, node_id: None, field: None }
}

fn escape(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

fn unescape(segment: &str) -> String {
    segment.replace("~1", "/").replace("~0", "~")
}

fn unknown_message(key: &str) -> String {
    match key {
        "workOrderId" | "runId" => format!("A template doesn't carry {key}: each run supplies its own."),
        _ => format!("A workflow template has no field '{key}'."),
    }
}

fn required_message(key: &str) -> String {
    match key {
        "maxTotalCost" => "A bounded exposure needs a max total cost.".to_string(),
        "implementation" | "validation" | "correction" => "This command isn't set.".to_string(),
        _ => "This isn't set.".to_string(),
    }
}

fn refused_message(field: &str) -> String {
    format!(
        "A coding plan has the fixed coding profile, so it can't have '{field}'. Work that needs it is a finite-v1 graph."
    )
}

/// A plainer message than the schema's for a field of the template, when there is one.
fn field_message(field: &str, path: &str, kind: &ValidationErrorKind) -> Option<String> {
    use ValidationErrorKind as K;
    let item = path.split('/').count() > 2;
    let text = match (field, kind) {
        ("description" | "criteriaRef", K::Pattern { .. }) => "This is empty.",
        ("description" | "criteriaRef", K::MaxLength { .. }) => "Use at most 4096 characters.",
        ("implementation" | "validation" | "correction", K::Type { .. }) if !item => {
            "A command is a list of arguments, not one command line. Quay never splits a command line."
        }
        ("implementation" | "validation" | "correction", K::MinItems { .. }) => "Add the executable.",
        ("implementation" | "validation" | "correction", K::MaxItems { .. }) => "A command has at most 256 arguments.",
        ("implementation" | "validation" | "correction", K::MinLength { .. }) => "The executable is empty.",
        ("implementation" | "validation" | "correction", K::Type { .. }) => "An argument must be text.",
        ("implementation" | "validation" | "correction", K::Not { .. }) => "An argument can't hold a NUL character.",
        ("outputPaths", K::MinItems { .. }) => "List at least one output path.",
        ("outputPaths", K::MaxItems { .. }) => "List at most 256 output paths.",
        ("outputPaths", K::UniqueItems) => "Each output path is listed once.",
        ("outputPaths", K::Pattern { .. }) => {
            "Use a relative path with forward slashes, with no '.' or '..' segment, drive letter, backslash or empty segment."
        }
        ("maxCorrections", _) => "A whole number of 0 or more.",
        ("maxAttempts", _) => "At least 2: one implementation and one validation.",
        ("maxTaskMs", K::Minimum { .. }) | ("maxTotalActiveMs", K::Minimum { .. }) => "At least 1 second.",
        ("maxTaskMs", K::Maximum { .. }) => "At most 2147423647 ms, about 24.8 days.",
        ("maxTotalActiveMs", K::Maximum { .. }) => "At most 9007199254740991 ms.",
        ("maxTaskMs" | "maxTotalActiveMs", K::Type { .. }) => "A whole number of milliseconds, of at most 9007199254740991.",
        ("exposure", K::OneOfNotValid { .. }) => {
            "Bounded needs an allowance and a stop threshold of 1 or more; Not applicable needs a justification."
        }
        ("maxTotalCost", K::FalseSchema) => "Only a bounded exposure has a max total cost.",
        ("maxTotalCost", K::Pattern { .. }) => "A whole number of 0 or more in digits, with no leading zero and at most 30 digits.",
        ("agent", K::Pattern { .. } | K::MaxLength { .. }) => {
            "An agent id has at most 256 characters, no control characters and no space at either end."
        }
        _ => return None,
    };
    Some(text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The diagnostics as the fixture vectors record them: `CODE field`, sorted and distinct.
    fn recorded(v: &Validation) -> Vec<String> {
        let mut out: Vec<String> = v
            .diagnostics
            .iter()
            .map(|d| {
                let field = d.path.split('/').nth(1).map(unescape).unwrap_or_else(|| "$".to_string());
                format!("{} {}", d.code, field)
            })
            .collect();
        out.sort();
        out.dedup();
        out
    }

    #[test]
    fn every_coding_plan_vector_gets_its_recorded_diagnostics() {
        let fixtures: Value =
            serde_json::from_str(include_str!("../../../vendor/aiws/spec/engine-v1/coding-plan.fixtures.json")).unwrap();
        assert_eq!(fixtures["schema"], schema()["$id"]);
        let cases = fixtures["cases"].as_array().unwrap();
        assert!(cases.iter().any(|c| c["kind"] == "Template"));
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let v = check(&case["document"], case["kind"].as_str().unwrap());
            let mut expected: Vec<String> =
                case["diagnostics"].as_array().unwrap().iter().map(|d| d.as_str().unwrap().to_string()).collect();
            expected.sort();
            assert_eq!(recorded(&v), expected, "{name}");
            assert_eq!(v.verdict.is_none(), case["valid"] == true, "{name}");
        }
    }

    #[test]
    fn a_new_template_is_flagged_until_its_fields_are_filled() {
        let new = json!({
            "description": "", "implementation": [], "validation": [], "correction": [], "outputPaths": [],
            "criteriaRef": "", "maxCorrections": 0, "reapproveCorrections": true, "maxAttempts": 2
        });
        let v = validate_template(&new);
        let paths: Vec<&str> = v.diagnostics.iter().map(|d| d.path.as_str()).collect();
        for path in ["/description", "/implementation", "/outputPaths", "/criteriaRef", "/maxTaskMs", "/maxTotalActiveMs"] {
            assert!(paths.contains(&path), "{path} in {paths:?}");
        }
        assert!(!paths.contains(&"/maxCorrections"));
    }

    #[test]
    fn an_issue_inside_a_command_points_at_its_argument() {
        let mut t = json!({
            "description": "d", "implementation": ["", "x"], "validation": ["v"], "correction": ["c"],
            "outputPaths": ["a"], "criteriaRef": "r", "maxCorrections": 0, "reapproveCorrections": true,
            "maxAttempts": 2, "maxTaskMs": 1000, "maxTotalActiveMs": 1000
        });
        let v = validate_template(&t);
        assert_eq!(v.diagnostics.len(), 1);
        assert_eq!(v.diagnostics[0].path, "/implementation/0");
        assert_eq!(v.diagnostics[0].message, "The executable is empty.");
        t["implementation"] = json!("node build.js");
        assert!(validate_template(&t).diagnostics[0].message.contains("never splits"));
        t["implementation"] = json!(["x"]);
        t["maxTotalActiveMs"] = json!("9007199254740993");
        assert_eq!(validate_template(&t).diagnostics[0].message, "A whole number of milliseconds, of at most 9007199254740991.");
    }

    #[test]
    fn a_refused_field_is_unsupported_and_a_stray_one_unknown() {
        let v = validate_template(&json!({"steps": [], "id": "t"}));
        let by_path = |p: &str| v.diagnostics.iter().find(|d| d.path == p).map(|d| d.code.as_str());
        assert_eq!(by_path("/steps"), Some("UNSUPPORTED_FEATURE"));
        assert_eq!(by_path("/id"), Some("UNKNOWN_FIELD"));
        assert_eq!(validate_template(&json!([1])).verdict.as_deref(), Some("INVALID_DOCUMENT"));
    }

    #[test]
    fn the_keys_follow_the_schema_without_identities() {
        let keys = template_keys();
        assert_eq!(keys[0], "description");
        assert!(keys.contains(&"maxTotalCost") && !keys.contains(&"runId"));
    }
}
