//! The calls Quay believes an agent still listens to, and the answer on its way to them.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::oneshot;

/// What an open call returns: the operator's answer. Calls that wait on one surface each get one.
pub struct Handed {
    result: Value,
    /// How many of those calls have not dropped it unread.
    held: Arc<AtomicUsize>,
    /// The line it is typed in as once every one of them has.
    line: Arc<str>,
}

impl Handed {
    pub fn read(self) -> Value {
        self.result
    }

    /// Gives it up unread. The line to type, when no other call has it.
    pub fn drop_unread(self) -> Option<Arc<str>> {
        (self.held.fetch_sub(1, Ordering::AcqRel) == 1).then_some(self.line)
    }
}

struct Call {
    number: u64,
    /// The id its JSON-RPC request has, as its CLI wrote it.
    request: Value,
    answer: oneshot::Sender<Handed>,
}

/// One terminal's open calls. A call that leaves ends its wait, and is told so by its sender going.
#[derive(Default)]
pub struct OpenCalls(Vec<Call>);

impl OpenCalls {
    /// Opens the call `number`, which must be no other's.
    pub fn open(&mut self, number: u64, request: Value) -> oneshot::Receiver<Handed> {
        let (answer, rx) = oneshot::channel();
        self.0.push(Call { number, request, answer });
        rx
    }

    pub fn end(&mut self, number: u64) {
        self.0.retain(|call| call.number != number);
    }

    /// Ends the calls whose request id is `request`.
    pub fn end_named(&mut self, request: &Value) {
        self.0.retain(|call| call.request != *request);
    }

    pub fn end_all(&mut self) {
        self.0.clear();
    }

    pub fn is_open(&self, number: u64) -> bool {
        self.0.iter().any(|call| call.number == number)
    }

    /// Returns `result` through those of `numbers` that are open, which ends them. `line` is what is
    /// typed in if every one of them drops it unread. `false` when none is open.
    pub fn hand(&mut self, numbers: &[u64], result: &Value, line: &str) -> bool {
        let (waiting, others): (Vec<Call>, Vec<Call>) =
            self.0.drain(..).partition(|call| numbers.contains(&call.number));
        self.0 = others;
        let held = Arc::new(AtomicUsize::new(waiting.len()));
        let line: Arc<str> = line.into();
        // A call ends itself before it stops listening, so one that is open takes what it is sent
        let taken = waiting.into_iter().map(|call| {
            let handed = Handed { result: result.clone(), held: held.clone(), line: line.clone() };
            call.answer.send(handed).is_ok()
        });
        taken.fold(false, |any, taken| any | taken)
    }
}
