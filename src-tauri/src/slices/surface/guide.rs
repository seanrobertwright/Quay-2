//! `quay_surface_guide`: how to write what `quay_surface` takes. It reads nothing and waits for nothing.

pub const TOOL: &str = "quay_surface_guide";

/// The guide. `pnpm surface:guide` writes it: the lines of the catalog's components and functions are
/// generated from the catalog, and the rules and the examples are written by hand.
pub const GUIDE: &str = include_str!("surface_guide.md");
