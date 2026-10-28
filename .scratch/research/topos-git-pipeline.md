# Topos Git pipeline: IPC commands, streaming contracts, and Rust parsing

Research for #350, under the Topos map #347. Question: what Tauri IPC
commands, streaming contracts, and Rust parsing pipelines Topos needs for
(1) the commit graph, (2) status and diffs, and (3) staging and unstaging
hunks and lines safely.

Lane allocation and Bézier geometry belong to #348, and the virtualized
canvas to #351. This note covers the pipeline those two plug into: what
data they get, how it gets there, and in what shape.

Evidence sources:

- Quay `master` at `bb86450`.
- Git docs on git-scm.com.
- Tauri 2 docs and source.
- Openly licensed implementations: git's `add-patch.c`, lazygit, the VS Code
  Git extension, and gitui.
- Experiments run against git 2.55.0.windows.5 in a throwaway repo, plus a
  bare clone of a 15.7k-commit repo.

GitKraken was not consulted.

## 1. What Quay already has

- **The git slice is small and synchronous.**
  `src-tauri/src/slices/git/commands.rs` has five worktree commands:
  `is_git_repo`, `list_git_worktrees`, `create_git_worktree`,
  `check_git_worktree_clean` and `remove_git_worktree`. Each one is a
  `#[tauri::command] pub async fn ... -> Result<T, String>`. Each wraps a
  blocking `std::process::Command` in `tokio::task::spawn_blocking` and parses
  the full `output()`. `parse_worktree_porcelain` is the existing example of
  a pure parser with unit tests.
- **Every child process goes through `crate::spawn::hidden_command`.**
  `src-tauri/src/spawn.rs` sets `CREATE_NO_WINDOW` on Windows. The test
  `every_spawn_goes_through_hidden_command` fails the build if
  `Command::new` appears anywhere else. Topos must build its streaming
  processes as
  `tokio::process::Command::from(crate::spawn::hidden_command("git"))`. Tokio
  implements `From<std::process::Command>`, so the no-console flag is kept.
- **Streaming today uses global events only.** Rust calls
  `app_handle.emit("pty-output", PtyOutputPayload { terminal_id, data, seq })`
  in `slices/pty/session.rs`. It also emits `terminal-status`,
  `bridge-event`, `a2a-message-updated` and `machina-state-updated`.
  Frontends subscribe with `listen<T>(name, ...)`, for example in
  `src/slices/terminal/useTerminal.ts`. Nothing in the repo uses
  `tauri::ipc::Channel` yet, so Topos would be its first user.
- **Naming conventions.** Commands are snake_case and registered in
  `tauri::generate_handler!` in `src-tauri/src/lib.rs`. The frontend calls
  `invoke<T>("name", { camelCaseArgs })`; for example, `useWorkspace.ts` calls
  `list_git_worktrees` with `{ projectPath }`. The git slice's models use
  snake_case fields on both sides: `GitWorktree` in `models.rs` and in
  `src/slices/git/types.ts`. The machina slice uses
  `#[serde(rename_all = "camelCase")]` instead. Topos should choose one
  convention and keep to it. Its payloads are new and large, so camelCase
  avoids renaming in the hot path on the frontend.
- **Missing pieces.** There is no file watcher (no `notify` crate in
  `Cargo.toml`) and no long-lived git process anywhere.

## 2. Transport: Channel for the graph stream, invoke for the rest, events for "repo changed"

The Tauri 2 docs page "Calling the Frontend from Rust"
(<https://v2.tauri.app/develop/calling-frontend/>) states the split directly.
The event system "is not designed for low latency or high throughput
situations". Event payloads are JSON strings evaluated as JavaScript, and an
async listener can see rapid events out of order. By contrast, "Channels are
designed to be fast and deliver ordered data", and Tauri uses them
internally for child-process output.

Facts from the source, `crates/tauri/src/ipc/channel.rs` in tauri-apps/tauri
(<https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/ipc/channel.rs>),
together with the `Channel` page on docs.rs
(<https://docs.rs/tauri/latest/tauri/ipc/struct.Channel.html>, tauri 2.12.5):

- `Channel<TSend: IpcResponse>::send(&self, data) -> tauri::Result<()>`.
  Any `Serialize` type is an `IpcResponse`.
- JSON payloads under `MAX_JSON_DIRECT_EXECUTE_THRESHOLD` (8192 bytes) are
  eval'd directly. Larger ones are queued and pulled with
  `plugin:__TAURI_CHANNEL__|fetch`, which is faster for big bodies. Batching
  rows into messages of tens of KB therefore takes the fetch path. That is
  the intended path for bulk data.
- `InvokeResponseBody::Raw` arrives in JavaScript as an `ArrayBuffer`.
  `Channel<Vec<u8>>` does **not** do this; it serializes as a JSON array of
  numbers.
- Every message carries an index, and the JavaScript side buffers out-of-order
  arrivals. `onmessage` therefore sees messages in `send` order.

Recommendation:

| Data | Mechanism | Why |
| --- | --- | --- |
| Commit graph rows and edges, which can be 100k+ | `Channel<GraphEvent>` passed to `git_graph_open` | Ordered, fast, scoped to one caller and one session. |
| Status, one file's diff, commit details, refs | Plain `invoke` returning JSON | Bounded size, request/response shape. |
| "Repo changed" (index, HEAD or refs moved) | Global `app_handle.emit("git-repo-changed", { repoPath, kinds })` | Many consumers (Topos, Rail badges, the worktree list). Matches the `terminal-status` convention. Low rate. |

Start with JSON. Move the layout columns (row, lane and edge waypoints as
`u32`/`u16` arrays) to `InvokeResponseBody::Raw` only if profiling shows JSON
parsing on the frontend is the bottleneck.

## 3. Commit graph pipeline

### 3.1 Git invocation

```text
git -C <repo> --no-optional-locks -c core.quotePath=false log
    --no-color --no-show-signature
    --topo-order            (or --date-order; see open questions)
    -z
    --format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%ct%x00%s
    --branches --remotes --tags HEAD  [--exclude=... per user filter]
```

Environment: `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`.

Each choice and its reason:

- **Ordering.** Use `--topo-order` or `--date-order`. Both guarantee
  "no parents before all of its children are shown". `--topo-order` also
  avoids "showing commits on multiple lines of history intermixed". Source:
  git-log, "Commit Ordering" (<https://git-scm.com/docs/git-log>).
  Children-before-parents is the property an online lane allocator needs.
  The first time a hash appears is as a parent of a row already emitted, so
  a lane can be reserved for it before its own row arrives. Default
  `git log` ordering does not guarantee this under clock skew.
- **`-z` plus `%x00` separators, parsed as a fixed field count.** `-z`
  terminates records with NUL, and `%x00` emits a NUL byte (git-log,
  "PRETTY FORMATS"). A commit subject cannot carry a NUL, so
  "read 7 NUL-terminated fields per record" is unambiguous. Each field is
  decoded with `String::from_utf8_lossy`, never trusted as UTF-8.
  `%P` is a space-separated list: empty for a root commit, two or more
  hashes for a merge.
- **Keep the stream lean.** Fetch the body, trailers, signature status
  (`%G?`, which runs GPG per commit) and file stats on demand per commit,
  not in the stream. On the 15.7k-commit test repo the stream above is about
  3.2 MB. Extrapolated to 100k commits, that is roughly 20 MB.
- **Fetch refs separately; do not use `%D`.** Use
  `git for-each-ref --format=%(objectname)%00%(*objectname)%00%(refname)%00%(HEAD)%00%(upstream)`.
  `%(*objectname)` peels annotated tags to their commit. Join refs to rows by
  oid in Rust. Badges can then refresh after a fetch, push or checkout without
  re-running `log`. `%D` also depends on `log.excludeDecoration` and
  `--decorate-refs` configuration (git-log, `--decorate-refs`).
- **Name refs explicitly instead of `--all`.** `--all` pulls in every ref
  under `refs/`, including `refs/stash` and its index and untracked parents,
  and notes refs. Stash rendering is listed under "Not yet specified" on
  #347, so stash stays opt-in.
- **Neutralize user config that changes output.** Pass `--no-show-signature`;
  if `log.showSignature=true`, `git log` would otherwise inline GPG output
  (verified that the flag is accepted on 2.55). Pass `--no-color`. Pass
  `%aN`/`%aE` (mailmap applied) deliberately rather than relying on
  `log.mailmap`. Set `LC_ALL=C` so error text is stable enough to classify.

### 3.2 Commit-graph matters for time-to-first-row

Git 2.20's release notes say "the revision walker machinery learned to take
advantage of the commit generation numbers stored in the commit-graph file"
(<https://github.com/git/git/blob/master/Documentation/RelNotes/2.20.0.adoc>).
The `commit-graph write` options `--reachable`, `--changed-paths` and
`--split` are described at <https://git-scm.com/docs/git-commit-graph>.

Measured on a bare clone with 15,751 commits on Windows, warm cache, two runs
each. Treat these as rough: process start and antivirus add noise.

| Invocation | First byte | Full stream |
| --- | --- | --- |
| `--topo-order`, commit-graph disabled (`-c core.commitGraph=false`) | 939–1322 ms | 521–685 ms after first byte |
| `--topo-order`, with commit-graph | 128–174 ms | 321–907 ms |
| `--topo-order -n 500`, with commit-graph | 116–145 ms | 118–125 ms |
| `--topo-order -n 500`, without | 298–599 ms | 326–555 ms |

Without a commit-graph, `--topo-order` must walk the whole history before it
prints row 1. With one, rows stream almost at once. Topos should detect a
missing `objects/info/commit-graph` or `commit-graphs/` and **offer** to run
`git commit-graph write --reachable --split`. It should not write one
silently, because that changes the user's repo. Modern Git also writes the
graph during `gc` and `maintenance`.

### 3.3 Paging: one long-lived process with backpressure, never `--skip`

`--skip=<n>` re-walks and re-sorts from the tips on every page. That is
O(history) per page, and with `--topo-order` the work is front-loaded. Do
not page by re-running `log`.

Instead, use one `git log` child process per graph session:

```text
git log stdout ──read_until(b'\0')──▶ record parser ──▶ bounded mpsc (e.g. 4096)
   ──▶ layout task (lane allocator from #348, online) ──▶ batcher
   ──▶ Channel<GraphEvent>::send(RowsBatch) every N rows or ~16 ms
```

- The reader is `tokio::io::BufReader` over `ChildStdout`, calling
  `read_until(0, &mut buf)` once per field. The child is spawned with
  `kill_on_drop(true)`.
- **Backpressure is free.** When the layout task or the frontend falls
  behind, the bounded mpsc fills and the reader stops reading. The pipe then
  fills and `git` blocks on `write`. A soft cap, for example "stream the
  first 5,000 rows, then pause until `git_graph_more`", is just
  "stop reading". Resuming continues the same walk with no re-sort.
- **Layout runs in Rust, incrementally, and a row is final once emitted.**
  This needs #348's lane allocator to be online: the lane for row *i* depends
  only on rows ≤ *i*, plus at most a bounded lookahead buffered before
  emitting. If #348 picks an algorithm that needs the whole DAG, such as
  global crossing minimization, the first paint waits for the full walk.
  §6 lists this as an open question.
- **Pixel geometry stays in the frontend.** Rust emits lane indices and row
  indices, not pixels or SVG path strings. Bézier control points come from a
  pure TypeScript function of `(rowHeight, laneWidth, zoom)` over the
  `(row, lane)` waypoints. Zoom and density changes then never round-trip to
  Rust, and the payload stays O(rows + edges).
- **Memory.** About 200 bytes per commit in Rust (oid, parent indices,
  interned author, subject). At 100k commits that is roughly 20 MB per
  session. Bound it with a hard cap, for example 500k rows, and report
  `GraphEvent::Truncated` at the cap.

### 3.4 Payload shape

Rows reference parents by **row index** once known. Edges are emitted as
waypoint polylines when they close, so the frontend can index edges by row
span for virtualized rendering. Each edge is O(1) per parent link plus its
bends. Per-row pass-through segments would be O(rows × active lanes).

```rust
#[derive(Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum GraphEvent {
    /// First message. `sessionId` lets the frontend drop late messages after a restart.
    Started { session_id: u64, ref_snapshot_id: u64 },
    /// Rows `[start, start + rows.len())`, final once sent.
    Rows { session_id: u64, start: u32, rows: Vec<GraphRow>, edges: Vec<GraphEdge>,
           /// Edges still open below the last row: lane positions to draw "continues down".
           open_lanes: Vec<OpenLane> },
    /// Soft cap reached; reading paused until `git_graph_more`.
    Paused { session_id: u64, rows_loaded: u32 },
    /// Walk finished; `total` is exact.
    Done { session_id: u64, total: u32 },
    Truncated { session_id: u64, cap: u32 },
    Failed { session_id: u64, error: GitError },
}

#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct GraphRow {
    pub oid: String,            // full hex; sha1 or sha256 (`git rev-parse --show-object-format`)
    pub lane: u16,
    pub color: u16,             // palette index chosen by the allocator (#348), not a CSS color
    pub parent_count: u8,       // >1 = merge node shape
    pub author_name: String,
    pub author_email: String,   // frontend hashes for avatars; agent provenance (#353) keys on it
    pub author_time: i64,       // unix seconds; frontend formats via src/lib/dates.ts
    pub commit_time: i64,
    pub subject: String,
}

#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub child_row: u32,
    pub parent_row: u32,        // or u32::MAX for "parent outside the loaded/selected history"
    pub color: u16,
    /// (row, lane) waypoints from child to parent; first = (child_row, child lane),
    /// last = (parent_row, parent lane). Bends are where #348 shifts the lane.
    pub points: Vec<(u32, u16)>,
    pub kind: EdgeKind,         // FirstParent | MergeParent
}
```

Refs come separately from `git_refs`, keyed by oid, and the frontend joins
them to rows with an oid→row map that it builds as rows arrive.

### 3.5 Commands

```rust
#[tauri::command] async fn git_graph_open(repo_path: String, opts: GraphOptions,
    on_event: tauri::ipc::Channel<GraphEvent>, state: State<'_, GitSessions>) -> Result<u64, GitError>;
#[tauri::command] async fn git_graph_more(session_id: u64, rows: u32, state: ...) -> Result<(), GitError>;
#[tauri::command] async fn git_graph_close(session_id: u64, state: ...) -> Result<(), GitError>;
#[tauri::command] async fn git_refs(repo_path: String) -> Result<RefsSnapshot, GitError>;
#[tauri::command] async fn git_commit_details(repo_path: String, oid: String) -> Result<CommitDetails, GitError>;
#[tauri::command] async fn git_commit_files(repo_path: String, oid: String) -> Result<Vec<ChangedFile>, GitError>;
```

`GraphOptions`: `{ order: "topo" | "date", refs: RefSelection, softCap: u32 }`.

Opening a new session for the same repo and view cancels the old one: drop
the child and send no more messages. The frontend also discards any message
whose `sessionId` is not the current one. This is the stale-response guard
from the global rules.

Commit details and per-commit file lists are on-demand reads. Windows
process spawn costs tens of milliseconds, so use one long-lived
`git cat-file --batch` per repo for object reads (commit body, trailers,
blobs for side-by-side views). Use `git diff-tree -r -z --numstat --root -M <oid>`
for a commit's file list, and `git diff-tree -p` for a single file's patch.

### 3.6 Refresh

The simplest correct approach on `git-repo-changed` with kind `refs` or
`HEAD`: re-run the session in the background, swap it in when the first
batch lands, and keep the viewport anchored on the oid at the top of the
view. With a commit-graph, the first rows cost about 150 ms on the test repo.
An incremental prepend, `git rev-list --topo-order <new tips> ^<old tips>`,
is an optimization that only works if the allocator can renumber cheaply.
It is deferred (§6).

## 4. Status and diffs

### 4.1 Status

```text
git -C <repo> --no-optional-locks status --porcelain=v2 -z --branch --show-stash
    --untracked-files=normal --ignore-submodules=dirty
```

- Porcelain v2 is documented at <https://git-scm.com/docs/git-status>,
  section "Porcelain Format Version 2". Headers are `# branch.oid`,
  `# branch.head`, `# branch.upstream`, `# branch.ab +A -B` and `# stash N`.
  Parsers must ignore unknown headers.
  - `1 XY sub mH mI mW hH hI path` is an ordinary change.
  - `2 XY sub mH mI mW hH hI Xscore path<NUL>origPath` is a rename or copy.
    Under `-z` the original path is **an extra NUL-terminated field**.
  - `u XY sub m1 m2 m3 mW h1 h2 h3 path` is unmerged and feeds the 3-way
    resolver (#352).
  - `? path` is untracked and `! path` is ignored.
  - In `XY`, a dot means "unchanged". Tracked entries arrive in undefined
    order.
- **`--no-optional-locks` is mandatory for background polling.** The git-status
  docs warn that status refreshes and writes the index, and "when status is
  run in the background, the lock held during the write may conflict with
  other simultaneous processes, causing them to fail". This matters most in
  Quay, where agents run `git add` and `git commit` in terminals beside
  Topos. VS Code sets `GIT_OPTIONAL_LOCKS=0` on its status call (VS Code
  `extensions/git/src/git.ts`, `Repository.getStatus`). Verified on 2.55:
  `git --no-optional-locks status` succeeds while `.git/index.lock` exists.
- **Bound it.** VS Code's `getStatus` stops at `limit ?? 10000` entries,
  kills the child, and sets `didHitLimit`. Do the same, and return
  `{ truncated: true }` so the UI can say so. Use `-unormal` rather than
  `-uall` by default, so an un-ignored `node_modules` collapses to one
  entry.
- Keep `hI` (the index blob oid) for each entry. It is the preimage token for
  safe staging (§5.3).

Status returns one `invoke` result:
`StatusSnapshot { branch: BranchInfo, stash: u32, entries: Vec<StatusEntry>, truncated: bool }`.

### 4.2 One file's diff (staging inspector)

Use **plumbing** diff commands, as `git add -p` does. In git's `add-patch.c`,
`patch_mode_add.diff_cmd` is `diff-files` and `patch_mode_reset_head` uses
`diff-index --cached`. `parse_diff` adds
`--no-color --ignore-submodules=dirty -p`.

| Side | Command |
| --- | --- |
| Unstaged (index → worktree) | `git diff-files -p --no-color --no-ext-diff --full-index -U<ctx> -- <path>` |
| Staged (HEAD → index) | `git diff-index --cached -p --no-color --no-ext-diff --full-index -U<ctx> <HEAD or empty-tree> -- <path>` |
| Commit (parent → commit) | `git diff-tree -p --no-color --no-ext-diff --full-index -U<ctx> --root -M <oid> -- <path>` |

Environment for all three: `GIT_LITERAL_PATHSPECS=1`, `GIT_OPTIONAL_LOCKS=0`
and `LC_ALL=C`. Without `GIT_LITERAL_PATHSPECS`, a file named `*.ts` or
`:(glob)x` is read as a pathspec pattern.

Verified on 2.55: plumbing `diff-files` ignores `diff.noprefix`, `color.ui`
and `diff.external`. It does **not** ignore `diff.suppressBlankEmpty`, which
prints a blank context line as a bare `\n`. The parser must treat an empty
line inside a hunk as context, as `add-patch.c` `normalize_marker` does.

For an unborn HEAD, diff against the empty tree from
`git hash-object -t tree --stdin </dev/null`. That gives
`4b825dc642cb6eb9a060e54bf8d69288fbee4904` for sha1; never hard-code it,
because sha256 repos differ.

**Parser contract (Rust, pure, unit-tested like `parse_worktree_porcelain`):**

- Operate on bytes. Split lines on `\n` only. A trailing `\r` is part of the
  line's content and must round-trip byte-for-byte; the CRLF case is in
  §5.4.
- **Header lines.** Keep `diff --git`, mode lines (`old mode`, `new mode`,
  `new file mode`, `deleted file mode`), `index`, `---` and `+++` verbatim
  for patch reconstruction. Paths in these lines can be C-quoted, so take
  the display path from status, not from the patch header.
- **Hunks.** `@@ -a,b +c,d @@ section`. An omitted count means 1; `add-patch.c`
  `render_hunk` omits counts equal to 1.
- **Body lines.** ` `, `-`, `+`, an empty line (context), and
  `\ No newline at end of file`. The last is attached to the preceding line
  as a flag, not counted as a line, matching `add-patch.c` `split_hunk`:
  "Comment lines are attached to the previous line".
- **Binary.** A `Binary files ... differ` line, or `-\t-` in `--numstat`,
  marks the file `binary: true` with no hunks.
- **Cap.** Stop parsing past, for example, 20k lines or 2 MB per file and
  return `tooLarge: true` with a "load anyway" affordance.

```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub side: DiffSide,               // Unstaged | Staged | Commit { oid }
    pub diff_token: String,           // see §5.3: preimage oid + hash of the raw patch bytes
    pub binary: bool,
    pub too_large: bool,
    pub mode_change: Option<(String, String)>, // selectable on its own, like add -p's mode hunk
    pub new_file: bool, pub deleted_file: bool,
    pub hunks: Vec<Hunk>,
}
pub struct Hunk { pub old_start: u32, pub old_count: u32, pub new_start: u32, pub new_count: u32,
                  pub section: String, pub lines: Vec<DiffLine> }
pub struct DiffLine { pub kind: LineKind /* Context|Add|Del */, pub old_no: Option<u32>,
                      pub new_no: Option<u32>, pub text: String /* lossy UTF-8 for display */,
                      pub no_eol: bool }
```

Rust keeps the raw bytes for patch building. `text` is display-only.

A single file's diff is bounded by the cap, so it travels by `invoke`, not
by a Channel:

```rust
#[tauri::command] async fn git_status(repo_path: String) -> Result<StatusSnapshot, GitError>;
#[tauri::command] async fn git_file_diff(repo_path: String, path: String, side: DiffSide,
                                         context: u8) -> Result<FileDiff, GitError>;
```

## 5. Staging and unstaging hunks and lines

### 5.1 Approach: build a patch in Rust, apply with `git apply --cached` from stdin

Two openly licensed approaches exist:

- **Patch apply.** Git's `add -p` (`add-patch.c`: `patch_mode_add.apply_args = { "--cached" }`,
  and `{ "-R", "--cached" }` for `reset_head`) and lazygit
  (`pkg/commands/git_commands/patch.go` `applyPatchFile`, with
  `pkg/commands/patch/transform.go` `transformHunkLines`) build a reduced
  patch and run `git apply --cached [--reverse]`.
- **Blob replacement.** The VS Code extension (`git.ts`, `Repository.stage`:
  `hash-object --stdin -w --path` then `update-index --add --cacheinfo`) and
  gitui (`asyncgit/src/sync/staging/stage_tracked.rs` `stage_lines`: read the
  index blob, `apply_selection`, `repo.blob`, `index.add`) compute the new
  index content themselves and write it as a blob.

**Recommendation: patch apply**, as `add -p` does. Git keeps ownership of
filters, modes, intent-to-add entries, new and deleted files, and index
locking. Blob replacement has two risks. First, it must reimplement
clean-filter semantics: `hash-object --path` re-runs clean filters on content
that is already clean. Second, gitui's version rejects non-UTF-8 content
(`String::from_utf8`) and new files ("only non new files supported").

Pipe the patch through **stdin** (`git apply ... -`) instead of a temp file
(git-apply: "`-` can be used to read from the standard input"). lazygit writes
a timestamped `.patch` file under the OS temp directory. Stdin avoids
temp-file naming and cleanup entirely.

### 5.2 The selection transform (lazygit's rules, which match `add -p`)

lazygit's `transform.go` `transformHunkLines` works on one hunk. The
transform depends on direction:

| Line | Stage (`--cached`) | Unstage (`--cached -R`, from `diff-index --cached`) |
| --- | --- | --- |
| Context | keep | keep |
| Selected `+`/`-` | keep | keep |
| Unselected `-` | becomes context (` `) | dropped |
| Unselected `+` | dropped | becomes context (` `) |

In lazygit's terms: unselected "old-file" lines become context, unselected
"new-file" lines are dropped, and `Reverse` swaps which side is "old".
Context produced from unselected lines is buffered and flushed after the
selected additions in the same change block.

Recompute each hunk header from the kept lines:

- `old_count` = context + `-`; `new_count` = context + `+`.
- Carry a running offset into later hunks' new start.
- An empty side's start is adjusted by ±1, following the zero-length range
  convention.

These rules come from lazygit `transformHunkHeader` and `add-patch.c`
`recount_edited_hunk` and `reassemble_patch`. Drop hunks with no remaining
changes. If nothing is selected, do not call git at all.

Computing exact counts is the primary path. Also pass `--recount` as a
backstop: "Do not trust the line counts in the hunk headers, but infer them
by inspecting the patch". Verified: a header with wrong counts fails with
`corrupt patch` without `--recount` and applies with it. **Never** pass
`--unidiff-zero`. The docs call context-free patches "discouraged", and
context is what lets git reject a stale patch.

### 5.3 Safety rules, each verified against git 2.55 unless cited

1. **Pin the preimage: git apply will apply a stale patch at an offset.**
   Verified: a patch built against an index blob was applied to a different
   blob with two lines inserted above, and git reported
   "Hunk #1 succeeded at 5 (offset 2 lines)".
   - When a file has repeated blocks, a stale selection can therefore land in
     the wrong place without any error.
   - Rule: `diff_token` = the preimage oid (the `index <old>..<new>` line from
     `--full-index`, which equals status `hI` for the unstaged side) plus a
     hash of the raw patch bytes.
   - At stage time, re-run the same diff command and compare its token with
     the frontend's token. On mismatch, return `GitError::StaleDiff` and
     re-render. No patch is built from an out-of-date view.
   - This matters because agents in Quay terminals stage and commit
     concurrently.
2. **Check, then apply.** Run `git apply --cached --check --whitespace=nowarn --recount -`,
   then the same command without `--check`. `add-patch.c` keeps a separate
   `apply_check_args` for this purpose. The remaining window between check
   and apply is covered by git's own index lock and the context match.
3. **Always pass `--whitespace=nowarn`.** Verified: with the user's
   `apply.whitespace=fix` config, `git apply --cached` silently stripped the
   trailing spaces of a staged CRLF line ("1 line applied after fixing
   whitespace errors"). The staged content no longer matched the worktree.
   An explicit `--whitespace=nowarn` overrides the config.
4. **Treat a no-newline-at-EOF pair as atomic.** Original `a\nb` (no EOL),
   worktree `a\nb\nc\n`. The diff is context `a`, `-b`, `\ No newline`, `+b`, `+c`.
   - If the user selects only `+c`, the transform turns `-b` into context
     line `b` and keeps the `\ No newline` marker after it, then adds `+c`.
   - Verified: `git apply --cached --check` **accepts** this, and the index
     becomes `a\nbc\n`. The two lines are merged silently.
   - lazygit keeps the marker whenever the line before it is kept, and that
     produces exactly this patch.
   - Rule: a `-x` followed by `\ No newline` and its matching `+x` (the line
     whose only change is gaining a newline) forms one selection unit. If any
     `+` line after it in the hunk is selected, the pair is included
     automatically, or the UI greys out the later line until the pair is
     selected.
   - Selecting the pair alone is safe. Verified: the index becomes `a\nb\n`.
   - Add a property test: for random selections, the index blob after
     `git apply` must equal the content computed by a pure Rust "apply
     selection" model.
5. **Preserve CRLF bytes.** Verified both ways:
   - With `core.autocrlf=false` and CRLF stored in the blob, diff lines carry
     `\r` and the patch must keep them byte-for-byte. Parse as bytes, and
     never use `str::lines()` (it strips `\r`).
   - With `core.autocrlf=true`, the diff is already in normalized LF form,
     and `apply --cached` writes the LF blob correctly.
   - Because both sides of the round trip use the index (normalized) form,
     filters never run on a patch.
6. **Binary files, submodules and mode changes are whole-unit only.**
   - Binary: hunk or line staging is disabled. Stage with
     `git add -- <path>`; unstage with `git reset -q -- <path>`, or
     `git rm --cached -q -- <path>` when HEAD is unborn.
   - Submodules: excluded via `--ignore-submodules=dirty`, as `add -p` does.
   - Mode changes (`old mode`/`new mode` header lines) are a separate
     selectable unit, as in `add -p`. When the unit is not selected, strip
     those lines from the reconstructed header so a hunk stage does not also
     stage a `chmod`.
7. **Untracked files use intent-to-add.** Line-staging part of an untracked
   file runs `git add -N -- <path>` first. Verified on 2.55: `diff-files`
   then shows the file as `new file mode` against `/dev/null`, and a partial
   `+` subset of that patch applies with `--cached`. If the user then
   cancels, remove the intent-to-add entry so a stray ITA entry is not left
   behind.
8. **The index lock must be classified and retried, never deleted.**
   - Verified: with `.git/index.lock` present, `git apply --cached` exits 128
     with `fatal: Unable to create '.../index.lock': File exists.` followed by
     "Another git process seems to be running in this repository". VS Code
     maps that sentence to `GitErrorCodes.RepositoryIsLocked` in
     `getGitErrorCode`.
   - Rule: run writes with `LC_ALL=C`. On that message, retry with bounded
     backoff (for example 3 tries over about 1 s; agent git operations are
     short), then return `GitError::IndexLocked`.
   - Never remove `index.lock` automatically. A UI action may offer it only
     after confirmation.
   - Topos's own writes are serialized per git dir by an in-process
     `tokio::sync::Mutex`, to avoid self-contention. That mutex is a
     convenience. The actual enforcement is git's lock file, which the
     global rules call structural enforcement.
9. **Parse input at the boundary.**
   - `repo_path` is canonicalized and must be a registered Quay project or
     worktree.
   - `path` must come from the current status snapshot, which rejects `..`
     and absolute paths.
   - `oid` must match `^[0-9a-f]{40}([0-9a-f]{24})?$`, covering sha1 and
     sha256.
   - Line references are `(hunk, line)` indices checked against the
     recomputed diff.
   - All of this happens in Rust before any git process is spawned.
10. **Bound every non-streaming git call with a timeout,** for example 30 s for
    writes and 10 s for diffs. The existing worktree commands have none. On
    timeout, kill the child, which `kill_on_drop` does when the future is
    dropped.

### 5.4 Commands

```rust
#[tauri::command] async fn git_stage_selection(repo_path: String, req: StageRequest)
    -> Result<FileDiff, GitError>;   // returns the refreshed diff for that file and side
#[tauri::command] async fn git_stage_paths(repo_path: String, paths: Vec<String>) -> Result<(), GitError>;
#[tauri::command] async fn git_unstage_paths(repo_path: String, paths: Vec<String>) -> Result<(), GitError>;

#[derive(Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageRequest {
    pub path: String,
    pub side: DiffSide,               // Unstaged → stage; Staged → unstage (-R)
    pub diff_token: String,
    pub selection: Selection,         // File | Hunks(Vec<u32>) | Lines(Vec<(u32,u32)>) | ModeChange
}

#[derive(Serialize)] #[serde(tag = "kind", rename_all = "camelCase")]
pub enum GitError { StaleDiff, IndexLocked, NotARepo, GitMissing, TooLarge,
                    Timeout, Rejected { stderr: String }, Io { message: String } }
```

`GitError` is a tagged enum, not `String`, so the frontend can branch on
`StaleDiff` and `IndexLocked`. The existing git slice returns
`Result<_, String>`. Topos's commands are new, so a typed error does not
break any caller.

Discarding worktree lines with `git apply -R` without `--cached` uses the
same transform, but it destroys data. It is not part of this ticket's
question. If built, it needs a confirmation step, and the patch should be
kept for undo.

## 6. New open questions for later tickets

- **#348: is the lane allocator online?** Can row *i* be laid out from rows ≤
  *i* plus a bounded lookahead? If not, time-to-first-paint becomes the full
  walk, not about 150 ms. The `points` waypoint format in §3.4 assumes lane
  shifts happen at row boundaries.
- **#348/#351: `--topo-order` or `--date-order`?** Both satisfy
  children-before-parents, and the cost was similar in the measurements. The
  choice is visual: topo keeps branches contiguous; date interleaves them
  chronologically, as most graph UIs do.
- **Change detection.** Quay has no file watcher. Who emits
  `git-repo-changed`: a `notify` watcher on `.git/index`, `HEAD`, `refs/`,
  `packed-refs` and the worktree, a poll, or Quay's agent bridge? Polling
  status with `--no-optional-locks` every N seconds is the fallback. The
  watcher must resolve `.git` files for linked worktrees, which Quay creates
  heavily.
- **Incremental refresh versus full re-run** on new commits, which agents
  produce constantly. The answer depends on whether the allocator can
  renumber when rows are prepended.
- **Commit-graph offer UX.** When and how Topos suggests
  `git commit-graph write --reachable --split`, or `git maintenance start`,
  for big repos without one.
- **Large worktrees.** Whether Topos recommends `core.fsmonitor` and
  `core.untrackedCache` for status speed. They are user config, so Topos
  should never set them silently.
- **Binary transport.** Whether profiling at 100k rows justifies moving
  layout columns to `InvokeResponseBody::Raw` `ArrayBuffer`s.
- **Serde naming for Topos payloads.** The camelCase recommended here
  diverges from the git slice's existing snake_case `GitWorktree`.
- **Untracked file line-staging cancel semantics,** meaning cleanup of the
  intent-to-add entry, and whether Topos should ever leave one.
- **Minimum git version.** The behaviour above was verified on 2.55.
  `--no-optional-locks` needs 2.15 or later; ITA diff behaviour and
  generation-number walks (2.20) changed over time. Quay should check
  `git --version` once and refuse below a floor, for example 2.30.

## Sources

- Git: git-log <https://git-scm.com/docs/git-log>; git-status
  <https://git-scm.com/docs/git-status>; git-apply
  <https://git-scm.com/docs/git-apply>; git-diff-files (raw format,
  `--numstat`, `--full-index`, `--ita-invisible-in-index`)
  <https://git-scm.com/docs/git-diff-files>; git-commit-graph
  <https://git-scm.com/docs/git-commit-graph>; release notes 2.20.0
  <https://github.com/git/git/blob/master/Documentation/RelNotes/2.20.0.adoc>.
- Git source: `add-patch.c` (`patch_mode_add`, `patch_mode_reset_head`,
  `parse_diff`, `split_hunk`, `recount_edited_hunk`, `reassemble_patch`,
  `render_hunk`, `normalize_marker`)
  <https://github.com/git/git/blob/master/add-patch.c>.
- Tauri: "Calling the Frontend from Rust"
  <https://v2.tauri.app/develop/calling-frontend/>; `tauri::ipc::Channel`
  <https://docs.rs/tauri/latest/tauri/ipc/struct.Channel.html>;
  `crates/tauri/src/ipc/channel.rs` (`MAX_JSON_DIRECT_EXECUTE_THRESHOLD`,
  `MAX_RAW_DIRECT_EXECUTE_THRESHOLD`)
  <https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/ipc/channel.rs>.
- lazygit (MIT): `pkg/commands/patch/transform.go` (`transformHunkLines`,
  `transformHunkHeader`) and `pkg/commands/git_commands/patch.go`
  (`ApplyPatchOpts`, `applyPatchFile`, `SaveTemporaryPatch`)
  <https://github.com/jesseduffield/lazygit>.
- VS Code Git extension (MIT): `extensions/git/src/git.ts`
  (`Repository.stage`, `Repository.apply`, `Repository.getStatus`,
  `getGitErrorCode`) <https://github.com/microsoft/vscode>.
- gitui (MIT): `asyncgit/src/sync/staging/stage_tracked.rs` (`stage_lines`)
  <https://github.com/gitui-org/gitui>.
- Quay: `src-tauri/src/slices/git/commands.rs` (`create_git_command`,
  `parse_worktree_porcelain`), `src-tauri/src/spawn.rs` (`hidden_command`,
  `every_spawn_goes_through_hidden_command`),
  `src-tauri/src/slices/pty/session.rs` (`pty-output` emit),
  `src/slices/terminal/useTerminal.ts`, `src/slices/workspace/useWorkspace.ts`,
  `src/slices/git/types.ts`.
- Experiments: git 2.55.0.windows.5 on Windows 11, run in a scratch repo and
  in a bare clone of a 15,751-commit repository. Timings are warm-cache and
  approximate.
