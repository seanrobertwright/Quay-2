//! How long a surface tool's call may take: the one home of these limits.

use std::time::Duration;

/// How long a call stays open for the operator's answer. The surface outlives it.
pub const WAIT: Duration = Duration::from_secs(100);

/// The limit each CLI is to be launched with on a call to Quay's server.
pub const CLI_LIMIT: Duration = Duration::from_secs(150);

/// How long the webview has to check a call.
pub const VERDICT_LIMIT: Duration = Duration::from_secs(5);

// A wait that outlived the CLI's own limit would return its answer to nobody.
const _: () = assert!(WAIT.as_secs() + VERDICT_LIMIT.as_secs() < CLI_LIMIT.as_secs());

/// The limits a server runs with. Tests shorten them.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    pub verdict: Duration,
    pub wait: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self { verdict: VERDICT_LIMIT, wait: WAIT }
    }
}
