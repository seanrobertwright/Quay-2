pub mod commands;
mod instructions;
pub mod launch_prompt;
pub mod mcp;
#[cfg(test)]
mod mcp_terminal_tests;
#[cfg(test)]
mod connect_tests;
#[cfg(test)]
mod mcp_tests;
pub mod models;
pub mod router;
pub mod surface_terminals;
pub mod swarms;
pub mod target;

pub use commands::*;
pub use mcp::handle_mcp_request;
pub use models::*;
pub use router::A2ARouter;
pub use surface_terminals::connect_surfaces;
pub use swarms::SwarmStore;
