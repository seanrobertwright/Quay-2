//! Where the operator's answer is typed: the terminals, as the surfaces know them.

/// Why an answer could not be typed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotTyped {
    /// The launch it was for is over: its terminal has exited, closed or been relaunched.
    TerminalOver,
    /// The delivery failed. Why is in the error log.
    Failed,
}

/// The terminals answers are typed into.
pub trait Terminals: Send + Sync {
    /// Types `line` into `terminal_id` as the operator's message: at once, or held until the
    /// terminal's turn ends where Quay sees turns end. It is for the launch `launch`, and no later one
    /// gets it, whether it was held or not. Blocks while it types.
    fn type_in(&self, terminal_id: &str, launch: u64, line: &str) -> Result<(), NotTyped>;
}
