//! A terminal's calls that have not returned, which of them Quay believes an agent still listens to,
//! and the answer on its way to those.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::oneshot;

/// What an open call returns: the operator's answer, or that there will be none. Calls that wait on one surface each get one.
pub struct Handed {
    result: Value,
    /// How many of those calls have not dropped it unread.
    held: Arc<AtomicUsize>,
    /// The line it is typed in as once every one of them has, or none when it is not.
    line: Option<Arc<str>>,
}

impl Handed {
    pub fn read(self) -> Value {
        self.result
    }

    /// Gives it up unread. The line to type, when no other call has it.
    pub fn drop_unread(self) -> Option<Arc<str>> {
        (self.held.fetch_sub(1, Ordering::AcqRel) == 1).then_some(self.line).flatten()
    }
}

struct Call {
    number: u64,
    /// The id its JSON-RPC request has, as its CLI wrote it.
    request: Value,
    /// Where its answer goes while it waits. It is told that its wait has ended by this going.
    answer: Option<oneshot::Sender<Handed>>,
}

/// One terminal's calls that have not returned. One is open until its wait ends.
#[derive(Default)]
pub struct OpenCalls(Vec<Call>);

impl OpenCalls {
    /// Opens the call `number`, which must be no other's.
    pub fn open(&mut self, number: u64, request: Value) -> oneshot::Receiver<Handed> {
        let (answer, rx) = oneshot::channel();
        self.0.push(Call { number, request, answer: Some(answer) });
        rx
    }

    /// Ends the wait of the call `number`.
    pub fn end(&mut self, number: u64) {
        self.end_where(|call| call.number == number);
    }

    /// Ends the waits of the calls whose request id is `request`.
    pub fn end_named(&mut self, request: &Value) {
        self.end_where(|call| call.request == *request);
    }

    /// Ends every wait.
    pub fn end_all(&mut self) {
        self.end_where(|_| true);
    }

    fn end_where(&mut self, ends: impl Fn(&Call) -> bool) {
        for call in self.0.iter_mut().filter(|call| ends(call)) {
            call.answer = None;
        }
    }

    /// Forgets the call `number`, which has returned or was dropped.
    pub fn forget(&mut self, number: u64) {
        self.0.retain(|call| call.number != number);
    }

    /// Forgets every call, which ends the waits. None of them changes anything after.
    pub fn forget_all(&mut self) {
        self.0.clear();
    }

    /// Whether the call `number` has not returned, and was not forgotten.
    pub fn has(&self, number: u64) -> bool {
        self.0.iter().any(|call| call.number == number)
    }

    pub fn is_open(&self, number: u64) -> bool {
        self.0.iter().any(|call| call.number == number && call.answer.is_some())
    }

    /// Returns `result` through those of `numbers` that are open, which ends their waits. `line` is
    /// what is typed in if every one of them drops it unread. `false` when none is open.
    pub fn hand(&mut self, numbers: &[u64], result: &Value, line: &str) -> bool {
        self.send(numbers, result, Some(line.into()))
    }

    /// Returns `result` through the call `number`, if it is open, which ends its wait. It is no answer, so
    /// it is not typed in when the call drops it unread.
    pub fn tell(&mut self, number: u64, result: &Value) {
        self.send(&[number], result, None);
    }

    fn send(&mut self, numbers: &[u64], result: &Value, line: Option<Arc<str>>) -> bool {
        let named = self.0.iter_mut().filter(|call| numbers.contains(&call.number));
        let waiting: Vec<_> = named.filter_map(|call| call.answer.take()).collect();
        let held = Arc::new(AtomicUsize::new(waiting.len()));
        // A call ends itself before it stops listening, so one that is open takes what it is sent
        let taken = waiting.into_iter().map(|answer| {
            let handed = Handed { result: result.clone(), held: held.clone(), line: line.clone() };
            answer.send(handed).is_ok()
        });
        taken.fold(false, |any, taken| any | taken)
    }
}
