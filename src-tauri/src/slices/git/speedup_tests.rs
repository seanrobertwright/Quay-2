//! The speed-ups (#369, #385) against real throwaway repos: what `speedup_check` offers, that
//! nothing is written before `speedup_apply`, and that apply writes only the ticked items.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};

use super::error::GitError;
use super::op_runner::{GitOps, OpEvent};
use super::settings::{ToposSettingsPatch, ToposSettingsStore};
use super::speedup::*;
use super::staging_tests::git;

/// A repo on `main` with a few commits and no commit-graph. Returns (root, repo).
fn repo() -> (PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("quay-speedup-{}", uuid::Uuid::new_v4().simple()));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    for (k, v) in [
        ("user.name", "Quay Test"),
        ("user.email", "quay@example.invalid"),
        ("core.hooksPath", ".git/no-hooks"),
        ("commit.gpgSign", "false"),
    ] {
        git(&repo, &["config", k, v]);
    }
    for i in 0..3 {
        std::fs::write(repo.join(format!("f{i}.txt")), format!("file {i}\n")).unwrap();
        git(&repo, &["add", "-A"]);
        git(&repo, &["commit", "-q", "-m", &format!("c{i}")]);
    }
    (root, repo)
}

fn store_path() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("quay-speedup-store-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("topos.json")
}

fn store() -> ToposSettingsStore {
    ToposSettingsStore::at(store_path())
}

/// The repo's own config file and the names under `objects/info`: everything a speed-up writes.
fn written_state(repo: &Path) -> (String, Vec<String>) {
    let config = std::fs::read_to_string(repo.join(".git/config")).unwrap();
    let mut info = Vec::new();
    for entry in walk(&repo.join(".git/objects/info")) {
        info.push(entry);
    }
    info.sort();
    (config, info)
}

fn walk(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for entry in entries.flatten() {
        let path = entry.path();
        out.push(path.to_string_lossy().into_owned());
        if path.is_dir() {
            out.extend(walk(&path));
        }
    }
    out
}

/// What `fsmonitor` is offered as on this machine's temp dir: only on Windows and macOS, where git
/// has a built-in fsmonitor daemon, and only on a local disk.
fn fsmonitor_offered() -> bool {
    cfg!(any(windows, target_os = "macos"))
}

#[test]
fn a_fresh_repo_is_offered_every_item_and_the_check_writes_nothing() {
    let (root, repo) = repo();
    let before = written_state(&repo);

    let check = speedup_check(&repo, &store()).unwrap();

    let mut expected = vec![SpeedupItem::CommitGraph];
    if fsmonitor_offered() {
        expected.push(SpeedupItem::Fsmonitor);
    }
    expected.push(SpeedupItem::UntrackedCache);
    assert_eq!(check, SpeedupCheck { items: expected, suppressed: false });
    assert_eq!(written_state(&repo), before, "the check wrote to the repo");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn fsmonitor_is_offered_only_where_the_disk_is_known_to_be_local() {
    let (root, repo) = repo();
    assert_eq!(fsmonitor_supported(&repo), fsmonitor_offered());
    // A network share, and a path that can't be looked at, are never known to be local.
    assert!(!fsmonitor_supported(Path::new(r"\\quay-no-such-host.invalid\share\repo")));
    assert!(!fsmonitor_supported(&root.join("no-such-folder")));
    let _ = std::fs::remove_dir_all(root);
}

/// A channel that keeps every event it is sent, as the JSON the frontend would receive.
fn test_channel() -> (Channel<OpEvent>, Arc<Mutex<Vec<Value>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let channel = Channel::new(move |body| {
        let json = match body {
            InvokeResponseBody::Json(s) => s,
            InvokeResponseBody::Raw(bytes) => String::from_utf8(bytes).unwrap(),
        };
        sink.lock().unwrap().push(serde_json::from_str(&json).unwrap());
        Ok(())
    });
    (channel, events)
}

/// The repo-local value of `key`, or None when the repo's own config doesn't set it.
fn local_config(repo: &Path, key: &str) -> Option<String> {
    let out = crate::spawn::hidden_command("git")
        .current_dir(repo)
        .args(["config", "--local", "--get", key])
        .output()
        .unwrap();
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn apply(repo: &Path, items: &[SpeedupItem]) -> (Result<(), GitError>, Vec<Value>) {
    let (channel, events) = test_channel();
    let result = speedup_apply(repo, items, uuid::Uuid::new_v4(), &GitOps::default(), &channel);
    let events = events.lock().unwrap().clone();
    (result, events)
}

#[test]
fn apply_writes_only_the_ticked_config_item() {
    let (root, repo) = repo();

    let (result, events) = apply(&repo, &[SpeedupItem::UntrackedCache]);

    assert_eq!(result, Ok(()));
    assert_eq!(events.last(), Some(&json!({ "event": "done" })));
    assert_eq!(local_config(&repo, "core.untrackedCache").as_deref(), Some("true"));
    assert_eq!(local_config(&repo, "core.fsmonitor"), None, "an unticked item was written");
    assert!(!repo.join(".git/objects/info/commit-graphs").exists(), "an unticked commit-graph was written");
    assert!(!repo.join(".git/objects/info/commit-graph").exists(), "an unticked commit-graph was written");
    // Once in place, the item is no longer offered.
    let items = speedup_check(&repo, &store()).unwrap().items;
    assert!(!items.contains(&SpeedupItem::UntrackedCache), "{items:?}");
    assert!(items.contains(&SpeedupItem::CommitGraph), "{items:?}");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn the_commit_graph_write_streams_progress_and_writes_no_config() {
    let (root, repo) = repo();
    let config_before = std::fs::read_to_string(repo.join(".git/config")).unwrap();

    let (result, events) = apply(&repo, &[SpeedupItem::CommitGraph]);

    assert_eq!(result, Ok(()));
    assert!(events.iter().any(|e| e["event"] == "progress"), "no progress in {events:?}");
    assert_eq!(events.last(), Some(&json!({ "event": "done" })));
    assert!(repo.join(".git/objects/info/commit-graphs/commit-graph-chain").is_file(), "no split commit-graph");
    assert_eq!(std::fs::read_to_string(repo.join(".git/config")).unwrap(), config_before);
    let items = speedup_check(&repo, &store()).unwrap().items;
    assert!(!items.contains(&SpeedupItem::CommitGraph), "{items:?}");
    assert!(items.contains(&SpeedupItem::UntrackedCache), "{items:?}");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn ticking_every_item_writes_each_or_refuses_all_where_fsmonitor_cant_run() {
    let (root, repo) = repo();
    let before = written_state(&repo);

    let (result, events) = apply(&repo, &[SpeedupItem::UntrackedCache, SpeedupItem::Fsmonitor, SpeedupItem::CommitGraph]);

    if fsmonitor_offered() {
        assert_eq!(result, Ok(()));
        assert_eq!(local_config(&repo, "core.fsmonitor").as_deref(), Some("true"));
        assert_eq!(local_config(&repo, "core.untrackedCache").as_deref(), Some("true"));
        assert_eq!(speedup_check(&repo, &store()).unwrap().items, []);
    } else {
        assert!(matches!(result, Err(GitError::Other { .. })), "{result:?}");
        assert_eq!(events.last().unwrap()["event"], "failed");
        assert_eq!(written_state(&repo), before, "a refused apply wrote to the repo");
    }
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn dont_suggest_is_remembered_in_the_repos_topos_json_entry() {
    let (other_root, other) = repo();
    let (root, repo) = repo();
    let path = store_path();
    let store = ToposSettingsStore::at(path.clone());
    let before = written_state(&repo);

    store.write(ToposSettingsPatch { suppress_speedup: Some(repo.to_string_lossy().into_owned()), ..Default::default() }).unwrap();
    store.flush().unwrap();

    assert!(speedup_check(&repo, &store).unwrap().suppressed);
    // It is the repo's entry, so it outlives Quay's restart.
    let reopened = ToposSettingsStore::at(path.clone());
    assert!(speedup_check(&repo, &reopened).unwrap().suppressed);
    let file: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let entries: Vec<&Value> = file["repos"].as_object().unwrap().values().collect();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["suppressSpeedup"], true);
    // Another repo is still offered its speed-ups.
    assert!(!speedup_check(&other, &reopened).unwrap().suppressed);
    assert_eq!(written_state(&repo), before, "turning the banner away wrote to the repo");
    let _ = std::fs::remove_dir_all(root);
    let _ = std::fs::remove_dir_all(other_root);
}

#[test]
fn apply_takes_only_the_three_known_items() {
    let items: Vec<SpeedupItem> = serde_json::from_value(json!(["commitGraph", "fsmonitor", "untrackedCache"])).unwrap();
    assert_eq!(items, [SpeedupItem::CommitGraph, SpeedupItem::Fsmonitor, SpeedupItem::UntrackedCache]);
    // A command, a config key or a differently cased name is refused before anything runs.
    for bad in [json!("core.fsmonitor"), json!("git gc"), json!("CommitGraph"), json!({ "key": "core.fsmonitor" }), json!(1)] {
        assert!(serde_json::from_value::<SpeedupItem>(bad.clone()).is_err(), "{bad} was accepted");
    }
}
