//! Connect: the relay as an entry in a CLI's own configuration, written and removed only when
//! the operator asks.

mod antigravity;
mod commands;
mod config_file;
mod json_text;

#[cfg(test)]
mod antigravity_tests;
#[cfg(test)]
mod config_file_tests;

pub use antigravity::{Antigravity, Connection, State};
pub use commands::*;
