//! The terminals as the agent surfaces know them: an answer is typed into one through the A2A delivery
//! path, what one shows of its turn ends its calls' waits, and its exit, relaunch or close ends or
//! removes its surfaces.

use super::models::A2ADispatchRequest;
use super::router::A2ARouter;
use crate::slices::pty::manager::{LaunchEvent, TurnEvent};
use crate::slices::pty::models::RunKind;
use crate::slices::pty::plugin_watch::LaunchRef;
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
    let (followed, terminals, router) = (surfaces.clone(), pty_manager.clone(), a2a_router.clone());
    pty_manager.add_launch_watcher(move |event| match event {
        LaunchEvent::Listed(launch) => {
            followed.launched(&launch.terminal_id, launch.launch);
            // It may have been over, or its terminal closed, before this was heard
            if terminals.get_info(&launch.terminal_id).is_none() {
                followed.terminal_closed(&launch.terminal_id);
            } else if !terminals.launch_running(&launch) {
                followed.launch_over(&launch.terminal_id, launch.launch);
            }
        }
        LaunchEvent::ShookHands(_) => {}
        LaunchEvent::Over(launch) => {
            followed.launch_over(&launch.terminal_id, launch.launch);
            router.launch_over(&launch);
        }
        LaunchEvent::Closed(terminal_id) => followed.terminal_closed(&terminal_id),
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
    fn type_in(&self, terminal_id: &str, launch: u64, line: &str) -> Result<(), NotTyped> {
        let launch = LaunchRef { terminal_id: terminal_id.to_string(), launch };
        // The router takes a name as well as an id, so a closed terminal must not get that far
        if !self.pty_manager.launch_running(&launch) {
            return Err(NotTyped::TerminalOver);
        }
        let request = A2ADispatchRequest {
            from_terminal: String::new(),
            to_terminal: terminal_id.to_string(),
            prompt: line.to_string(),
            as_user: Some(true),
        };
        match self.a2a_router.dispatch_to_launch(request, launch.clone(), &self.pty_manager) {
            Ok(_) => Ok(()),
            Err(_) if !self.pty_manager.launch_running(&launch) => Err(NotTyped::TerminalOver),
            Err(e) => {
                tracing::error!("{terminal_id}: a surface's answer could not be typed: {e}");
                Err(NotTyped::Failed)
            }
        }
    }
}
