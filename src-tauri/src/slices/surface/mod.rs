//! Agent surfaces: what an agent shows the operator through a tool call, and the answer it gets back.
//!
//! An agent's call is checked here (`ask`), then by the webview on a scratch copy of the engine
//! (`check`), then committed (`store`), then drawn. `tools` runs those steps and waits for the answer.

mod ask;
mod check;
pub mod commands;
pub mod names;
mod rejection;
mod store;
pub mod timing;
mod tools;

#[cfg(test)]
mod ask_tests;
#[cfg(test)]
mod test_seam;

pub use check::{CheckRequest, Verdict};
pub use commands::*;
pub use store::{AnswerRefused, SurfaceKey, SurfaceRecord};
pub use tools::{SurfaceTools, Webview};
