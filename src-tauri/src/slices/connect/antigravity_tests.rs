//! Connecting Antigravity, over a configuration file in a folder of the test's own.

use std::path::PathBuf;

use serde_json::{Value, json};

use super::antigravity::{Antigravity, State};
use crate::test_support::TempDir;

struct Seam {
    dir: TempDir,
    file: PathBuf,
    relay: PathBuf,
    antigravity: Antigravity,
}

impl Seam {
    /// Antigravity's folder with no configuration file in it.
    fn empty() -> Self {
        let dir = TempDir::new("connect");
        let file = dir.join("config").join("mcp_config.json");
        let relay = dir.join("quay").join(relay_file());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::create_dir_all(relay.parent().unwrap()).unwrap();
        std::fs::write(&relay, "").unwrap();
        let antigravity = Antigravity::new(file.clone(), relay.clone());
        Self { dir, file, relay, antigravity }
    }

    fn with(text: &str) -> Self {
        let seam = Self::empty();
        std::fs::write(&seam.file, text).unwrap();
        seam
    }

    fn text(&self) -> String {
        std::fs::read_to_string(&self.file).unwrap()
    }

    /// The names in the configuration file's folder.
    fn names(&self) -> Vec<String> {
        let entries = std::fs::read_dir(self.file.parent().unwrap()).unwrap();
        entries.map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect()
    }

    /// The relay's path as a JSON string.
    fn relay_json(&self) -> String {
        Value::from(self.relay.to_str().unwrap()).to_string()
    }
}

fn relay_file() -> String {
    format!("quay-relay{}", std::env::consts::EXE_SUFFIX)
}

#[test]
fn connect_adds_its_entry_and_keeps_every_other_byte() {
    let seam = Seam::with(
        "{\r\n\t\"theme\" : \"dark\",\r\n\t\"mcpServers\": {\r\n\t\t\"github\": { \"command\":\"gh-mcp\",  \"x-mine\": [1,2] }\r\n\t},\r\n\t\"last\":1.50\r\n}\r\n",
    );

    seam.antigravity.connect(None).unwrap();

    assert_eq!(
        seam.text(),
        format!(
            "{{\r\n\t\"theme\" : \"dark\",\r\n\t\"mcpServers\": {{\r\n\t\t\"github\": {{ \"command\":\"gh-mcp\",  \"x-mine\": [1,2] }},\r\n\t\t\"quay\": {{\r\n\t\t\t\"command\": {},\r\n\t\t\t\"timeoutSeconds\": 150\r\n\t\t}}\r\n\t}},\r\n\t\"last\":1.50\r\n}}\r\n",
            seam.relay_json()
        )
    );
    assert_eq!(seam.names(), ["mcp_config.json"]);
}

#[test]
fn connect_creates_a_missing_file() {
    for folder_exists in [true, false] {
        let seam = Seam::empty();
        if !folder_exists {
            std::fs::remove_dir(seam.file.parent().unwrap()).unwrap();
        }

        seam.antigravity.connect(None).unwrap();

        let written: Value = serde_json::from_str(&seam.text()).unwrap();
        let entry = json!({ "command": seam.relay.to_str().unwrap(), "timeoutSeconds": 150 });
        assert_eq!(written, json!({ "mcpServers": { "quay": entry } }));
        assert_eq!(seam.names(), ["mcp_config.json"]);
    }
}

#[test]
fn connection_shows_the_file_and_the_entry_before_anything_is_written() {
    let seam = Seam::empty();

    let shown = seam.antigravity.connection();

    assert_eq!(shown.file, seam.file.to_str().unwrap());
    assert_eq!(
        shown.entry,
        format!("\"quay\": {{\n  \"command\": {},\n  \"timeoutSeconds\": 150\n}}", seam.relay_json())
    );
    assert_eq!((shown.state, shown.found, shown.problem), (State::Missing, None, None));
    assert!(seam.names().is_empty());
    assert!(seam.dir.join("quay").is_dir());
}

#[test]
fn connect_follows_how_the_file_is_laid_out() {
    for (before, after) in [
        (r#"{}"#, "{\n  \"mcpServers\": {\n    \"quay\": {\n      \"command\": RELAY,\n      \"timeoutSeconds\": 150\n    }\n  }\n}"),
        (
            "{\n    \"mcpServers\": {}\n}\n",
            "{\n    \"mcpServers\": {\n        \"quay\": {\n            \"command\": RELAY,\n            \"timeoutSeconds\": 150\n        }\n    }\n}\n",
        ),
        (
            "{\n \"a\": [ {\"mcpServers\": 1} ]\n}",
            "{\n \"a\": [ {\"mcpServers\": 1} ],\n \"mcpServers\": {\n  \"quay\": {\n   \"command\": RELAY,\n   \"timeoutSeconds\": 150\n  }\n }\n}",
        ),
        (
            r#"{"mcpServers":{"a":{"command":"a"}},"z":0}"#,
            r#"{"mcpServers":{"a":{"command":"a"}, "quay": {"command":RELAY,"timeoutSeconds":150}},"z":0}"#,
        ),
        (
            "\u{feff}{\"mcpServers\": { \"a}\\\"\": \"]}\" } }",
            "\u{feff}{\"mcpServers\": { \"a}\\\"\": \"]}\", \"quay\": {\"command\":RELAY,\"timeoutSeconds\":150} } }",
        ),
    ] {
        let seam = Seam::with(before);

        seam.antigravity.connect(None).unwrap();

        assert_eq!(seam.text(), after.replace("RELAY", &seam.relay_json()), "{before}");
    }
}

#[test]
fn a_file_that_cannot_be_edited_is_refused_with_the_reason_and_left_untouched() {
    for (text, reason) in [
        ("", "it is empty"),
        (" \n", "it is empty"),
        ("{", "it is not JSON: EOF while parsing an object at line 1 column 1"),
        ("{\n  // mine\n  \"mcpServers\": {}\n}", "it is not JSON: key must be a string at line 2 column 3"),
        ("{\"mcpServers\": {},}", "it is not JSON: trailing comma at line 1 column 19"),
        ("[]", "it is not a JSON object"),
        ("{\"mcpServers\": null}", "its \"mcpServers\" is not an object"),
        ("{\"mcpServers\": {}, \"mcpServers\": {}}", "it has the same key twice in one object"),
        ("{\"mcpServers\": {\"quay\": 1, \"\\u0071uay\": 2}}", "it has the same key twice in one object"),
    ] {
        let seam = Seam::with(text);
        let shown = seam.antigravity.connection();

        assert_eq!((shown.state, shown.problem.as_deref()), (State::Unreadable, Some(reason)), "{text}");
        assert_eq!(seam.antigravity.connect(None), Err(format!("Nothing was written: {reason}.")), "{text}");
        assert_eq!(seam.antigravity.remove("\"quay\": 1"), Err(format!("Nothing was written: {reason}.")), "{text}");
        assert_eq!(seam.text(), text);
        assert_eq!(seam.names(), ["mcp_config.json"]);
    }
    let seam = Seam::empty();
    std::fs::write(&seam.file, b"{\"a\": \"\xff\"}").unwrap();
    assert_eq!(seam.antigravity.connection().problem.as_deref(), Some("it is not UTF-8 text"));
    assert!(seam.antigravity.connect(None).is_err());
    assert_eq!(std::fs::read(&seam.file).unwrap(), b"{\"a\": \"\xff\"}");
}

#[test]
fn a_file_over_the_limit_is_refused() {
    let text = format!("{{\"a\": \"{}\"}}", "x".repeat(4 * 1024 * 1024));
    let seam = Seam::with(&text);

    assert_eq!(seam.antigravity.connect(None), Err("Nothing was written: it is over 4 MB.".to_string()));
    assert!(seam.text() == text);
}

#[test]
fn a_path_that_is_not_a_file_is_refused() {
    let seam = Seam::empty();
    std::fs::create_dir(&seam.file).unwrap();

    assert_eq!(seam.antigravity.connection().state, State::Unreadable);
    assert!(seam.antigravity.connect(None).is_err());
    assert!(seam.file.is_dir());
}

#[test]
fn connection_tells_quays_entry_from_an_old_relays_and_a_changed_one() {
    let seam = Seam::empty();
    let this = seam.relay_json();
    let old = Value::from(seam.dir.join("old").join(relay_file()).to_str().unwrap()).to_string();
    for (entry, state) in [
        (format!(r#"{{"timeoutSeconds": 150, "command": {this}}}"#), State::Connected),
        (format!(r#"{{"command": {old}, "timeoutSeconds": 150}}"#), State::OldRelay),
        (format!(r#"{{"command": {old}, "timeoutSeconds": 90, "disabled": false}}"#), State::OldRelay),
        (format!(r#"{{"command": {this}, "timeoutSeconds": 90}}"#), State::Changed),
        (format!(r#"{{"command": {this}, "timeoutSeconds": 150, "disabled": true}}"#), State::Changed),
        (r#"{"command": "node", "args": ["relay.mjs"]}"#.to_string(), State::Changed),
        ("null".to_string(), State::Changed),
    ] {
        std::fs::write(&seam.file, format!(r#"{{"mcpServers": {{"a": {{}}, "quay" : {entry}}}}}"#)).unwrap();

        let shown = seam.antigravity.connection();

        assert_eq!((shown.state, shown.found, shown.problem), (state, Some(format!(r#""quay" : {entry}"#)), None));
    }
}

#[test]
fn connect_replaces_the_entry_it_was_shown_in_place_and_no_other() {
    let text = "{\n  \"mcpServers\": {\n    \"quay\" : {\"command\": \"node\", \"mine\": 1},\n    \"b\": {}\n  }\n}\n";
    let seam = Seam::with(text);
    let refused = Err("Nothing was written: the file's entry is not the one shown.".to_string());
    assert_eq!(seam.antigravity.connect(None), refused);
    assert_eq!(seam.antigravity.connect(Some("\"quay\": {}")), refused);
    assert_eq!(seam.text(), text);

    seam.antigravity.connect(seam.antigravity.connection().found.as_deref()).unwrap();

    let entry = format!("{{\n      \"command\": {},\n      \"timeoutSeconds\": 150\n    }}", seam.relay_json());
    assert_eq!(seam.text(), text.replace("{\"command\": \"node\", \"mine\": 1}", &entry));
}

#[test]
fn connect_refuses_when_the_entry_it_was_shown_has_gone() {
    let seam = Seam::with("{}");

    assert_eq!(
        seam.antigravity.connect(Some("\"quay\": {}")),
        Err("Nothing was written: the file's entry is not the one shown.".to_string())
    );
    assert_eq!(seam.text(), "{}");
}

#[test]
fn connect_writes_no_entry_for_a_relay_that_is_not_there() {
    let seam = Seam::with("{}");
    std::fs::remove_file(&seam.relay).unwrap();

    let refused = seam.antigravity.connect(None).unwrap_err();

    assert_eq!(refused, format!("Nothing was written: Quay's relay is not at {}.", seam.relay.display()));
    assert_eq!(seam.text(), "{}");
}

#[test]
fn remove_takes_out_only_quays_entry() {
    for (before, after) in [
        ("{\n  \"mcpServers\": {\n    \"a\": {},\n    \"quay\": {\"x\": \"}\"},\n    \"b\": []\n  }\n}", "{\n  \"mcpServers\": {\n    \"a\": {},\n    \"b\": []\n  }\n}"),
        ("{\"mcpServers\": {\"quay\": null , \"b\":1.0}, \"quay\": 2}", "{\"mcpServers\": {\"b\":1.0}, \"quay\": 2}"),
        ("{\"mcpServers\": { \"a\": 1 , \"quay\": 2 }}", "{\"mcpServers\": { \"a\": 1 }}"),
        ("{\r\n\t\"mcpServers\": {\r\n\t\t\"quay\": true\r\n\t}\r\n}", "{\r\n\t\"mcpServers\": {}\r\n}"),
    ] {
        let seam = Seam::with(before);
        let found = seam.antigravity.connection().found.unwrap();

        seam.antigravity.remove(&found).unwrap();

        assert_eq!(seam.text(), after);
        assert_eq!(seam.names(), ["mcp_config.json"]);
    }
}

#[test]
fn remove_after_connect_gives_back_the_files_bytes() {
    for text in [
        "{\r\n    \"mcpServers\" :{\r\n      \"a\" : {\"e\": 1e5}\r\n    },\r\n  \"z\": \"\\u00e9\"\r\n}\r\n",
        "{\"mcpServers\":{}}",
        "{\n\t\"mcpServers\": {\n\t\t\"a\": 1\n\t}\n}",
    ] {
        let seam = Seam::with(text);

        seam.antigravity.connect(None).unwrap();
        assert_ne!(seam.text(), text);
        seam.antigravity.remove(&seam.antigravity.connection().found.unwrap()).unwrap();

        assert_eq!(seam.text(), text);
    }
}

#[test]
fn remove_refuses_an_entry_that_is_not_the_one_shown() {
    let shown = "\"quay\": {\"command\": \"a\"}";
    for text in ["{\"mcpServers\": {\"quay\": {\"command\": \"b\"}}}", "{\"mcpServers\": {}}", "{}"] {
        let seam = Seam::with(text);

        assert_eq!(
            seam.antigravity.remove(shown),
            Err("Nothing was written: the file's entry is not the one shown.".to_string())
        );
        assert_eq!(seam.text(), text);
    }
    let seam = Seam::empty();
    assert!(seam.antigravity.remove(shown).is_err());
    assert!(seam.names().is_empty());
}

#[test]
fn a_read_only_file_is_refused() {
    let seam = Seam::with("{}");
    let set = |readonly: bool| {
        let mut permissions = std::fs::metadata(&seam.file).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(readonly);
        std::fs::set_permissions(&seam.file, permissions).unwrap();
    };
    set(true);

    let refused = seam.antigravity.connect(None);

    set(false);
    assert_eq!(refused, Err("Nothing was written: it is read-only.".to_string()));
    assert_eq!(seam.text(), "{}");
    assert_eq!(seam.names(), ["mcp_config.json"]);
}

#[cfg(unix)]
#[test]
fn the_file_keeps_its_permissions() {
    use std::os::unix::fs::PermissionsExt;
    for mode in [0o600, 0o640, 0o664] {
        let seam = Seam::with("{}");
        std::fs::set_permissions(&seam.file, std::fs::Permissions::from_mode(mode)).unwrap();

        seam.antigravity.connect(None).unwrap();

        assert_eq!(std::fs::metadata(&seam.file).unwrap().permissions().mode() & 0o777, mode);
    }
}

#[cfg(windows)]
#[test]
fn the_file_keeps_its_permissions() {
    let icacls = |seam: &Seam, args: &[&str]| {
        let output = crate::spawn::hidden_command("icacls").arg(&seam.file).args(args).output().unwrap();
        assert!(output.status.success());
        String::from_utf8_lossy(&output.stdout).into_owned()
    };
    // One that inherits its folder's access, and one that only its owner may open
    for args in [&["/inheritance:e"][..], &["/inheritance:r", "/grant:r", "*S-1-3-4:(F)"][..]] {
        let seam = Seam::with("{}");
        icacls(&seam, args);
        let before = icacls(&seam, &[]);

        seam.antigravity.connect(None).unwrap();

        assert_ne!(seam.text(), "{}");
        assert_eq!(icacls(&seam, &[]), before);
    }
}

#[cfg(unix)]
#[test]
fn a_link_to_the_file_stays_a_link() {
    let seam = Seam::empty();
    let target = seam.dir.join("dotfiles.json");
    std::fs::write(&target, "{}").unwrap();
    std::os::unix::fs::symlink(&target, &seam.file).unwrap();

    seam.antigravity.connect(None).unwrap();

    assert!(std::fs::symlink_metadata(&seam.file).unwrap().is_symlink());
    assert!(std::fs::read_to_string(&target).unwrap().contains("quay"));
}

#[test]
fn the_entry_holds_no_token_and_no_port() {
    let seam = Seam::empty();

    seam.antigravity.connect(None).unwrap();

    let written: Value = serde_json::from_str(&seam.text()).unwrap();
    let entry = written["mcpServers"]["quay"].as_object().unwrap();
    assert_eq!(entry.keys().collect::<Vec<_>>(), ["command", "timeoutSeconds"]);
    assert_eq!(entry["command"], seam.relay.to_str().unwrap());
}
