pub mod commands;
pub mod config;
pub mod gate;
pub mod git;
pub mod models;
pub mod paths;
pub mod runner;
pub mod spend;
pub mod supervisor;
pub mod vault;

pub use commands::{
    machina_abort, machina_accept_and_merge, machina_approve_project_config,
    machina_bind_author_terminal,
    machina_get_project_info, machina_get_status, machina_list_work_orders,
    machina_preview_author_message, machina_remove_worktree, machina_resolve_hold,
    machina_resume, machina_run_gate, machina_save_project_config, machina_send_to_author,
    machina_set_loop_mode, machina_submit_work_order,
};
pub use supervisor::MachinaManager;
