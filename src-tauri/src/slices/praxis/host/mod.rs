//! The Praxis CLI runner (#446): the one backend module through which Quay runs `praxis`, as
//! #228 decided. It finds and launches the CLI ([`launch`]), runs bounded headless calls
//! ([`process`], [`runner`]), turns their `--json` records into typed outcomes ([`outcome`]) and
//! keeps one [`HostCondition`] per project's builder session.

pub mod commands;
mod launch;
mod outcome;
mod process;
mod runner;
mod settings;
#[cfg(test)]
mod tests;

pub use commands::*;
pub use outcome::{CallOutcome, HostCondition};
pub use runner::{ConditionChange, PraxisCli};
pub use settings::PraxisCliSettings;
