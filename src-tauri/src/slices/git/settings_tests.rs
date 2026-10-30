//! `topos.json` through its store: what a read returns for a given file, what a write leaves on
//! disk, and which repo entries survive the cap.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::json;

use super::error::GitError;
use super::settings::*;

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
        ToposSettings { graph_column_width: 300, inspector_width: 520, diff_mode: DiffMode::Split, file_list_mode: FileListMode::Tree }
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
