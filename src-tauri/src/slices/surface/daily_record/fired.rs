//! What the record keeps of a function a surface fired: which, and at what.

use serde::{Deserialize, Serialize};

use super::super::plain_line::plain_line;

/// The most characters of a target: as long as an address in a surface may be.
const MOST_TARGET: usize = 2048;

/// A function that causes something in Quay, at the operator's click. Mirrors the front end's `Effect`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FiredFunction {
    OpenUrl,
    ShowFile,
    FocusTerminal,
    CopyText,
}

/// A function that fired.
#[derive(Debug, Serialize)]
pub struct Fired {
    function: FiredFunction,
    /// The address, the path or the terminal, as it is with nothing in it that the operator typed, in one line.
    /// One that is cut where it is longer than `MOST_TARGET` ends in an ellipsis. None for a text that was
    /// copied, which is content, and where nothing is left of it.
    target: Option<String>,
    /// Whether it fired at another target, which what the operator typed is part of.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    target_typed: bool,
}

impl Fired {
    /// Of `function`, whose `target` the webview gives with nothing in it that the operator typed.
    pub fn of(function: FiredFunction, target: Option<&str>, target_typed: bool) -> Self {
        let target = target.filter(|target| function != FiredFunction::CopyText && !target.is_empty());
        Self { function, target: target.map(|target| plain_line(target, MOST_TARGET)), target_typed }
    }
}
