//! Where the operator's answer is typed: the terminals, as the surfaces know them.

/// Why an answer could not be typed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotTyped {
    /// The terminal has exited or closed.
    TerminalOver,
    /// The delivery failed. Why is in the error log.
    Failed,
}

/// The terminals answers are typed into.
pub trait Terminals: Send + Sync {
    /// Types `line` into `terminal_id` as the operator's message: at once, or held until the
    /// terminal's turn ends where Quay sees turns end. Blocks while it types.
    fn type_in(&self, terminal_id: &str, line: &str) -> Result<(), NotTyped>;
}
