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
    /// `aiws-graph-binding/1` documents (#247): how each dispatchable node of one graph runs.
    #[serde(rename = "graph-bindings")]
    GraphBindings,
}

impl PraxisKind {
    pub const ALL: [PraxisKind; 5] = [
        PraxisKind::Graphs,
        PraxisKind::Contracts,
        PraxisKind::Grants,
        PraxisKind::Triggers,
        PraxisKind::GraphBindings,
    ];

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
            PraxisKind::GraphBindings => "graph-bindings",
        }
    }

    /// The record field that holds a definition's id, which must equal its file name. A
    /// graph binding names itself `graphBindingId`, apart from a protocol binding's `bindingId`.
    pub fn id_field(self) -> &'static str {
        match self {
            PraxisKind::GraphBindings => "graphBindingId",
            _ => "id",
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
    /// A graph binding's `graphId`, when it is a string, so the list can nest it under its graph.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph_id: Option<String>,
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
/// why it was ignored when it doesn't parse. For a contract, `bindings` holds
/// `.praxis/bindings/<id>.json` the same way, with `bindings_hash` the hash of its bytes, so a
/// save can tell when it changed.
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bindings: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bindings_problem: Option<FileProblem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bindings_hash: Option<String>,
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

/// A contract's binding record as the builder sends it on save (#223): the graphs and grants
/// that run under the contract, written to `.praxis/bindings/<contract-id>.json`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BindingsInput {
    pub graphs: Vec<String>,
    pub grants: Vec<String>,
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
/// the definition was saved is reported in `layout_error`, not as a failed save, and so is
/// a contract's bindings file in `bindings_error`. `bindings_hash` is the hash of the
/// bindings file as written, when it was.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveOutcome {
    #[serde(rename_all = "camelCase")]
    Saved {
        content: serde_json::Value,
        content_hash: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        layout_error: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bindings_hash: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bindings_error: Option<String>,
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

/// The hash of a file's bytes before and after a rename rewrites it, a definition or a
/// contract's bindings file, so a draft that loaded the old bytes can expect the new ones
/// when it saves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HashChange {
    pub previous: String,
    pub next: String,
}

/// One file a rename writes: rewritten in place at `path`, or moved to `new_path`. Paths
/// are relative to the repository, with `/` separators. `hashes` is set for a file whose
/// content the rename writes: a definition, or a file belonging to one such as a bindings file.
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

/// The triggers whose `contractId` names a contract, in id order, and the trigger files
/// that couldn't be read or weren't searched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractTriggers {
    pub ids: Vec<String>,
    pub unchecked: Vec<String>,
}

/// A saved grant in a delegation chain, with its `limit` when that is a string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainLink {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<String>,
}

/// The grant that stopped a walk up a delegation chain, and why: it is missing, can't be
/// read, or is already in the chain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainBreak {
    pub id: String,
    pub message: String,
}

/// A contract whose bindings list a grant, and the grant's check on its scratch mission.
/// `problem` says why the contract couldn't be read, and then there is no `validation`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundContract {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<super::validate::Validation>,
}

/// A grant checked against the saved records around it (#223, #231): its delegation chain
/// from the root grant down to its parent, and each contract whose bindings list it.
/// `unchecked` names the bindings files that couldn't be read or weren't searched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantCheck {
    pub chain: Vec<ChainLink>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_break: Option<ChainBreak>,
    pub contracts: Vec<BoundContract>,
    pub unchecked: Vec<String>,
}

/// One cross-record issue (#223, #269): a record a contract's scratch mission refuses, or a
/// reference that names no record. `kind` and `id` name the record the issue is on, and
/// `contract` the contract whose mission found it. A binding entry that names no record is on
/// the contract, with the path `/bindings/<graphs|grants>/<index>` into its bindings file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordIssue {
    pub kind: PraxisKind,
    pub id: String,
    pub contract: String,
    #[serde(flatten)]
    pub diagnostic: super::validate::Diagnostic,
}

/// One contract checked across records: what its bindings file binds, the triggers that name
/// it, and what its scratch mission refused. `missing` is true when there is no contract file
/// (a trigger may still name it), and `problem` says why the file couldn't be read; in either
/// case no mission was opened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractContext {
    pub id: String,
    pub missing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
    pub graphs: Vec<String>,
    pub grants: Vec<String>,
    pub triggers: Vec<String>,
    pub issues: Vec<RecordIssue>,
    /// How many more issues were found than `issues` holds.
    pub omitted: usize,
}

/// The cross-record check of some contracts, in id order. `unchecked` names the bindings and
/// trigger files that couldn't be read or weren't searched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCheck {
    pub contracts: Vec<ContractContext>,
    pub unchecked: Vec<String>,
}

/// Names one definition, as the builder sends it to the cross-record check.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RecordRef {
    pub kind: PraxisKind,
    pub id: String,
}

/// How a definition file differs from the last commit: changed, new since it (untracked
/// or only staged), or deleted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeStatus {
    Modified,
    Added,
    Deleted,
}

/// A definition file with changes since the last commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub kind: PraxisKind,
    pub id: String,
    pub status: ChangeStatus,
}

/// The definitions of the kinds that show changes whose files have changed since the last
/// commit, in path order. Empty for a project that isn't a git repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFiles {
    pub files: Vec<ChangedFile>,
}

/// A definition file's diff against the last commit, as git's unified diff of `path`.
/// `status` is `None`, and `diff` empty, when the file hasn't changed since the commit.
/// `truncated` when the diff was cut at the cap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub status: Option<ChangeStatus>,
    pub diff: String,
    pub truncated: bool,
}

/// The ids used across the project's saved graph bindings (#247), each list distinct and sorted,
/// which the Runs as section suggests for its free-text id fields.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingSuggestions {
    pub agent_id: Vec<String>,
    pub protocol_binding_id: Vec<String>,
    pub action: Vec<String>,
    pub resource: Vec<String>,
}

/// What a graph binding pins (#247): a graph's `revision` and the SDK digest of the graph
/// record as saved on disk. `revision` is `None` when the graph has no string revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPin {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    pub digest: String,
}
