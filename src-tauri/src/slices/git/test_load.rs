//! Keeps a test that floods the disk from running beside tests that measure time. The repository
//! watcher's tests wait a fixed window for debounced events; a test writing and hashing over ten
//! thousand files at once slowed them past it, so `cargo test` failed on them only when both ran together.

use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

static LOAD: RwLock<()> = RwLock::new(());

/// Held for the whole of a test that measures time; any number run together.
pub(crate) fn timed() -> RwLockReadGuard<'static, ()> {
    LOAD.read().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Held for the whole of a test that floods the disk; no timed test runs meanwhile.
pub(crate) fn heavy() -> RwLockWriteGuard<'static, ()> {
    LOAD.write().unwrap_or_else(|poisoned| poisoned.into_inner())
}
