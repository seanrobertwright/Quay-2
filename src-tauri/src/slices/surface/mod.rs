//! Agent surfaces: what an agent shows the operator through a tool call, and the answer it gets back.
//!
//! An agent's call is checked here (`ask`), then by the webview on a scratch copy of the engine
//! (`check`), then committed (`store`), then drawn. `tools` runs those steps and waits for the answer
//! (`wait`), which is typed into the terminal (`typing`) once no call is open to return it. `read` tells
//! an agent where a surface stands.

mod ask;
mod calls;
mod check;
pub mod commands;
mod read;
mod rejection;
mod store;
pub mod timing;
mod tools;
mod typed_line;
mod typing;
mod wait;

#[cfg(test)]
mod ask_tests;
#[cfg(test)]
mod read_tests;
#[cfg(test)]
mod return_tests;
#[cfg(test)]
mod test_seam;

pub use check::{CheckRequest, Verdict};
pub use commands::*;
pub use store::{AnswerRefused, BeingSent, SurfaceKey, SurfaceRecord};
pub use tools::{SurfaceTools, Webview};
pub use typed_line::is_typed_line;
