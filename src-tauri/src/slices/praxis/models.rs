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

/// A definition as read from disk. Exactly one of `content` and `problem` is set. For a
/// graph, `layout` holds `.praxis/layout/<id>.json` when that file exists and parses, and
/// `layout_problem` says why it was ignored when it doesn't parse.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionFile {
    pub id: String,
    pub kind: PraxisKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<FileProblem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_problem: Option<FileProblem>,
}
