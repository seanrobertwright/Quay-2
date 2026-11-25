//! What the record keeps of the operator's answer: what they picked of what the agent wrote, and nothing
//! they typed.

use serde::Serialize;
use serde_json::Value;

use super::super::plain_line::plain_line;
use super::super::{ask, raw, review};
use super::MOST_NAMED;

/// A review's verdicts.
const VERDICTS: [&str; 3] = ["approved", "changes_requested", "rejected"];

/// What was picked. What an answer does not have, or has otherwise than Quay makes it, is left out.
#[derive(Debug, Default, Serialize)]
pub struct Given {
    /// Of a raw surface: the name of its action.
    #[serde(skip_serializing_if = "Option::is_none")]
    action: Option<String>,
    /// Of a review.
    #[serde(skip_serializing_if = "Option::is_none")]
    verdict: Option<&'static str>,
    /// Of an ask: for each question, in order, the labels of its chosen options.
    #[serde(skip_serializing_if = "Option::is_none")]
    chosen: Option<Vec<Vec<String>>>,
}

impl Given {
    /// Of `answer` to a surface of `tool`, whose call had `arguments`.
    pub fn of(tool: &str, arguments: &Value, answer: &Value) -> Self {
        let mut given = Self::default();
        match tool {
            ask::TOOL => given.chosen = Some(chosen(arguments, answer)),
            review::TOOL => {
                given.verdict = VERDICTS.into_iter().find(|verdict| answer["verdict"] == *verdict);
            }
            // An action's name is never bound to what the operator puts in
            raw::TOOL => given.action = answer["action"]["name"].as_str().map(|name| plain_line(name, MOST_NAMED)),
            _ => {}
        }
        given
    }
}

/// For each question of an ask, the labels of its options that `answer` chose.
fn chosen(arguments: &Value, answer: &Value) -> Vec<Vec<String>> {
    let questions = arguments["questions"].as_array().map_or(&[][..], Vec::as_slice);
    let of_question = |(i, question): (usize, &Value)| {
        let chosen = answer["answers"][i]["chosen"].as_array().map_or(&[][..], Vec::as_slice);
        let labels = question["options"].as_array().map_or(&[][..], Vec::as_slice);
        let is_label = |chosen: &&str| labels.iter().any(|option| option["label"] == **chosen);
        let chosen = chosen.iter().filter_map(Value::as_str).filter(is_label);
        chosen.map(|label| plain_line(label, MOST_NAMED)).collect()
    };
    questions.iter().enumerate().map(of_question).collect()
}
