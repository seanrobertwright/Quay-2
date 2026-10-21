//! Writes that a crash can't leave half done. The bytes go to a uniquely named temp
//! file beside the target, are flushed to disk, and the temp file is renamed over the
//! target, so a reader sees either the old file or the new one, never a truncated one.

use std::io::Write;
use std::path::Path;

/// Replaces `path` with `body`. On failure the target is untouched and the temp file
/// is removed; a crash before the rename can leave a `<name>.tmp-<uuid>` file behind.
pub fn write_atomic(path: &Path, body: &[u8]) -> std::io::Result<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!("{}.tmp-{}", name, uuid::Uuid::new_v4().simple()));
    let result = (|| {
        let mut file = std::fs::File::create(&tmp)?;
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
    use std::path::PathBuf;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quay2-atomic-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

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
        let dir = temp_dir();
        let path = dir.join("state.json");
        write_atomic(&path, b"first").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");
        assert_eq!(entries(&dir), vec!["state.json"]);
    }

    #[test]
    fn replaces_an_existing_file() {
        let dir = temp_dir();
        let path = dir.join("state.json");
        std::fs::write(&path, "old contents that are longer").unwrap();
        write_atomic(&path, b"new").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(entries(&dir), vec!["state.json"]);
    }

    #[test]
    fn a_failed_rename_removes_the_temp_file() {
        let dir = temp_dir();
        // A directory in the way makes the rename fail on every platform
        let path = dir.join("state.json");
        std::fs::create_dir(&path).unwrap();
        assert!(write_atomic(&path, b"new").is_err());
        assert!(path.is_dir());
        assert_eq!(entries(&dir), vec!["state.json"]);
    }
}
