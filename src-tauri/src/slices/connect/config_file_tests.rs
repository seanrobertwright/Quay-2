//! A change to a configuration file between reading it and replacing it.

use super::config_file::ConfigFile;
use crate::test_support::TempDir;

const CHANGED: &str = "it changed while Quay was writing, so try again";

fn names(dir: &TempDir) -> Vec<String> {
    let entries = std::fs::read_dir(dir.path()).unwrap();
    entries.map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect()
}

#[test]
fn a_file_changed_since_it_was_read_is_left_as_it_is() {
    let dir = TempDir::new("connect-changed");
    let path = dir.join("mcp_config.json");
    std::fs::write(&path, "{\"a\": 1}").unwrap();
    let file = ConfigFile::read(&path).unwrap();

    // As long as what was read, so that only its bytes tell them apart
    std::fs::write(&path, "{\"a\": 2}").unwrap();

    assert_eq!(file.replace("{}"), Err(CHANGED.to_string()));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\": 2}");
    assert_eq!(names(&dir), ["mcp_config.json"]);
}

#[test]
fn a_file_created_since_there_was_none_is_left_as_it_is() {
    let dir = TempDir::new("connect-created");
    let path = dir.join("mcp_config.json");
    let file = ConfigFile::read(&path).unwrap();

    std::fs::write(&path, "{}").unwrap();

    assert_eq!(file.replace("{\"a\": 1}"), Err(CHANGED.to_string()));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
    assert_eq!(names(&dir), ["mcp_config.json"]);
}

#[test]
fn a_file_removed_since_it_was_read_is_not_put_back() {
    let dir = TempDir::new("connect-removed");
    let path = dir.join("mcp_config.json");
    std::fs::write(&path, "{}").unwrap();
    let file = ConfigFile::read(&path).unwrap();

    std::fs::remove_file(&path).unwrap();

    assert!(file.replace("{\"a\": 1}").is_err());
    assert!(names(&dir).is_empty());
}
