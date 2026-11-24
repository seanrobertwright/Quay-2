//! A raw call's checks, its commit and its result.

use serde_json::{json, Value};

use super::super::check::{AcceptedSurface, HeldSurface};
use super::super::raw::{RawCall, TOOL};
use super::super::raw_changes::{in_use, unknown, Held};
use super::super::rejection::{CallError, QuayFailed, Rejection};
use super::super::store::{Creation, RawChange, RawRefused, SurfaceKey};
use super::super::wait::Wait;
use super::{dismissed_result, text_result, SurfaceTools, Verdict};

/// What a call does once it is accepted.
enum Next {
    /// It waits for the first answer to these surfaces of its terminal, of which there is one at least.
    Waits(Vec<String>),
    /// It returns this result at once.
    Returns(Value),
}

impl Next {
    /// For a call whose surfaces `asking` ask.
    fn of(asking: Vec<String>) -> Self {
        if asking.is_empty() { Self::Returns(shown_result()) } else { Self::Waits(asking) }
    }
}

impl SurfaceTools {
    /// Makes what `terminal_id`'s call says of its surfaces, and waits for an answer if one that it created
    /// or updated asks for one. `found` is what is wrong with the call so far.
    pub(super) async fn show_raw(
        &self,
        terminal_id: &str,
        request: &Value,
        arguments: &Value,
        call: &RawCall,
        found: Rejection,
    ) -> Value {
        let Some(wait) = Wait::start(self, terminal_id, request) else {
            return QuayFailed::TerminalOver.result();
        };
        let creation = Creation { tool: TOOL, arguments, title: &call.title, place: call.place, call: wait.number() };
        let next = {
            let queue = self.queue(terminal_id);
            let _one_at_a_time = queue.lock().await;
            if self.0.store.is_any_dismissed(terminal_id, &call.names(), creation) {
                return dismissed_result();
            }
            match self.0.store.rejoin_raw(terminal_id, call.creates(), creation, &call.shows()) {
                Some(asking) => Next::of(asking),
                None => match self.check_raw(terminal_id, creation, call, found).await {
                    Ok(next) => next,
                    Err(result) => return result,
                },
            }
        };
        match next {
            Next::Returns(result) => result,
            Next::Waits(asking) => {
                let asking: Vec<_> = asking.into_iter().map(|id| SurfaceKey::new(terminal_id, id)).collect();
                self.answered(wait, &asking[0], &asking[1..]).await
            }
        }
    }

    /// Commits and draws what `call` does, once neither Rust nor the webview has found anything wrong with
    /// it. The error is the result its agent gets when nothing was changed.
    async fn check_raw(
        &self,
        terminal_id: &str,
        creation: Creation<'_>,
        call: &RawCall,
        found: Rejection,
    ) -> Result<Next, Value> {
        let held = |id: &str| self.0.store.held(&SurfaceKey::new(terminal_id, id), creation);
        let mut rejection = found;
        call.check_surfaces(&mut rejection, held);
        let updated = call.updated().into_iter().filter_map(held).filter(Held::takes_updates);
        let updated = updated.map(|its| HeldSurface { place: its.place, state: its.state }).collect();
        let key = SurfaceKey::new(terminal_id, call.creates());
        let surfaces = match self.verdict_on(&key, TOOL, creation.arguments.clone(), updated).await {
            None if rejection.is_empty() => {
                tracing::error!("{terminal_id}: no verdict on a {TOOL} call in {:?}", self.0.timing.verdict);
                return Err(QuayFailed::NoVerdict.result());
            }
            None => Vec::new(),
            Some(Verdict::Failed { errors, more }) => {
                for error in errors {
                    let path = error.path.unwrap_or_default();
                    let (code, surface_id, message) = (error.code.into(), error.surface_id, error.message);
                    rejection.add(CallError { code, surface_id, path, message });
                }
                rejection.add_more(more);
                Vec::new()
            }
            Some(Verdict::Accepted(_)) => {
                tracing::error!("{terminal_id}: a {TOOL} call was given a typed call's verdict");
                return Err(QuayFailed::Expansion.result());
            }
            Some(Verdict::Surfaces { surfaces }) => surfaces,
        };
        if !rejection.is_empty() {
            return Err(self.reject(terminal_id, TOOL, &rejection));
        }
        self.commit_raw(terminal_id, creation, call, surfaces)
    }

    /// Commits and draws what `call` does, with the `surfaces` that the webview accepted.
    fn commit_raw(
        &self,
        terminal_id: &str,
        creation: Creation,
        call: &RawCall,
        mut surfaces: Vec<AcceptedSurface>,
    ) -> Result<Next, Value> {
        let changes = call.changes().into_iter().map(|change| {
            let at = surfaces.iter().position(|surface| surface.surface_id == change.id);
            let accepted = at.map(|at| surfaces.swap_remove(at).accepted);
            RawChange { id: change.id, effect: change.effect, accepted }
        });
        let changes: Vec<_> = changes.collect();
        let changed = self.0.store.commit_raw(terminal_id, creation, changes).map_err(|refused| {
            let reject = |error: CallError| self.reject(terminal_id, TOOL, &Rejection::of(error));
            match refused {
                RawRefused::TerminalOver => QuayFailed::TerminalOver.result(),
                RawRefused::Dismissed => dismissed_result(),
                RawRefused::IdInUse(id) => reject(call.at(&id, "INTEGRITY_ERROR", in_use(&id))),
                RawRefused::Gone(id) => reject(call.at(&id, "INTEGRITY_ERROR", unknown(&id))),
                // In a moment it is answered, and the same call then says what that makes of it
                RawRefused::BeingSent => QuayFailed::NoVerdict.result(),
                RawRefused::PastLimit(id, past) => reject(call.at(&id, "VALIDATION_FAILED", past.words())),
                RawRefused::NoState(id) => {
                    tracing::error!("{terminal_id}: the verdict on a {TOOL} call left out the surface {id}");
                    QuayFailed::NoVerdict.result()
                }
            }
        })?;
        self.remove_all(&changed.left);
        for record in &changed.shown {
            self.show(record);
        }
        Ok(match changed.shows {
            true => Next::of(changed.asking),
            false => Next::Returns(text_result(json!({ "deleted": true }))),
        })
    }
}

fn shown_result() -> Value {
    text_result(json!({ "shown": true }))
}
