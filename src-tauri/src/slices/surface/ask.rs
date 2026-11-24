//! `quay_ask`: what its call may hold.

use std::ops::RangeInclusive;

use serde::Serialize;
use serde_json::{Map, Value};

use super::rejection::Rejection;

pub const TOOL: &str = "quay_ask";

pub(super) const QUESTION_LIMIT: usize = 200;
pub(super) const LABEL_LIMIT: usize = 60;
pub(super) const DESCRIPTION_LIMIT: usize = 120;
pub(super) const OPTION_COUNT: RangeInclusive<usize> = 2..=6;

/// A checked `quay_ask` call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Ask {
    pub questions: Vec<Question>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Question {
    pub question: String,
    pub options: Vec<AskOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AskOption {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub recommended: bool,
}

impl Ask {
    /// The call `arguments` hold, or the first thing wrong with them.
    pub fn parse(arguments: &Value) -> Result<Self, Rejection> {
        let call = object(arguments, "", "A call", &["questions"])?;
        let questions = call
            .get("questions")
            .and_then(Value::as_array)
            .ok_or_else(|| Rejection::invalid("/questions", "quay_ask needs a list of questions."))?;
        if questions.len() != 1 {
            let message = format!("A call takes one question; this one has {}.", questions.len());
            return Err(Rejection::invalid("/questions", message));
        }
        let questions = questions
            .iter()
            .enumerate()
            .map(|(i, question)| Question::parse(question, &format!("/questions/{i}")))
            .collect::<Result<_, _>>()?;
        Ok(Self { questions })
    }
}

impl Question {
    fn parse(value: &Value, path: &str) -> Result<Self, Rejection> {
        let fields = object(value, path, "A question", &["question", "options"])?;
        let question = text(fields, "question", path, "A question", QUESTION_LIMIT)?;
        let path = format!("{path}/options");
        let values = fields
            .get("options")
            .and_then(Value::as_array)
            .ok_or_else(|| Rejection::invalid(path.as_str(), "A question needs a list of options."))?;
        if !OPTION_COUNT.contains(&values.len()) {
            let message = format!("A question has two to six options; this one has {}.", values.len());
            return Err(Rejection::invalid(path, message));
        }
        let mut options: Vec<AskOption> = Vec::with_capacity(values.len());
        for (i, value) in values.iter().enumerate() {
            let path = format!("{path}/{i}");
            let option = AskOption::parse(value, &path)?;
            if let Some(first) = options.iter().position(|earlier| earlier.label == option.label) {
                let message = format!(
                    "Two options in one question cannot share a label. \"{}\" is also option {}.",
                    option.label,
                    first + 1
                );
                return Err(Rejection::invalid(format!("{path}/label"), message));
            }
            if option.recommended && options.iter().any(|earlier| earlier.recommended) {
                let message = "A question has at most one recommended option.";
                return Err(Rejection::invalid(format!("{path}/recommended"), message));
            }
            options.push(option);
        }
        Ok(Self { question, options })
    }
}

impl AskOption {
    fn parse(value: &Value, path: &str) -> Result<Self, Rejection> {
        let fields = object(value, path, "An option", &["label", "description", "recommended"])?;
        let label = text(fields, "label", path, "An option label", LABEL_LIMIT)?;
        let description = match fields.get("description") {
            None => None,
            Some(Value::String(description)) => {
                let path = format!("{path}/description");
                Some(within(description, path, "An option description", DESCRIPTION_LIMIT)?)
            }
            Some(_) => {
                return Err(Rejection::invalid(format!("{path}/description"), "An option description is text."));
            }
        };
        let recommended = match fields.get("recommended") {
            None => false,
            Some(Value::Bool(recommended)) => *recommended,
            Some(_) => {
                return Err(Rejection::invalid(format!("{path}/recommended"), "recommended is true or false."));
            }
        };
        Ok(Self { label, description, recommended })
    }
}

/// `value` as an object with no field outside `fields`.
fn object<'a>(value: &'a Value, path: &str, what: &str, fields: &[&str]) -> Result<&'a Map<String, Value>, Rejection> {
    let map = value.as_object().ok_or_else(|| Rejection::invalid(path, format!("{what} is an object.")))?;
    match map.keys().find(|key| !fields.contains(&key.as_str())) {
        None => Ok(map),
        Some(key) => Err(Rejection::unknown_field(TOOL, path, key)),
    }
}

/// The text in `field`, which may be neither missing nor blank.
fn text(fields: &Map<String, Value>, field: &str, path: &str, what: &str, limit: usize) -> Result<String, Rejection> {
    let path = format!("{path}/{field}");
    match fields.get(field).and_then(Value::as_str).filter(|text| !text.trim().is_empty()) {
        Some(text) => within(text, path, what, limit),
        None => Err(Rejection::invalid(path, format!("{what} needs some text."))),
    }
}

/// `text` when it is at most `limit` characters.
fn within(text: &str, path: String, what: &str, limit: usize) -> Result<String, Rejection> {
    let length = text.chars().count();
    if length > limit {
        let message = format!("{what} is at most {limit} characters; this one is {length}.");
        return Err(Rejection::invalid(path, message));
    }
    Ok(text.to_string())
}
