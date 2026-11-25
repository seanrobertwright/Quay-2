//! Writes that a crash can't leave half done. The bytes go to a uniquely named temp
//! file beside the target, are flushed to disk, and the temp file is renamed over the
//! target, so a reader sees either the old file or the new one, never a truncated one.
//! The new file only its owner may read, which such a write can start from, is here too.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;

/// Replaces `path` with `body`. On failure the target is untouched and the temp file
/// is removed; a crash before the rename can leave a `<name>.tmp-<uuid>` file behind.
pub fn write_atomic(path: &Path, body: &[u8]) -> std::io::Result<()> {
    replace(path, body, |tmp| File::create(tmp))
}

/// `write_atomic`, for a file that may hold secrets. On Unix only its owner may read it, whatever
/// the file it replaces allowed; on Windows it has the access its folder gives.
pub fn write_atomic_private(path: &Path, body: &[u8]) -> std::io::Result<()> {
    replace(path, body, create_private)
}

/// A new, empty file. On Unix only its owner may read it, until it is given other permissions; on
/// Windows it has the access its folder gives. It never opens a file or link already at `path`.
pub fn create_private(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Replaces `path` with `body` through the temp file `create` makes beside it.
fn replace(path: &Path, body: &[u8], create: impl FnOnce(&Path) -> std::io::Result<File>) -> std::io::Result<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!("{}.tmp-{}", name, uuid::Uuid::new_v4().simple()));
    let result = (|| {
        let mut file = create(&tmp)?;
        file.write_all(body)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn writes_a_new_file_and_leaves_no_temp_file() {
        let dir = TempDir::new("atomic");
        let path = dir.join("state.json");
        write_atomic(&path, b"first").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");
        assert_eq!(entries(&dir), vec!["state.json"]);
    }

    #[test]
    fn replaces_an_existing_file() {
        let dir = TempDir::new("atomic");
        let path = dir.join("state.json");
        std::fs::write(&path, "old contents that are longer").unwrap();
        write_atomic(&path, b"new").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(entries(&dir), vec!["state.json"]);
    }

    #[test]
    fn a_private_write_replaces_the_file_and_leaves_no_temp_file() {
        let dir = TempDir::new("atomic");
        let path = dir.join("state.json");
        std::fs::write(&path, "old contents that are longer").unwrap();
        write_atomic_private(&path, b"new").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(entries(&dir), vec!["state.json"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_private_write_is_its_owners_alone_even_over_a_file_others_could_read() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new("atomic");
        let path = dir.join("state.json");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_atomic_private(&path, b"new").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn a_failed_rename_removes_the_temp_file() {
        let dir = TempDir::new("atomic");
        // A directory in the way makes the rename fail on every platform
        let path = dir.join("state.json");
        std::fs::create_dir(&path).unwrap();
        assert!(write_atomic(&path, b"new").is_err());
        assert!(path.is_dir());
        assert_eq!(entries(&dir), vec!["state.json"]);
    }
}
