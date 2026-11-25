//! How large a surface may be, and how many of its kind a place takes: what the store holds every call to.

use serde_json::Value;

use super::arguments::spelled;
use super::check::Accepted;
use super::place::{Place, MOST_LIVE};

/// The most components a surface may have.
const MOST_COMPONENTS: usize = 500;

/// The most components a surface may have drawn at once.
const MOST_AT_ONCE: u32 = 2000;

/// The most components a surface may have with every row drawn. The engine has them all.
const MOST_WITH_ROWS: u32 = 10_000;

/// The most data a surface's data model may hold, in bytes of JSON.
const MOST_DATA: usize = 256 * 1024;

/// The most images a surface may have, each time one is shown counted.
const MOST_IMAGES: usize = 12;

/// The limit that a surface would be past.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PastLimit {
    /// The terminal has `MOST_LIVE` live surfaces in this place.
    Live(Place),
    /// It would have this many components.
    Components(usize),
    /// It would have this many components drawn at once.
    AtOnce(u32),
    /// It would have this many components with every row drawn.
    WithRows(u32),
    /// Its data model would be this many bytes of JSON.
    Data(usize),
    /// It would have this many images.
    Images(usize),
}

impl PastLimit {
    /// What its agent is told.
    pub fn words(self) -> String {
        let (most, has) = match self {
            Self::Live(place) => {
                return format!(
                    "This terminal has {} live surfaces in {}, the most allowed. Wait for an answer, delete one, or put several questions in one quay_ask.",
                    spelled(MOST_LIVE),
                    place.name()
                );
            }
            Self::Components(has) => (format!("{MOST_COMPONENTS} components"), has.to_string()),
            Self::AtOnce(has) => (format!("{MOST_AT_ONCE} components drawn at once"), has.to_string()),
            Self::WithRows(has) => (format!("{MOST_WITH_ROWS} components with every row drawn"), has.to_string()),
            Self::Data(has) => (format!("{} of data", in_kb(MOST_DATA)), in_kb(has)),
            Self::Images(has) => (format!("{MOST_IMAGES} images"), has.to_string()),
        };
        format!("A surface has at most {most}; this one would have {has}.")
    }
}

/// `bytes` in kB, so that one past a limit reads as more than it.
fn in_kb(bytes: usize) -> String {
    format!("{} kB", bytes.div_ceil(1024))
}

/// Whether what the webview accepted is no larger than a surface may be. Its components and its images are
/// at least those it names, whatever the webview counted. What is drawn of it takes the engine's catalog to
/// count, so of that the webview's count is all there is.
pub fn within_limits(accepted: &Accepted) -> Result<(), PastLimit> {
    let surface = &accepted.state["createSurface"];
    let named = surface["components"].as_array().map_or(0, Vec::len);
    let components = named.max(accepted.components as usize);
    let data = match &surface["dataModel"] {
        Value::Null => 0,
        data => data.to_string().len(),
    };
    let images = accepted.image_paths.len().max(accepted.images as usize);
    if components > MOST_COMPONENTS {
        Err(PastLimit::Components(components))
    } else if accepted.drawn_at_once > MOST_AT_ONCE {
        Err(PastLimit::AtOnce(accepted.drawn_at_once))
    } else if accepted.drawn_with_rows > MOST_WITH_ROWS {
        Err(PastLimit::WithRows(accepted.drawn_with_rows))
    } else if data > MOST_DATA {
        Err(PastLimit::Data(data))
    } else if images > MOST_IMAGES {
        Err(PastLimit::Images(images))
    } else {
        Ok(())
    }
}
