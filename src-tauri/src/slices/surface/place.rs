//! Where a surface is drawn, and how many of a terminal's live ones are drawn there.

/// The most live surfaces a terminal has in one place.
pub const MOST_LIVE: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Place {
    /// The companion's Surface view.
    Companion,
}

impl Place {
    /// What an agent calls it.
    pub fn name(self) -> &'static str {
        match self {
            Self::Companion => "companion",
        }
    }
}
