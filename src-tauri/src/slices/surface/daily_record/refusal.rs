//! What the record keeps of a rejected call: where it was wrong, and never in what words.

use serde::Serialize;

use super::super::plain_line::plain_line;
use super::super::rejection::{CallError, Rejection};
use super::MOST_NAMED;

#[derive(Debug, Serialize)]
pub struct Refusal {
    /// How many of its terminal's calls of its tool were rejected in a row, this one among them.
    run: u32,
    /// Those that its agent was told.
    errors: Vec<ErrorAt>,
    /// How many there were after those.
    #[serde(skip_serializing_if = "Option::is_none")]
    more: Option<usize>,
}

/// An error, without its message.
#[derive(Debug, Serialize)]
struct ErrorAt {
    code: String,
    path: String,
}

impl Refusal {
    /// Of the call that `rejection` rejects, the `run`th in a row.
    pub fn of(rejection: &Rejection, run: u32) -> Self {
        let error = |CallError { code, path, .. }: &CallError| ErrorAt {
            code: plain_line(code, MOST_NAMED),
            path: plain_line(path, MOST_NAMED),
        };
        let more = Some(rejection.more()).filter(|more| *more > 0);
        Self { run, errors: rejection.errors().iter().map(error).collect(), more }
    }
}
