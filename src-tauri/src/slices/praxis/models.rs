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
    pub const ALL: [PraxisKind; 4] = [PraxisKind::Graphs, PraxisKind::Contracts, PraxisKind::Grants, PraxisKind::Triggers];

    /// The kind whose files `folder` holds, or `None` for a folder that holds no kind's
    /// definitions, such as `layout`.
    pub fn from_folder(folder: &str) -> Option<PraxisKind> {
        PraxisKind::ALL.into_iter().find(|k| k.folder() == folder)
    }

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

/// A definition whose `id` isn't its file name: `found` is the id inside, or `None` when
/// the record has no string `id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdMismatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub found: Option<String>,
}

/// One file in a kind's folder. The id is the file name without `.json`. A file that
/// parses but whose `id` differs from its name carries `id_mismatch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionEntry {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<FileProblem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_mismatch: Option<IdMismatch>,
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

/// A draft's content as the builder sends it to a rename, so the references in unsaved
/// changes are rewritten along with those on disk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DraftContent {
    pub kind: PraxisKind,
    pub id: String,
    pub content: serde_json::Value,
}

/// The hash of a definition file's bytes before and after a rename rewrites it, so a draft
/// that loaded the old bytes can expect the new ones when it saves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HashChange {
    pub previous: String,
    pub next: String,
}

/// One file a rename writes: rewritten in place at `path`, or moved to `new_path`. Paths
/// are relative to the repository, with `/` separators. `hashes` is set for a definition
/// file whose content the rename writes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hashes: Option<HashChange>,
}

/// What a rename does, or did. A dry run fills `changes`, `unchecked` and `drafts` and
/// writes nothing. A rename that stops part-way says why in `error`; the files it wrote
/// before then stay, so a failure leaves duplicates, never losses.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameOutcome {
    /// Every file the rename writes, moves or rewrites.
    pub changes: Vec<FileChange>,
    /// Files that were searched for references but couldn't be read, so any references in
    /// them stay as they are.
    pub unchecked: Vec<String>,
    /// The drafts sent whose references the rename rewrites, with their content after it.
    pub drafts: Vec<DraftContent>,
    /// What the rename did, in order. Empty for a dry run.
    pub done: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// What a delete does, or did. A dry run fills `files`, `referrers` and `unchecked` and
/// moves nothing. A delete that stops part-way says why in `error`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOutcome {
    /// The files that go to the trash: the definition first, then the files that belong
    /// to it, such as a graph's layout.
    pub files: Vec<String>,
    /// The files that refer to the definition, which will refer to a missing one after it.
    pub referrers: Vec<String>,
    /// Files that were searched for references but couldn't be read.
    pub unchecked: Vec<String>,
    /// What the delete did, in order. Empty for a dry run.
    pub done: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
