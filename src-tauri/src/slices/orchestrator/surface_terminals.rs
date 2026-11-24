//! The terminals as the agent surfaces know them: an answer is typed into one through the A2A delivery
//! path, and what one shows of its turn ends its calls' waits.

use super::models::A2ADispatchRequest;
use super::router::A2ARouter;
use crate::slices::pty::manager::TurnEvent;
use crate::slices::pty::models::{ClaudeStatus, RunKind};
use crate::slices::pty::PtyManager;
use crate::slices::surface::{NotTyped, SurfaceTools, Terminals};

/// Connects `surfaces` to the terminals, once.
pub fn connect_surfaces(surfaces: &SurfaceTools, pty_manager: &PtyManager, a2a_router: &A2ARouter) {
    surfaces.set_terminals(Typist { pty_manager: pty_manager.clone(), a2a_router: a2a_router.clone() });
    let ending = surfaces.clone();
    pty_manager.add_turn_watcher(move |terminal_id, event| {
        if event == TurnEvent::Ended {
            ending.turn_ended(terminal_id);
        }
    });
    // A lone Escape interrupts Codex, which reports neither that nor its turn's end. It is heard before
    // the key goes in, so no answer goes to a call that the key has just interrupted.
    let (interrupted, terminals) = (surfaces.clone(), pty_manager.clone());
    pty_manager.set_input_watcher(move |terminal_id, data| {
        let is_codex = || terminals.get_info(terminal_id).is_some_and(|info| info.run_kind == RunKind::Codex);
        if data == "\u{1b}" && is_codex() {
            interrupted.turn_ended(terminal_id);
        }
    });
}

struct Typist {
    pty_manager: PtyManager,
    a2a_router: A2ARouter,
}

impl Terminals for Typist {
    fn type_in(&self, terminal_id: &str, line: &str) -> Result<(), NotTyped> {
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
