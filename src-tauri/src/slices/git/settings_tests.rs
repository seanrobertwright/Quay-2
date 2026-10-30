//! `topos.json` through its store: what a read returns for a given file, what a write leaves on
//! disk, and which repo entries survive the cap.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::json;

use super::error::GitError;
use super::settings::*;
use super::staging_tests::repo_with_worktree;

fn temp_path() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("quay-topos-settings-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("topos.json")
}

fn defaults() -> ToposSettings {
    ToposSettings {
        graph_column_width: 220,
        inspector_width: 400,
        diff_mode: DiffMode::Unified,
        file_list_mode: FileListMode::Flat,
        repos: BTreeMap::new(),
    }
}

#[test]
fn a_missing_file_reads_as_the_defaults() {
    let path = temp_path();

    assert_eq!(ToposSettingsStore::at(path.clone()).read(), defaults());
    assert!(!path.exists());
}

#[test]
fn a_file_of_valid_prefs_reads_back_as_written() {
    let path = temp_path();
    std::fs::write(
        &path,
        r#"{ "graphColumnWidth": 300, "inspectorWidth": 520, "diffMode": "split", "fileListMode": "tree", "repos": {} }"#,
    )
    .unwrap();

    assert_eq!(
        ToposSettingsStore::at(path).read(),
        ToposSettings {
            graph_column_width: 300,
            inspector_width: 520,
            diff_mode: DiffMode::Split,
            file_list_mode: FileListMode::Tree,
            ..defaults()
        }
    );
}

#[test]
fn each_bad_value_falls_back_to_its_own_default() {
    let path = temp_path();
    // NaN isn't JSON, so a NaN width reaches the file as a string or null; each is refused alone.
    for (graph, inspector, diff, list) in [
        (r#""NaN""#, "-1", r#""side-by-side""#, "3"),
        ("null", "0", "null", r#""Tree""#),
        ("47", "279", r#""SPLIT""#, r#""folders""#),
        ("657", "721", "{}", "[]"),
        ("220.5", "1e9", "true", r#""""#),
    ] {
        std::fs::write(
            &path,
            format!(r#"{{ "graphColumnWidth": {graph}, "inspectorWidth": {inspector}, "diffMode": {diff}, "fileListMode": {list} }}"#),
        )
        .unwrap();
        assert_eq!(ToposSettingsStore::at(path.clone()).read(), defaults(), "{graph} {inspector} {diff} {list}");
    }
}

#[test]
fn a_good_value_survives_beside_a_bad_one() {
    let path = temp_path();
    std::fs::write(&path, r#"{ "graphColumnWidth": 9999, "inspectorWidth": 600, "diffMode": "split", "fileListMode": 7 }"#).unwrap();

    assert_eq!(
        ToposSettingsStore::at(path).read(),
        ToposSettings { inspector_width: 600, diff_mode: DiffMode::Split, ..defaults() }
    );
}

#[test]
fn the_width_bounds_are_the_frontends() {
    let path = temp_path();
    std::fs::write(&path, r#"{ "graphColumnWidth": 48, "inspectorWidth": 280 }"#).unwrap();
    assert_eq!(ToposSettingsStore::at(path.clone()).read(), ToposSettings { graph_column_width: 48, inspector_width: 280, ..defaults() });
    std::fs::write(&path, r#"{ "graphColumnWidth": 656, "inspectorWidth": 720 }"#).unwrap();
    assert_eq!(ToposSettingsStore::at(path).read(), ToposSettings { graph_column_width: 656, inspector_width: 720, ..defaults() });
}

#[test]
fn a_corrupt_file_reads_as_the_defaults() {
    let path = temp_path();
    for text in ["not json", "", "[1, 2]", "\"split\"", r#"{ "graphColumnWidth": 300"#] {
        std::fs::write(&path, text).unwrap();
        assert_eq!(ToposSettingsStore::at(path.clone()).read(), defaults(), "{text:?}");
    }
}

fn patch(json: serde_json::Value) -> ToposSettingsPatch {
    serde_json::from_value(json).expect("a valid patch")
}

/// Waits up to `limit` for `path` to exist and returns whether it did.
fn wait_for(path: &std::path::Path, limit: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < limit {
        if path.exists() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    path.exists()
}

#[test]
fn writes_reach_the_file_together_once_they_have_been_quiet_for_500_ms() {
    let path = temp_path();
    let store = ToposSettingsStore::at(path.clone());

    let first = store.write(patch(json!({ "graphColumnWidth": 300 }))).unwrap();
    assert_eq!(first, ToposSettings { graph_column_width: 300, ..defaults() });
    std::thread::sleep(Duration::from_millis(300));
    let second = store.write(patch(json!({ "diffMode": "split" }))).unwrap();
    let last_write = Instant::now();
    assert_eq!(second, ToposSettings { graph_column_width: 300, diff_mode: DiffMode::Split, ..defaults() });
    assert_eq!(store.read(), second);

    std::thread::sleep(Duration::from_millis(300));
    assert!(!path.exists(), "written 300 ms after the last write");
    assert!(wait_for(&path, Duration::from_secs(3)), "never written");
    assert!(last_write.elapsed() >= Duration::from_millis(500));
    assert_eq!(ToposSettingsStore::at(path).read(), second);
}

#[test]
fn a_patch_with_a_width_out_of_range_is_refused_whole() {
    let path = temp_path();
    let store = ToposSettingsStore::at(path.clone());

    for bad in [json!({ "graphColumnWidth": 47, "diffMode": "split" }), json!({ "inspectorWidth": 721 }), json!({ "inspectorWidth": 0 })] {
        assert!(matches!(store.write(patch(bad.clone())), Err(GitError::Other { .. })), "{bad}");
    }
    assert_eq!(store.read(), defaults());
    std::thread::sleep(WRITE_DEBOUNCE + Duration::from_millis(200));
    assert!(!path.exists());
}

#[test]
fn a_patch_with_an_unknown_mode_field_or_a_fraction_does_not_parse() {
    for bad in [
        json!({ "diffMode": "sideBySide" }),
        json!({ "fileListMode": "folders" }),
        json!({ "theme": "dark" }),
        json!({ "graphOrder": "topo" }),
        json!({ "graphColumnWidth": 220.5 }),
        json!({ "inspectorWidth": -1 }),
    ] {
        assert!(serde_json::from_value::<ToposSettingsPatch>(bad.clone()).is_err(), "{bad}");
    }
}

/// The key a repo's entry should have: its `.git` folder, resolved, with forward slashes, and in
/// lower case where the file system ignores case.
fn expected_key(repo: &Path) -> String {
    let resolved = std::fs::canonicalize(repo.join(".git")).unwrap().to_string_lossy().replace('\\', "/");
    let resolved = resolved.strip_prefix("//?/").unwrap_or(&resolved).to_string();
    if cfg!(any(windows, target_os = "macos")) { resolved.to_lowercase() } else { resolved }
}

#[test]
fn a_repo_and_its_worktrees_share_one_entry_keyed_by_the_common_git_dir() {
    let (root, worktree) = repo_with_worktree();
    let repo = root.join("repo");
    let path = temp_path();
    let store = ToposSettingsStore::at(path.clone());

    let before = crate::dates::now_ms();
    store.write(patch(json!({ "openedRepo": repo.to_string_lossy() }))).unwrap();
    let after_repo = store.read();
    store.write(patch(json!({ "openedRepo": worktree.to_string_lossy() }))).unwrap();
    let after_worktree = store.read();

    let key = expected_key(&repo);
    assert_eq!(after_repo.repos.keys().collect::<Vec<_>>(), vec![&key]);
    assert_eq!(after_worktree.repos.keys().collect::<Vec<_>>(), vec![&key]);
    let first = after_repo.repos[&key].last_opened;
    assert!(first >= before && first <= crate::dates::now_ms());
    assert!(after_worktree.repos[&key].last_opened >= first);

    store.flush().unwrap();
    assert_eq!(ToposSettingsStore::at(path).read(), after_worktree);
}

#[cfg(windows)]
#[test]
fn on_windows_a_repo_opened_by_a_differently_cased_path_is_the_same_entry() {
    let (root, _) = repo_with_worktree();
    let repo = root.join("repo");
    let store = ToposSettingsStore::at(temp_path());

    store.write(patch(json!({ "openedRepo": repo.to_string_lossy() }))).unwrap();
    store.write(patch(json!({ "openedRepo": repo.to_string_lossy().to_uppercase() }))).unwrap();

    assert_eq!(store.read().repos.keys().collect::<Vec<_>>(), vec![&expected_key(&repo)]);
}

#[test]
fn opening_a_folder_that_is_not_a_repo_is_refused_and_records_nothing() {
    let path = temp_path();
    let store = ToposSettingsStore::at(path.clone());

    let folder = path.parent().unwrap().to_string_lossy().into_owned();
    assert!(matches!(store.write(patch(json!({ "openedRepo": folder }))), Err(GitError::Other { .. })));
    assert_eq!(store.read(), defaults());
}

/// A `topos.json` holding `count` repo entries, `old/repo-N/.git` opened at N ms.
fn file_with_repos(count: i64) -> String {
    let repos: serde_json::Map<String, serde_json::Value> =
        (1..=count).map(|n| (format!("c:/old/repo-{n}/.git"), json!({ "lastOpened": n }))).collect();
    json!({ "repos": repos }).to_string()
}

#[test]
fn opening_a_201st_repo_evicts_the_least_recently_opened() {
    let (root, _) = repo_with_worktree();
    let repo = root.join("repo");
    let path = temp_path();
    std::fs::write(&path, file_with_repos(200)).unwrap();
    let store = ToposSettingsStore::at(path.clone());
    assert_eq!(store.read().repos.len(), 200);

    let after = store.write(patch(json!({ "openedRepo": repo.to_string_lossy() }))).unwrap();

    assert_eq!(after.repos.len(), MAX_REPOS);
    assert!(!after.repos.contains_key("c:/old/repo-1/.git"));
    assert!(after.repos.contains_key("c:/old/repo-2/.git"));
    assert!(after.repos.contains_key(&expected_key(&repo)));
    store.flush().unwrap();
    assert_eq!(ToposSettingsStore::at(path).read(), after);
}

#[test]
fn reopening_a_kept_repo_evicts_nothing() {
    let (root, _) = repo_with_worktree();
    let repo = root.join("repo");
    let store = ToposSettingsStore::at(temp_path());
    store.write(patch(json!({ "openedRepo": repo.to_string_lossy() }))).unwrap();
    let path = temp_path();
    let mut seeded: serde_json::Value = serde_json::from_str(&file_with_repos(199)).unwrap();
    seeded["repos"][expected_key(&repo)] = json!({ "lastOpened": 0 });
    std::fs::write(&path, seeded.to_string()).unwrap();
    let store = ToposSettingsStore::at(path);

    let after = store.write(patch(json!({ "openedRepo": repo.to_string_lossy() }))).unwrap();

    assert_eq!(after.repos.len(), 200);
    assert!(after.repos.contains_key("c:/old/repo-1/.git"));
    assert!(after.repos[&expected_key(&repo)].last_opened > 0);
}

#[test]
fn a_file_over_the_cap_reads_as_its_200_most_recently_opened_repos() {
    let path = temp_path();
    std::fs::write(&path, file_with_repos(205)).unwrap();

    let repos = ToposSettingsStore::at(path).read().repos;

    let mut kept: Vec<i64> = repos.values().map(|r| r.last_opened).collect();
    kept.sort();
    assert_eq!(kept, (6..=205).collect::<Vec<_>>());
}

#[test]
fn a_repo_entry_with_a_bad_last_opened_time_is_dropped_alone() {
    let path = temp_path();
    std::fs::write(
        &path,
        r#"{ "repos": { "c:/a/.git": { "lastOpened": 5 }, "c:/b/.git": { "lastOpened": "yesterday" }, "c:/c/.git": { "lastOpened": -3 }, "c:/d/.git": 7, "c:/e/.git": { "lastOpened": 1.5 } }, "diffMode": "split" }"#,
    )
    .unwrap();

    let read = ToposSettingsStore::at(path).read();

    assert_eq!(read.repos.into_iter().map(|(k, r)| (k, r.last_opened)).collect::<Vec<_>>(), vec![("c:/a/.git".to_string(), 5)]);
    assert_eq!(read.diff_mode, DiffMode::Split);
}

#[cfg(windows)]
#[test]
fn on_windows_keys_differing_only_in_case_read_as_one_entry_at_its_latest_time() {
    let path = temp_path();
    std::fs::write(&path, r#"{ "repos": { "C:/Repo/.git": { "lastOpened": 9 }, "c:/repo/.git": { "lastOpened": 4 } } }"#).unwrap();

    let repos = ToposSettingsStore::at(path).read().repos;

    assert_eq!(repos.into_iter().map(|(k, r)| (k, r.last_opened)).collect::<Vec<_>>(), vec![("c:/repo/.git".to_string(), 9)]);
}
