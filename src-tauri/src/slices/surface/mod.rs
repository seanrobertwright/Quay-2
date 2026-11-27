//! Agent surfaces: what an agent shows the operator through a tool call, and the answer it gets back.
//!
//! An agent's call is checked here (`ask`, `review`, `board`, `raw`), then by the webview on a scratch copy of
//! the engine (`check`), then committed (`store`), then drawn. `tools` runs those steps and waits for the
//! answer (`wait`), which is typed into the terminal (`typing`) once no call is open to return it. `read`
//! tells an agent where a surface stands, `guide` how to write a raw one, and `image` reads the image files
//! a live surface names. A terminal's surfaces end with its launch, and go when it closes. What becomes of
//! each is kept, without its content, in the surface record (`daily_record`).

mod arguments;
mod ask;
mod board;
mod board_run;
mod calls;
mod carried;
mod check;
pub mod commands;
mod daily_record;
mod disk;
mod guide;
mod image;
mod image_file;
mod local_path;
pub mod names;
mod past_limit;
mod place;
mod plain_line;
mod raw;
mod raw_changes;
mod raw_fixes;
mod read;
mod rejection;
mod review;
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
mod daily_record_tests;
#[cfg(test)]
mod delete_tests;
#[cfg(test)]
mod disk_tests;
#[cfg(test)]
mod guide_tests;
#[cfg(test)]
mod image_file_tests;
#[cfg(test)]
mod image_tests;
#[cfg(test)]
mod life_tests;
#[cfg(test)]
mod limit_tests;
#[cfg(test)]
mod local_path_tests;
#[cfg(test)]
mod locked_tests;
#[cfg(test)]
mod move_tests;
#[cfg(test)]
mod over_tests;
#[cfg(test)]
mod raw_seam;
#[cfg(test)]
mod raw_tests;
#[cfg(test)]
mod read_tests;
#[cfg(test)]
mod return_tests;
#[cfg(test)]
mod review_tests;
#[cfg(test)]
mod show_file_tests;
#[cfg(test)]
mod test_seam;
#[cfg(test)]
mod unsent_tests;
#[cfg(test)]
mod update_tests;

pub use check::{CheckRequest, Verdict};
pub use commands::*;
pub use daily_record::record_folder;
pub use image::*;
pub use show_file::*;
pub use store::{AnswerRefused, BeingSent, MoveRefused, SurfaceKey, SurfaceRecord};
pub use tools::{SurfaceTools, Webview};
pub use typed_line::is_typed_line;
pub use typing::{NotTyped, TerminalName, Terminals};
pub use unsent::{Page, UnsentRefused, UnsentSave};
