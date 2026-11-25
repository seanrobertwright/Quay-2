//! Connect: the relay as an entry in a CLI's own configuration, written and removed only when
//! the operator asks. Also what the window is told of a terminal's handshake, and on Windows the
//! removal of the old relays an update leaves.

mod antigravity;
mod commands;
mod config_file;
pub mod handshake;
mod json_text;
#[cfg(windows)]
pub mod relay_leftovers;

#[cfg(test)]
mod antigravity_tests;
#[cfg(test)]
mod config_file_tests;

pub use antigravity::{Antigravity, Connection, State};
pub use commands::*;
