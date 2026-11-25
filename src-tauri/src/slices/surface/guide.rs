//! `quay_surface_guide`: how to write what `quay_surface` takes. It reads nothing and waits for nothing.

pub const TOOL: &str = "quay_surface_guide";

/// The guide. `pnpm surface:guide` writes it, from the catalog's own schemas.
pub const GUIDE: &str = include_str!("surface_guide.md");
