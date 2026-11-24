//! Agent surfaces: what an agent shows the operator through a tool call, and the answer it gets back.
//!
//! An agent's call is checked here (`ask`, `board`), then by the webview on a scratch copy of the engine
//! (`check`), then committed (`store`), then drawn. `tools` runs those steps and waits for the answer
//! (`wait`), which is typed into the terminal (`typing`) once no call is open to return it. `read` tells
//! an agent where a surface stands, and `image` reads the image files a live surface names. A terminal's
//! surfaces end with its launch, and go when it closes.

mod arguments;
mod ask;
mod board;
mod board_run;
mod calls;
mod check;
pub mod commands;
mod disk;
mod image;
mod image_file;
mod local_path;
pub mod names;
mod place;
mod read;
mod rejection;
mod show_file;
mod store;
pub mod timing;
mod tools;
mod typed_line;
mod typing;
mod unsent;
mod wait;

#[cfg(test)]
mod ask_tests;
#[cfg(test)]
mod board_tests;
#[cfg(test)]
mod disk_tests;
#[cfg(test)]
mod image_file_tests;
#[cfg(test)]
mod image_tests;
#[cfg(test)]
mod limit_tests;
#[cfg(test)]
mod local_path_tests;
#[cfg(test)]
mod locked_tests;
#[cfg(test)]
mod over_tests;
#[cfg(test)]
mod read_tests;
#[cfg(test)]
mod return_tests;
#[cfg(test)]
mod show_file_tests;
#[cfg(test)]
mod test_seam;
#[cfg(test)]
mod unsent_tests;

pub use check::{CheckRequest, Verdict};
pub use commands::*;
pub use image::*;
pub use show_file::*;
pub use store::{AnswerRefused, BeingSent, SurfaceKey, SurfaceRecord};
pub use tools::{SurfaceTools, Webview};
pub use typed_line::is_typed_line;
pub use typing::{NotTyped, Terminals};
pub use unsent::{Page, UnsentRefused, UnsentSave};
