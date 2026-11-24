//! The messages on their way to Quay, so that a cancel can close the one it names.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tokio::task::AbortHandle;

use crate::rpc::Id;

/// How many messages may be on their way at once. With the limits on a request, a reply and
/// the queue for stdout it bounds the relay's memory.
const MAX_OPEN: usize = 16;

struct Call {
    /// Tells two calls apart whose ids are the same, or which have none.
    number: u64,
    id: Option<Id>,
    task: AbortHandle,
}

#[derive(Default)]
struct Open {
    started: u64,
    calls: Vec<Call>,
}

#[derive(Clone, Default)]
pub struct OpenCalls(Arc<Mutex<Open>>);

impl OpenCalls {
    /// Runs `work` for the message `id` beside the others, unless `MAX_OPEN` are open already.
    /// Returns whether it runs.
    pub fn start(&self, id: Option<Id>, work: impl Future<Output = ()> + Send + 'static) -> bool {
        let mut open = self.lock();
        if open.calls.len() >= MAX_OPEN {
            return false;
        }
        open.started += 1;
        let number = open.started;
        let calls = self.clone();
        let task = tokio::spawn(async move {
            work.await;
            calls.lock().calls.retain(|call| call.number != number);
        });
        open.calls.push(Call { number, id, task: task.abort_handle() });
        true
    }

    /// Stops request `id`, if it is open.
    pub fn cancel(&self, id: &Id) {
        self.lock().calls.retain(|call| {
            let cancelled = call.id.as_ref() == Some(id);
            if cancelled {
                call.task.abort();
            }
            !cancelled
        });
    }

    /// Stops every message.
    pub fn close(&self) {
        for call in self.lock().calls.drain(..) {
            call.task.abort();
        }
    }

    fn lock(&self) -> MutexGuard<'_, Open> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
