//! The unsent answer: what the operator has put in a surface and not sent. It is held in memory only.
//! Nothing here that holds its values has `Debug`, so none of them can be logged by accident.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The most that is held of one surface, in bytes of JSON.
pub const UNSENT_LIMIT: usize = 256 * 1024;

/// A page's save of what is unsent in one surface.
#[derive(Deserialize)]
pub struct UnsentSave {
    /// The page that saves, as it was numbered when it opened.
    pub page: u64,
    /// Which of that page's saves it is. A later one is higher.
    pub save: u64,
    /// The order of the surface it was read from. A terminal may use an id again for another surface.
    pub order: u64,
    /// The revision it was read at.
    pub revision: u64,
    /// By path in the surface's data model, what differs from its accepted state.
    pub values: Map<String, Value>,
}

impl UnsentSave {
    pub fn is_too_large(&self) -> bool {
        // Values that came as JSON can be written as it again
        serde_json::to_vec(&self.values).map_or(true, |json| json.len() > UNSENT_LIMIT)
    }
}

/// What is unsent in a surface, as a page that loads is given it.
#[derive(Serialize)]
pub struct Unsent {
    pub terminal_id: String,
    pub id: String,
    pub order: u64,
    pub revision: u64,
    pub values: Map<String, Value>,
}

/// What a page of the webview is given when it opens.
#[derive(Serialize)]
pub struct Page {
    /// Its number, higher than any earlier page's.
    pub page: u64,
    pub unsent: Vec<Unsent>,
}

/// Why a save was not kept. What was kept before it still is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnsentRefused {
    /// The terminal has no such surface that is not settled.
    NoSuchSurface,
    /// It is over `UNSENT_LIMIT`.
    TooLarge,
    /// It was read from another revision than the surface has.
    OtherRevision,
    /// One that was made later is kept.
    OlderSave,
}
