//! What the record keeps of a function a surface fired: which, and at what.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::super::local_path::percent_decoded;
use super::super::plain_line::plain_line;

/// The most characters of a target: as long as an address in a surface may be.
const MOST_TARGET: usize = 2048;

/// A function that causes something in Quay, at the operator's click.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Function {
    OpenUrl,
    ShowFile,
    FocusTerminal,
    CopyText,
}

#[derive(Debug, Serialize)]
pub struct Fired {
    function: Function,
    /// The address, the path or the terminal, as far as the agent wrote it. None for a text that was copied,
    /// which is content.
    target: Option<String>,
    /// Whether there was more to the target, which the operator may have typed.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    target_cut: bool,
}

impl Fired {
    /// Of `function`, fired at `target` in a surface whose accepted state is `state`.
    pub fn of(function: Function, target: Option<&str>, state: &Value) -> Self {
        let target = target.filter(|_| function != Function::CopyText);
        let written = target.map(|target| as_written(state, target));
        Self {
            function,
            target: written.filter(|written| !written.is_empty()).map(|written| plain_line(written, MOST_TARGET)),
            target_cut: written != target,
        }
    }
}

/// The longest start of `target` that a text of `state` holds. `state` has what the agent wrote and nothing
/// the operator put in, which a target can be made of.
fn as_written<'a>(state: &Value, target: &'a str) -> &'a str {
    let mut texts = Vec::new();
    add_texts(state, &mut texts);
    let is_written = |end: usize| texts.iter().any(|text| text.contains(&target[..end]));
    let ends: Vec<usize> = target.char_indices().map(|(at, c)| at + c.len_utf8()).collect();
    // A start that is written has every shorter one written too
    match ends.partition_point(|end| is_written(*end)) {
        0 => "",
        count => &target[..ends[count - 1]],
    }
}

/// Adds the texts in `value`, and those of them that differ once their percent escapes are read, as a link's
/// path is.
fn add_texts(value: &Value, texts: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            if text.contains('%') {
                texts.extend(percent_decoded(text));
            }
            texts.push(text.clone());
        }
        Value::Array(values) => values.iter().for_each(|value| add_texts(value, texts)),
        Value::Object(values) => values.values().for_each(|value| add_texts(value, texts)),
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}
