//! Where a surface is drawn, and how many of a terminal's live ones are drawn there.

use serde::Serialize;

/// The most live surfaces a terminal has in one place.
pub const MOST_LIVE: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Place {
    /// The companion's Surface view.
    Companion,
    /// A stage tab of its own.
    Tab,
    /// A line on its terminal's pane.
    Strip,
}

impl Place {
    /// What an agent calls it.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Companion => "companion",
            Self::Tab => "tab",
            Self::Strip => "strip",
        }
    }
}
