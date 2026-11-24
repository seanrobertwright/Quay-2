//! `quay_ask`: what its call may hold.

use std::collections::HashMap;
use std::ops::RangeInclusive;

use serde::Serialize;
use serde_json::Value;

use super::arguments::Arguments;
use super::place::Place;
use super::rejection::Rejection;

pub const TOOL: &str = "quay_ask";
pub const PLACE: Place = Place::Companion;

/// What its surfaces are named by: `ask_1` and on.
pub const NAMED: &str = "ask";

pub(super) const CONTEXT_LIMIT: usize = 600;
pub(super) const QUESTION_COUNT: RangeInclusive<usize> = 1..=4;
pub(super) const QUESTION_LIMIT: usize = 200;
pub(super) const LABEL_LIMIT: usize = 60;
pub(super) const DESCRIPTION_LIMIT: usize = 120;
pub(super) const OPTION_COUNT: RangeInclusive<usize> = 2..=6;

/// A checked `quay_ask` call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Ask {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    pub questions: Vec<Question>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Question {
    pub question: String,
    /// None for a free-text question.
    pub options: Vec<AskOption>,
    /// Whether more than one option may be chosen. It means nothing to a free-text question.
    pub multiple: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AskOption {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub recommended: bool,
}

impl Ask {
    /// The call `arguments` hold, or everything wrong with them.
    pub fn parse(arguments: &Value) -> Result<Self, Rejection> {
        let mut args = Arguments::new(TOOL, "tab");
        let ask = Self::read(&mut args, arguments);
        args.finish(ask)
    }

    fn read(args: &mut Arguments, arguments: &Value) -> Self {
        let mut ask = Self { context: None, questions: Vec::new() };
        let Some(call) = args.object(arguments, "", "A call", &["context", "questions"]) else {
            return ask;
        };
        ask.context = args.optional_text(&call, "context", "The context", CONTEXT_LIMIT);
        let Some(questions) = call.get("questions").and_then(Value::as_array) else {
            args.invalid("/questions", "quay_ask needs a list of questions.");
            return ask;
        };
        args.count(questions, QUESTION_COUNT, "/questions", "A call takes", "questions");
        for (i, value) in questions.iter().enumerate() {
            ask.questions.extend(Question::read(args, value, &format!("/questions/{i}")));
        }
        ask
    }
}

impl Question {
    fn read(args: &mut Arguments, value: &Value, path: &str) -> Option<Self> {
        let fields = args.object(value, path, "A question", &["question", "options", "multiple"])?;
        let question = args.text(&fields, "question", "A question", QUESTION_LIMIT);
        let options = match fields.get("options") {
            None => Vec::new(),
            Some(options) => AskOption::read_list(args, options, &fields.path("options")),
        };
        let multiple = args.flag(&fields, "multiple");
        Some(Self { question, options, multiple })
    }
}

impl AskOption {
    fn read_list(args: &mut Arguments, value: &Value, path: &str) -> Vec<Self> {
        let Some(values) = value.as_array() else {
            args.invalid(path, "A question's options are a list.");
            return Vec::new();
        };
        args.count(values, OPTION_COUNT, path, "A question has", "options");
        let mut options = Vec::with_capacity(values.len());
        // Where each label was first
        let mut first_at: HashMap<String, usize> = HashMap::new();
        let mut recommended = false;
        for (i, value) in values.iter().enumerate() {
            let path = format!("{path}/{i}");
            let Some(option) = Self::read(args, value, &path) else {
                continue;
            };
            // A label that is missing is an error of its own
            if !option.label.is_empty() {
                let first = *first_at.entry(option.label.clone()).or_insert(i);
                if first != i {
                    let message = format!(
                        "Two options in one question cannot share a label. \"{}\" is also option {}.",
                        option.label,
                        first + 1
                    );
                    args.invalid(format!("{path}/label"), message);
                }
            }
            if option.recommended && recommended {
                args.invalid(format!("{path}/recommended"), "A question has at most one recommended option.");
            }
            recommended |= option.recommended;
            options.push(option);
        }
        options
    }

    fn read(args: &mut Arguments, value: &Value, path: &str) -> Option<Self> {
        let fields = args.object(value, path, "An option", &["label", "description", "recommended"])?;
        Some(Self {
            label: args.text(&fields, "label", "An option label", LABEL_LIMIT),
            description: args.optional_text(&fields, "description", "An option description", DESCRIPTION_LIMIT),
            recommended: args.flag(&fields, "recommended"),
        })
    }
}
