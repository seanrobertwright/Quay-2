//! The surface tools by name, for what is set before any of them is called.

/// Whether this build lists and accepts the surface tools: debug builds only, until surfaces are
/// turned on for release builds.
pub const OFFERED: bool = cfg!(debug_assertions);

/// The six, in the order they are listed.
pub const SURFACE_TOOLS: [&str; 6] = [
    "quay_ask",
    "quay_review",
    "quay_board",
    "quay_surface",
    "quay_surface_guide",
    "quay_surface_read",
];

/// The tools a CLI is launched with leave to call without asking the operator.
pub fn pre_approved() -> &'static [&'static str] {
    if OFFERED { &SURFACE_TOOLS } else { &[] }
}
