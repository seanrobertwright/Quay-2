use serde::{Deserialize, Serialize};

/// A record kind the builder authors. Each kind lives in its own folder under
/// `<repo>/.praxis/`, so the folder, not the file, says what a definition is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PraxisKind {
    Graphs,
    Contracts,
    Grants,
    Triggers,
}

impl PraxisKind {
    /// The folder under `.praxis/` that holds this kind's files.
    pub fn folder(self) -> &'static str {
        match self {
            PraxisKind::Graphs => "graphs",
            PraxisKind::Contracts => "contracts",
            PraxisKind::Grants => "grants",
            PraxisKind::Triggers => "triggers",
        }
    }
}

/// Why a definition file can't be opened: it isn't valid JSON (with the position of the
/// error), isn't a JSON object, or couldn't be read at all.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProblem {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
}

impl FileProblem {
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), line: None, column: None }
    }
}

/// One file in a kind's folder. The id is the file name without `.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionEntry {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<FileProblem>,
}

/// A kind's definitions in id order. `truncated` is true when the folder held more
/// than the listing cap and the rest were left out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionList {
    pub entries: Vec<DefinitionEntry>,
    pub truncated: bool,
}

/// A definition as read from disk. When the file exists, exactly one of `content` and
/// `problem` is set, and `content_hash` is the hash of the bytes read; when it doesn't,
/// `missing` is true and none of them is set. For a graph, `layout` holds
/// `.praxis/layout/<id>.json` when that file exists and parses, and `layout_problem` says
/// why it was ignored when it doesn't parse.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionFile {
    pub id: String,
    pub kind: PraxisKind,
    pub missing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<FileProblem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_problem: Option<FileProblem>,
}

/// One node's position as the builder sends it on save.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct LayoutPosition {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

/// The canvas viewport as the builder sends it on save.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct LayoutViewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// A graph's layout as the builder sends it on save, written to
/// `.praxis/layout/<graph-id>.json`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct LayoutInput {
    pub nodes: Vec<LayoutPosition>,
    pub viewport: Option<LayoutViewport>,
}

/// Why a save didn't write: the file changed since the draft loaded it, or was deleted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictReason {
    Changed,
    Deleted,
}

/// What a save did. `Saved` carries the record as written and the hash of the written
/// bytes, which the draft records as its new base. A layout that failed to write after
/// the definition was saved is reported in `layout_error`, not as a failed save.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveOutcome {
    #[serde(rename_all = "camelCase")]
    Saved {
        content: serde_json::Value,
        content_hash: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        layout_error: Option<String>,
    },
    Conflict { reason: ConflictReason },
}
