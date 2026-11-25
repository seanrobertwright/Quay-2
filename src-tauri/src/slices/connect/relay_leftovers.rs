//! The old relays an update leaves beside Quay (#774).
//!
//! Antigravity keeps a relay running for each of its sessions, and Windows will not replace a
//! running program's file. The NSIS installer therefore renames the relay aside, to a name that
//! starts with `quay-relay.exe.old`, before it installs the new one
//! (`src-tauri/windows/installer-hooks.nsh`). A renamed relay can be deleted only once the
//! sessions that run it have ended, so Quay tries again each time it starts.

use std::path::Path;

use super::commands::RELAY_NAME;

/// Removes the old relays in Quay's own folder, on a thread of its own so that startup does not
/// wait for the disk. With no thread or no folder to list, they stay until Quay next starts.
pub fn sweep_at_startup() {
    let _ = std::thread::Builder::new().name("relay-leftovers".into()).spawn(|| {
        if let Some(dir) = std::env::current_exe().ok().as_deref().and_then(Path::parent) {
            remove_relay_leftovers(dir);
        }
    });
}

/// Removes each file in `dir` whose name starts with `quay-relay.exe.old`. Folders and links stay,
/// and so does a file that can't be deleted, such as a relay that is still running.
fn remove_relay_leftovers(dir: &Path) {
    let prefix = format!("{RELAY_NAME}.exe.old");
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let named = entry.file_name().to_string_lossy().starts_with(&prefix);
        if named && entry.file_type().is_ok_and(|kind| kind.is_file()) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use crate::test_support::relay::{built_sidecar, Relay};

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn old_relays_are_removed_and_every_other_file_stays() {
        let dir = TempDir::new("leftovers");
        for name in [
            "quay-relay.exe",
            "quay-relay.exe.old",
            "quay-relay.exe.old.1",
            "quay-relay.exe.ol",
            "my-quay-relay.exe.old",
            "quay-codex-notify.exe.old",
            "tauri-app.exe",
        ] {
            std::fs::write(dir.join(name), name).unwrap();
        }

        remove_relay_leftovers(&dir);

        assert_eq!(
            names_in(&dir),
            ["my-quay-relay.exe.old", "quay-codex-notify.exe.old", "quay-relay.exe", "quay-relay.exe.ol", "tauri-app.exe"]
        );
    }

    #[test]
    fn a_relay_still_running_keeps_its_file_and_the_rest_are_removed() {
        let dir = TempDir::new("leftovers");
        let running = dir.join("quay-relay.exe.old");
        std::fs::copy(built_sidecar("quay-relay"), &running).unwrap();
        std::fs::write(dir.join("quay-relay.exe.old.1"), "").unwrap();
        let _relay = Relay::start(&running, &[]);

        remove_relay_leftovers(&dir);

        assert_eq!(names_in(&dir), ["quay-relay.exe.old"]);
    }

    #[test]
    fn a_folder_that_cannot_be_listed_is_left_alone() {
        let dir = TempDir::new("leftovers");

        remove_relay_leftovers(&dir.join("gone"));

        assert_eq!(names_in(&dir), [] as [&str; 0]);
    }

    #[test]
    fn a_folder_with_an_old_relays_name_stays_with_what_is_in_it() {
        let dir = TempDir::new("leftovers");
        let folder = dir.join("quay-relay.exe.old");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("quay-relay.exe.old.1"), "").unwrap();

        remove_relay_leftovers(&dir);

        assert_eq!(names_in(&dir), ["quay-relay.exe.old"]);
        assert_eq!(names_in(&folder), ["quay-relay.exe.old.1"]);
    }
}
