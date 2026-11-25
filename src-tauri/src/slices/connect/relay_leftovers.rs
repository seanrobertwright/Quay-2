//! The old relays an update leaves beside Quay (#774).
//!
//! Antigravity keeps a relay running for each of its sessions, and Windows will not replace a
//! running program's file. The NSIS installer therefore renames the relay aside, to a name that
//! starts with `quay-relay.exe.old`, before it installs the new one
//! (`src-tauri/windows/installer-hooks.nsh`). A renamed relay can be deleted only once the
//! sessions that run it have ended, so Quay tries again each time it starts.

use std::io;
use std::path::Path;

use super::commands::RELAY_NAME;

/// Removes the old relays in Quay's own folder, on a thread of its own so that startup does not
/// wait for the disk. What stops it is logged, and the old relays stay until Quay next starts.
pub fn sweep_at_startup() {
    let started = std::thread::Builder::new().name("relay-leftovers".into()).spawn(|| {
        let swept = std::env::current_exe().and_then(|exe| {
            let dir = exe.parent().ok_or_else(|| io::Error::other(format!("{} has no folder", exe.display())))?;
            remove_relay_leftovers(dir)
        });
        if let Err(e) = swept {
            tracing::warn!("Could not look for old relays beside Quay: {e}");
        }
    });
    if let Err(e) = started {
        tracing::warn!("Could not start looking for old relays beside Quay: {e}");
    }
}

/// Removes each file in `dir` whose name starts with `quay-relay.exe.old`. Folders and links stay.
/// So does a file that can't be deleted, such as a relay that is still running, with a log line:
/// Windows refuses both a running relay and a file the operator may not delete with the same error.
/// Fails if `dir` or one of its entries can't be read.
fn remove_relay_leftovers(dir: &Path) -> io::Result<()> {
    let prefix = format!("{RELAY_NAME}.exe.old");
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with(&prefix) && entry.file_type()?.is_file() {
            if let Err(e) = std::fs::remove_file(entry.path()) {
                tracing::info!("The old relay {} stays until Quay next starts: {e}", name.to_string_lossy());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::ErrorKind;
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

        remove_relay_leftovers(&dir).unwrap();

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

        remove_relay_leftovers(&dir).unwrap();

        assert_eq!(names_in(&dir), ["quay-relay.exe.old"]);
    }

    #[test]
    fn a_folder_that_cannot_be_listed_is_an_error() {
        let dir = TempDir::new("leftovers");

        let swept = remove_relay_leftovers(&dir.join("gone"));

        assert_eq!(swept.map_err(|e| e.kind()), Err(ErrorKind::NotFound));
    }

    #[test]
    fn a_folder_with_an_old_relays_name_stays_with_what_is_in_it() {
        let dir = TempDir::new("leftovers");
        let folder = dir.join("quay-relay.exe.old");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("quay-relay.exe.old.1"), "").unwrap();

        remove_relay_leftovers(&dir).unwrap();

        assert_eq!(names_in(&dir), ["quay-relay.exe.old"]);
        assert_eq!(names_in(&folder), ["quay-relay.exe.old.1"]);
    }
}
