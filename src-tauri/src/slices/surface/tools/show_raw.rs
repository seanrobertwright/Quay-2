//! A raw call's checks, its commit and its result.

use serde_json::{json, Value};

use super::super::raw::{RawCall, TOOL};
use super::super::rejection::{CallError, QuayFailed, Rejection};
use super::super::store::{CommitRefused, Creation, SurfaceKey};
use super::super::wait::Wait;
use super::{dismissed_result, text_result, SurfaceTools, Verdict};

/// What a call does once it is accepted.
enum Next {
    /// It waits for the answer to the surface it created.
    Waits,
    /// It returns this result at once.
    Returns(Value),
}

impl SurfaceTools {
    /// Shows the surface that `terminal_id`'s call creates, if it creates one, and waits for its answer if
    /// it asks for one. `found` is what is wrong with the call so far.
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
        let key = SurfaceKey::new(terminal_id, call.creates());
        let creation = Creation { tool: TOOL, arguments, title: &call.title, place: call.place, call: wait.number() };
        {
            let queue = self.queue(terminal_id);
            let _one_at_a_time = queue.lock().await;
            if self.0.store.is_dismissed(&key, creation) {
                return dismissed_result();
            }
            if self.0.store.is_shown_already(&key, creation) {
                self.0.store.accepted(terminal_id, TOOL);
                return shown_result();
            }
            if self.0.store.rejoin(terminal_id, creation).is_none() {
                match self.check_raw(&key, creation, call, found).await {
                    Ok(Next::Waits) => {}
                    Ok(Next::Returns(result)) | Err(result) => return result,
                }
            }
        }
        self.answered(wait, &key).await
    }

    /// Commits and draws the surface `key` that `call` creates, once neither Rust nor the webview has
    /// found anything wrong with the call. The error is the result its agent gets when nothing was changed.
    async fn check_raw(
        &self,
        key: &SurfaceKey,
        creation: Creation<'_>,
        call: &RawCall,
        found: Rejection,
    ) -> Result<Next, Value> {
        let terminal_id = &key.terminal_id;
        let mut rejection = found;
        call.check_surfaces(&mut rejection, |id| self.0.store.held(&SurfaceKey::new(terminal_id, id), creation));
        let accepted = match self.verdict_on(key, TOOL, creation.arguments.clone()).await {
            None if rejection.is_empty() => {
                tracing::error!("{terminal_id}: no verdict on a {TOOL} call in {:?}", self.0.timing.verdict);
                return Err(QuayFailed::NoVerdict.result());
            }
            None => None,
            Some(Verdict::Failed { errors, more }) => {
                for error in errors {
                    let path = error.path.unwrap_or_default();
                    let (code, surface_id, message) = (error.code.into(), error.surface_id, error.message);
                    rejection.add(CallError { code, surface_id, path, message });
                }
                rejection.add_more(more);
                None
            }
            Some(Verdict::Accepted(accepted)) => Some(accepted),
        };
        if !rejection.is_empty() {
            return Err(self.reject(terminal_id, TOOL, &rejection));
        }
        let Some(accepted) = accepted else {
            // Nothing is wrong with it, and it creates nothing: its messages are deletes
            self.0.store.accepted(terminal_id, TOOL);
            return Ok(Next::Returns(text_result(json!({ "deleted": true }))));
        };
        let record = self.0.store.commit(key, creation, accepted).map_err(|refused| match refused {
            CommitRefused::TerminalOver => QuayFailed::TerminalOver.result(),
            CommitRefused::Dismissed => dismissed_result(),
            CommitRefused::IdInUse => self.reject(terminal_id, TOOL, &Rejection::of(call.in_use())),
            CommitRefused::PastLimit(past) => {
                let error = call.at_create("VALIDATION_FAILED", past.words());
                self.reject(terminal_id, TOOL, &Rejection::of(error))
            }
        })?;
        self.show(&record);
        Ok(if record.asks { Next::Waits } else { Next::Returns(shown_result()) })
    }
}

fn shown_result() -> Value {
    text_result(json!({ "shown": true }))
}
