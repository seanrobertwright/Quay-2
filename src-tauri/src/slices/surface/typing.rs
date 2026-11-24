//! Types the operator's answer into its agent's terminal, through the A2A delivery path.

use crate::slices::orchestrator::models::A2ADispatchRequest;
use crate::slices::orchestrator::A2ARouter;
use crate::slices::pty::models::{ClaudeStatus, RunKind};
use crate::slices::pty::PtyManager;

/// Why an answer could not be typed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotTyped {
    /// The terminal has exited or closed.
    TerminalOver,
    /// The delivery failed. Why is in the error log.
    Failed,
}

/// The terminals answers are typed into.
pub struct Typist {
    pty_manager: PtyManager,
    a2a_router: A2ARouter,
}

impl Typist {
    pub fn new(pty_manager: &PtyManager, a2a_router: &A2ARouter) -> Self {
        Self { pty_manager: pty_manager.clone(), a2a_router: a2a_router.clone() }
    }

    /// The CLI `terminal_id` runs, or `None` when it has closed.
    pub fn run_kind(&self, terminal_id: &str) -> Option<RunKind> {
        self.pty_manager.get_info(terminal_id).map(|info| info.run_kind)
    }

    /// Hands `line` to the A2A delivery path as the operator's message: typed at once, or held until
    /// the terminal's turn ends where Quay sees turns end. Blocks while it types.
    pub fn type_in(&self, terminal_id: &str, line: &str) -> Result<(), NotTyped> {
        // The router takes a name as well as an id, so a closed terminal must not get that far
        match self.pty_manager.get_info(terminal_id) {
            Some(info) if info.claude_status != ClaudeStatus::Exited => {}
            _ => return Err(NotTyped::TerminalOver),
        }
        let request = A2ADispatchRequest {
            from_terminal: String::new(),
            to_terminal: terminal_id.to_string(),
            prompt: line.to_string(),
            as_user: Some(true),
        };
        match self.a2a_router.dispatch(request, Some(&self.pty_manager)) {
            Ok(_) => Ok(()),
            Err(e) => {
                tracing::error!("{terminal_id}: a surface's answer could not be typed: {e}");
                Err(NotTyped::Failed)
            }
        }
    }
}
