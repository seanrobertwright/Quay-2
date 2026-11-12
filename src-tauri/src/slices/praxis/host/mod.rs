//! The Praxis CLI runner (#446): the one backend module through which Quay runs `praxis`, as
//! #228 decided. It finds and launches the CLI ([`launch`]), runs bounded headless calls
//! ([`process`], [`runner`]), turns their `--json` records into typed outcomes ([`outcome`]) and
//! keeps one [`HostCondition`] per project's builder session. A graph workflow's bundle goes to
//! `praxis` as the paths of its saved files ([`bundle`]), and a graph trigger as its saved file
//! with the target its target file names ([`trigger`]). A workflow template draft goes as a file
//! Quay writes for the one call and then removes ([`preview`]).

mod bundle;
pub mod commands;
mod launch;
mod outcome;
mod preview;
mod process;
mod runner;
mod settings;
#[cfg(test)]
mod tests;
mod trigger;

pub use bundle::{bundle_changes, bundle_digest, graph_workflow_bundle, GraphWorkflowBundle};
pub use trigger::{trigger_changes, trigger_digest};
pub use commands::*;
pub use outcome::{CallOutcome, HostCondition};
pub use runner::{ConditionChange, PraxisCli};
pub use settings::PraxisCliSettings;
