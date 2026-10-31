//! Topos payloads reach the frontend in camelCase (#369). This test serializes a fixture of every
//! Topos payload and checks its keys, so a struct or variant missing `rename_all = "camelCase"`
//! fails here. Add each new Topos payload to `fixtures`.

use serde_json::{json, Value};

use super::checkout::RefsOutcome;
use super::ref_ops::BranchDeleted;
use super::remote_ops::{RemoteOutcome, SyncStatus};
use super::commit::{CommitContext, HeadCommit, Operation};
use super::conflict::{ConflictFile, ConflictReset, Eol, NotEditable, ConflictWriteResult};
use super::diff::{DiffLine, DiffSide, FileChange, FileDiff, Hunk, LineKind, ModeChange, StageResult};
use super::discard::{CopyResult, DiscardBackup, DiscardPathsResult};
use super::error::GitError;
use super::hand_off::HandOff;
use super::graph::{
    Author, Dirty, GitRefs, GraphEvent, RefBadge, RefKind, Refreshed, RepoChanged, Track, TrackKind, WatchState, WorktreeHead,
};
use super::op_runner::OpEvent;
use super::operation::{Conflict, ConflictKind, OpOutcome, OpState, SideLabel};
use super::settings::{DiffMode, FileListMode, RepoState, ToposSettings};
use super::speedup::{SpeedupCheck, SpeedupItem};
use super::staging::{EntryKind, StatusEntry, WorktreeStatus};
use super::version::GitVersionStatus;

fn s<T: serde::Serialize>(payload: &T) -> Value {
    serde_json::to_value(payload).expect("payload serializes")
}

fn fixtures() -> Vec<(&'static str, Value, Value)> {
    vec![
        ("GitVersionStatus::Ok", s(&GitVersionStatus::Ok), json!({ "status": "ok" })),
        ("GitVersionStatus::Missing", s(&GitVersionStatus::Missing), json!({ "status": "missing" })),
        (
            "GitVersionStatus::TooOld",
            s(&GitVersionStatus::TooOld { found: "2.30.1".into() }),
            json!({ "status": "tooOld", "found": "2.30.1" }),
        ),
        (
            "GitVersionStatus::Unknown",
            s(&GitVersionStatus::Unknown { raw: "git version ?".into() }),
            json!({ "status": "unknown", "raw": "git version ?" }),
        ),
        (
            "GitError::Other",
            s(&GitError::Other { stderr: "fatal: not a git repository".into() }),
            json!({ "kind": "other", "stderr": "fatal: not a git repository" }),
        ),
        ("GraphEvent::Started", s(&GraphEvent::Started { session_id: 3 }), json!({ "event": "started", "sessionId": 3 })),
        (
            "GraphEvent::Paused",
            s(&GraphEvent::Paused { session_id: 3, rows_loaded: 50_000 }),
            json!({ "event": "paused", "sessionId": 3, "rowsLoaded": 50_000 }),
        ),
        (
            "GraphEvent::Done",
            s(&GraphEvent::Done { session_id: 3, total: 12 }),
            json!({ "event": "done", "sessionId": 3, "total": 12 }),
        ),
        (
            "GraphEvent::Truncated",
            s(&GraphEvent::Truncated { session_id: 3, cap: 2_000_000 }),
            json!({ "event": "truncated", "sessionId": 3, "cap": 2_000_000 }),
        ),
        (
            "GraphEvent::Failed",
            s(&GraphEvent::Failed { session_id: 3, error: GitError::Other { stderr: "boom".into() } }),
            json!({ "event": "failed", "sessionId": 3, "error": { "kind": "other", "stderr": "boom" } }),
        ),
        (
            "GraphEvent::Splice",
            s(&GraphEvent::Splice {
                session_id: 3,
                replace_rows: 64,
                new_rows: 69,
                row_delta: 5,
                edges_from: 70,
                edges_to: 76,
                tracks_from: 4,
                tracks_to: 5,
                crossing_edges: vec![[68, 74]],
                live_tracks: vec![[0, 0]],
            }),
            json!({
                "event": "splice", "sessionId": 3, "replaceRows": 64, "newRows": 69, "rowDelta": 5,
                "edgesFrom": 70, "edgesTo": 76, "tracksFrom": 4, "tracksTo": 5,
                "crossingEdges": [[68, 74]], "liveTracks": [[0, 0]]
            }),
        ),
        ("GraphEvent::Reset", s(&GraphEvent::Reset { session_id: 3 }), json!({ "event": "reset", "sessionId": 3 })),
        ("Refreshed::Spliced", s(&Refreshed::Spliced { row_delta: -2 }), json!({ "kind": "spliced", "rowDelta": -2 })),
        (
            "GraphEvent::Watch",
            s(&GraphEvent::Watch { session_id: 3, watch: WatchState::Off { reason: "could not watch".into() } }),
            json!({ "event": "watch", "sessionId": 3, "watch": { "state": "off", "reason": "could not watch" } }),
        ),
        ("WatchState::Live", s(&WatchState::Live), json!({ "state": "live" })),
        ("WatchState::Gone", s(&WatchState::Gone), json!({ "state": "gone" })),
        (
            "RepoChanged",
            s(&RepoChanged {
                repo_root: "C:/repo".into(),
                worktree_path: "C:/repo-wt".into(),
                dirty: Dirty { refs: true, head: false, index: false, worktree: true, operation: false },
                in_operation: false,
            }),
            json!({
                "repoRoot": "C:/repo",
                "worktreePath": "C:/repo-wt",
                "dirty": { "refs": true, "head": false, "index": false, "worktree": true, "operation": false },
                "inOperation": false
            }),
        ),
        (
            "Refreshed::Reset",
            s(&Refreshed::Reset { searched_rows: 20_000 }),
            json!({ "kind": "reset", "searchedRows": 20_000 }),
        ),
        (
            "Author",
            s(&Author { name: "Ann".into(), email: "ann@example.invalid".into() }),
            json!({ "name": "Ann", "email": "ann@example.invalid" }),
        ),
        (
            "Track",
            s(&Track { id: 4, key: "feature/x".into(), kind: TrackKind::Derived, left: Some(0), right: None }),
            json!({ "id": 4, "key": "feature/x", "kind": "derived", "left": 0, "right": null }),
        ),
        (
            "GitRefs",
            s(&GitRefs {
                refs: vec![RefBadge { kind: RefKind::Remote, name: "origin/main".into(), oid: "abc".into() }],
                worktrees: vec![WorktreeHead { path: "C:/repo-wt".into(), oid: "abc".into(), branch: None }],
                tag_only_count: 30,
            }),
            json!({
                "refs": [{ "kind": "remote", "name": "origin/main", "oid": "abc" }],
                "worktrees": [{ "path": "C:/repo-wt", "oid": "abc", "branch": null }],
                "tagOnlyCount": 30
            }),
        ),
        ("RefKind::Local", s(&RefKind::Local), json!("local")),
        ("RefKind::Tag", s(&RefKind::Tag), json!("tag")),
        ("TrackKind::Default", s(&TrackKind::Default), json!("default")),
        ("TrackKind::Anonymous", s(&TrackKind::Anonymous), json!("anonymous")),
        ("GitError::Cancelled", s(&GitError::Cancelled), json!({ "kind": "cancelled" })),
        ("GitError::IndexLocked", s(&GitError::IndexLocked), json!({ "kind": "indexLocked" })),
        ("GitError::StagingBusy", s(&GitError::StagingBusy), json!({ "kind": "stagingBusy" })),
        ("GitError::StaleDiff", s(&GitError::StaleDiff), json!({ "kind": "staleDiff" })),
        (
            "GitError::HandedOff",
            s(&GitError::HandedOff { path: "a.txt".into(), agent: "claude 1".into() }),
            json!({ "kind": "handedOff", "path": "a.txt", "agent": "claude 1" }),
        ),
        (
            "GitError::CheckoutWouldOverwrite",
            s(&GitError::CheckoutWouldOverwrite { paths: vec!["a.txt".into()] }),
            json!({ "kind": "checkoutWouldOverwrite", "paths": ["a.txt"] }),
        ),
        (
            "GitError::BranchInOtherWorktree",
            s(&GitError::BranchInOtherWorktree { worktree: "C:/src/wt".into() }),
            json!({ "kind": "branchInOtherWorktree", "worktree": "C:/src/wt" }),
        ),
        (
            "GitError::InvalidRefName",
            s(&GitError::InvalidRefName { name: "a..b".into() }),
            json!({ "kind": "invalidRefName", "name": "a..b" }),
        ),
        (
            "GitError::NotFullyMerged",
            s(&GitError::NotFullyMerged { ahead: 2, tip: "abc".into() }),
            json!({ "kind": "notFullyMerged", "ahead": 2, "tip": "abc" }),
        ),
        ("GitError::RefExists", s(&GitError::RefExists { name: "v1".into() }), json!({ "kind": "refExists", "name": "v1" })),
        ("GitError::RefLocked", s(&GitError::RefLocked), json!({ "kind": "refLocked" })),
        (
            "BranchDeleted",
            s(&BranchDeleted { tip: "abc".into(), head: Some("def".into()), refs: GitRefs::default() }),
            json!({ "tip": "abc", "head": "def", "refs": { "refs": [], "worktrees": [], "tagOnlyCount": 0 } }),
        ),
        (
            "RefsOutcome",
            s(&RefsOutcome { head: Some("abc".into()), refs: GitRefs::default() }),
            json!({ "head": "abc", "refs": { "refs": [], "worktrees": [], "tagOnlyCount": 0 } }),
        ),
        ("GitError::NonFastForward", s(&GitError::NonFastForward { r#ref: "refs/heads/main".into() }), json!({ "kind": "nonFastForward", "ref": "refs/heads/main" })),
        (
            "GitError::NoUpstream",
            s(&GitError::NoUpstream { branch: "feat".into(), remotes: vec!["origin".into()] }),
            json!({ "kind": "noUpstream", "branch": "feat", "remotes": ["origin"] }),
        ),
        (
            "GitError::RemoteRejected",
            s(&GitError::RemoteRejected { r#ref: "refs/heads/main".into(), reason: "pre-receive hook declined".into(), remote_lines: vec!["no".into()] }),
            json!({ "kind": "remoteRejected", "ref": "refs/heads/main", "reason": "pre-receive hook declined", "remoteLines": ["no"] }),
        ),
        ("GitError::AuthFailed", s(&GitError::AuthFailed), json!({ "kind": "authFailed" })),
        ("GitError::HostKeyUnknown", s(&GitError::HostKeyUnknown), json!({ "kind": "hostKeyUnknown" })),
        ("GitError::Network", s(&GitError::Network), json!({ "kind": "network" })),
        ("GitError::DivergentPullNeedsStrategy", s(&GitError::DivergentPullNeedsStrategy), json!({ "kind": "divergentPullNeedsStrategy" })),
        (
            "RemoteOutcome",
            s(&RemoteOutcome {
                head: Some("abc".into()),
                refs: GitRefs::default(),
                conflicts: false,
                sync: SyncStatus { branch: Some("main".into()), upstream: Some("origin/main".into()), ahead: 1, behind: 2, fetched_at_ms: Some(5) },
            }),
            json!({
                "head": "abc",
                "refs": { "refs": [], "worktrees": [], "tagOnlyCount": 0 },
                "conflicts": false,
                "sync": { "branch": "main", "upstream": "origin/main", "ahead": 1, "behind": 2, "fetchedAtMs": 5 }
            }),
        ),
        (
            "HandOff",
            s(&HandOff { path: "a.txt".into(), terminal_id: "t1".into(), agent_name: "claude 1".into() }),
            json!({ "path": "a.txt", "terminalId": "t1", "agentName": "claude 1" }),
        ),
        (
            "GitError::ChangedSinceDiscard",
            s(&GitError::ChangedSinceDiscard { paths: vec!["a.txt".into()] }),
            json!({ "kind": "changedSinceDiscard", "paths": ["a.txt"] }),
        ),
        (
            "GitError::HookFailed",
            s(&GitError::HookFailed { hook: "pre-commit".into(), output: "lint failed\n".into() }),
            json!({ "kind": "hookFailed", "hook": "pre-commit", "output": "lint failed\n" }),
        ),
        (
            "CommitContext",
            s(&CommitContext {
                operation: Operation::CherryPick,
                merge_message: Some("Merge branch 'main'\n".into()),
                branch: None,
                head: Some(HeadCommit { oid: "abc".into(), message: "init\n".into(), on_upstream: true }),
            }),
            json!({
                "operation": "cherryPick",
                "mergeMessage": "Merge branch 'main'\n",
                "branch": null,
                "head": { "oid": "abc", "message": "init\n", "onUpstream": true },
            }),
        ),
        ("GitError::NoOperation", s(&GitError::NoOperation), json!({ "kind": "noOperation" })),
        (
            "GitError::ConflictsRemain",
            s(&GitError::ConflictsRemain { count: 2 }),
            json!({ "kind": "conflictsRemain", "count": 2 }),
        ),
        (
            "OpOutcome",
            s(&OpOutcome {
                head: Some("abc".into()),
                state: OpState {
                    kind: Operation::Rebase,
                    step: Some(1),
                    total: Some(3),
                    left_label: Some(SideLabel { role: "Onto".into(), name: "main @abc1234".into() }),
                    right_label: Some(SideLabel { role: "Replaying".into(), name: "Fix it".into() }),
                    message: Some("Fix it\n".into()),
                    conflicts: vec![Conflict { path: "a.txt".into(), xy: "DU".into(), kind: ConflictKind::DeletedByUs }],
                    conflicts_total: 1,
                },
            }),
            json!({
                "head": "abc",
                "state": {
                    "kind": "rebase", "step": 1, "total": 3,
                    "leftLabel": { "role": "Onto", "name": "main @abc1234" },
                    "rightLabel": { "role": "Replaying", "name": "Fix it" },
                    "message": "Fix it\n",
                    "conflicts": [{ "path": "a.txt", "xy": "DU", "kind": "deletedByUs" }],
                    "conflictsTotal": 1,
                },
            }),
        ),
        ("GitError::ConflictStale", s(&GitError::ConflictStale), json!({ "kind": "conflictStale" })),
        (
            "ConflictReset",
            s(&ConflictReset {
                file: ConflictFile {
                    path: "a.txt".into(),
                    xy: "UU".into(),
                    kind: ConflictKind::BothModified,
                    on_disk: true,
                    left_oid: Some("l1".into()),
                    right_oid: None,
                    token: "b:l:r:w".into(),
                    editable: true,
                    reason: None,
                    left: Some("l".into()),
                    right: Some("r".into()),
                    result: Some("m".into()),
                    eol: Eol::Crlf,
                    bom: true,
                    marker_size: 7,
                },
                backup: DiscardBackup { path: "a.txt".into(), blob: Some("b1".into()), after: Some("b2".into()) },
            }),
            json!({
                "file": {
                    "path": "a.txt", "xy": "UU", "kind": "bothModified", "onDisk": true, "leftOid": "l1", "rightOid": null, "token": "b:l:r:w", "editable": true, "reason": null,
                    "left": "l", "right": "r", "result": "m", "eol": "crlf", "bom": true, "markerSize": 7,
                },
                "backup": { "path": "a.txt", "blob": "b1", "after": "b2" },
            }),
        ),
        ("NotEditable::MixedLineEndings", s(&NotEditable::MixedLineEndings), json!("mixedLineEndings")),
        (
            "ConflictWriteResult",
            s(&ConflictWriteResult {
                backup: DiscardBackup { path: "a.txt".into(), blob: None, after: Some("b2".into()) },
                status: WorktreeStatus { request_id: 5, entries: vec![], total: 0, truncated: false },
            }),
            json!({
                "backup": { "path": "a.txt", "blob": null, "after": "b2" },
                "status": { "requestId": 5, "entries": [], "total": 0, "truncated": false }
            }),
        ),
        (
            "DiscardPathsResult",
            s(&DiscardPathsResult {
                backups: vec![DiscardBackup { path: "a.txt".into(), blob: Some("b1".into()), after: None }],
                status: WorktreeStatus { request_id: 2, entries: vec![], total: 0, truncated: false },
            }),
            json!({
                "backups": [{ "path": "a.txt", "blob": "b1", "after": null }],
                "status": { "requestId": 2, "entries": [], "total": 0, "truncated": false }
            }),
        ),
        (
            "CopyResult",
            s(&CopyResult { paths: vec!["a (discarded).txt".into()], status: WorktreeStatus { request_id: 3, entries: vec![], total: 0, truncated: false } }),
            json!({ "paths": ["a (discarded).txt"], "status": { "requestId": 3, "entries": [], "total": 0, "truncated": false } }),
        ),
        (
            "DiffSide::Commit",
            s(&DiffSide::Commit { oid: "abc1".into(), parent: None }),
            json!({ "kind": "commit", "oid": "abc1", "parent": null }),
        ),
        ("DiffSide::Unstaged", s(&DiffSide::Unstaged), json!({ "kind": "unstaged" })),
        ("FileChange::Untracked", s(&FileChange::Untracked), json!("untracked")),
        ("LineKind::NoNewline", s(&LineKind::NoNewline), json!("noNewline")),
        (
            "StageResult",
            s(&StageResult {
                diff: FileDiff {
                    request_id: 4,
                    path: "src/a.rs".into(),
                    diff_token: "3.abc.0000000000000001".into(),
                    change: FileChange::Modified,
                    binary: false,
                    submodule: false,
                    too_large: false,
                    bytes: 120,
                    line_count: 2,
                    mode_change: Some(ModeChange { old_mode: "100644".into(), new_mode: "100755".into() }),
                    old_oid: Some("abc".into()),
                    new_oid: None,
                    hunks: vec![Hunk {
                        old_start: 1,
                        old_lines: 1,
                        new_start: 1,
                        new_lines: 1,
                        heading: "fn main()".into(),
                        lines: vec![DiffLine { kind: LineKind::Del, text: "a\r".into() }],
                    }],
                },
                status: WorktreeStatus { request_id: 5, entries: vec![], total: 0, truncated: false },
            }),
            json!({
                "diff": {
                    "requestId": 4, "path": "src/a.rs", "diffToken": "3.abc.0000000000000001", "change": "modified",
                    "binary": false, "submodule": false, "tooLarge": false, "bytes": 120, "lineCount": 2,
                    "modeChange": { "oldMode": "100644", "newMode": "100755" },
                    "oldOid": "abc", "newOid": null,
                    "hunks": [{
                        "oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1, "heading": "fn main()",
                        "lines": [{ "kind": "del", "text": "a\r" }]
                    }]
                },
                "status": { "requestId": 5, "entries": [], "total": 0, "truncated": false }
            }),
        ),
        (
            "WorktreeStatus",
            s(&WorktreeStatus {
                request_id: 12,
                entries: vec![
                    StatusEntry { path: "src/a.rs".into(), xy: ".M".into(), kind: EntryKind::Tracked },
                    StatusEntry { path: "notes".into(), xy: "??".into(), kind: EntryKind::UntrackedFolder },
                ],
                total: 10_001,
                truncated: true,
            }),
            json!({
                "requestId": 12,
                "entries": [
                    { "path": "src/a.rs", "xy": ".M", "kind": "tracked" },
                    { "path": "notes", "xy": "??", "kind": "untrackedFolder" }
                ],
                "total": 10_001,
                "truncated": true
            }),
        ),
        ("EntryKind::Untracked", s(&EntryKind::Untracked), json!("untracked")),
        ("EntryKind::Unmerged", s(&EntryKind::Unmerged), json!("unmerged")),
        (
            "OpEvent::Progress",
            s(&OpEvent::Progress { phase: "Receiving objects".into(), percent: Some(45) }),
            json!({ "event": "progress", "phase": "Receiving objects", "percent": 45 }),
        ),
        (
            "OpEvent::Progress without a percent",
            s(&OpEvent::Progress { phase: "Enumerating objects".into(), percent: None }),
            json!({ "event": "progress", "phase": "Enumerating objects" }),
        ),
        (
            "OpEvent::Output",
            s(&OpEvent::Output { chunk: "From origin
".into() }),
            json!({ "event": "output", "chunk": "From origin
" }),
        ),
        ("OpEvent::Stalled", s(&OpEvent::Stalled), json!({ "event": "stalled" })),
        ("OpEvent::Done", s(&OpEvent::Done), json!({ "event": "done" })),
        (
            "ToposSettings",
            s(&ToposSettings {
                graph_column_width: 300,
                inspector_width: 520,
                diff_mode: DiffMode::Split,
                file_list_mode: FileListMode::Tree,
                // The repo keys are paths, not field names, so the entry has its own fixture.
                repos: Default::default(),
            }),
            json!({ "graphColumnWidth": 300, "inspectorWidth": 520, "diffMode": "split", "fileListMode": "tree", "repos": {} }),
        ),
        (
            "RepoState",
            s(&RepoState { last_opened: 1_793_000_000_000, suppress_speedup: true }),
            json!({ "lastOpened": 1_793_000_000_000_i64, "suppressSpeedup": true }),
        ),
        (
            "SpeedupCheck",
            s(&SpeedupCheck {
                items: vec![SpeedupItem::CommitGraph, SpeedupItem::Fsmonitor, SpeedupItem::UntrackedCache],
                suppressed: false,
            }),
            json!({ "items": ["commitGraph", "fsmonitor", "untrackedCache"], "suppressed": false }),
        ),
        (
            "OpEvent::Failed",
            s(&OpEvent::Failed { error: GitError::Cancelled }),
            json!({ "event": "failed", "error": { "kind": "cancelled" } }),
        ),
    ]
}

/// Every object key in `value`, at any depth.
fn keys(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                out.push(k.clone());
                keys(v, out);
            }
        }
        Value::Array(items) => items.iter().for_each(|v| keys(v, out)),
        _ => {}
    }
}

fn is_camel_case(key: &str) -> bool {
    key.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && key.chars().all(|c| c.is_ascii_alphanumeric())
}

#[test]
fn every_payload_serializes_to_its_camel_case_fixture() {
    for (name, actual, expected) in fixtures() {
        assert_eq!(actual, expected, "{name} serialized differently from its fixture");
        let mut found = Vec::new();
        keys(&actual, &mut found);
        for key in found {
            assert!(is_camel_case(&key), "{name} has a key that isn't camelCase: {key}");
        }
    }
}
