//! Helpers shared by the crate's unit tests.

use std::ffi::OsStr;
use std::ops::Deref;
use std::path::{Path, PathBuf};

/// A fresh folder of its own under the OS temp dir, named `quay-test-<tag>-<uuid>`. Dropping
/// it removes the folder and everything in it, so a test that panics cleans up too. Hold it for
/// as long as the test uses the folder: a `let _ = TempDir::new(..)` drops it at once.
pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("quay-test-{tag}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    /// A fresh folder, as `new`, whose path is canonical: what code that canonicalizes the paths
    /// it's given compares against.
    pub fn canonical(tag: &str) -> Self {
        let mut dir = Self::new(tag);
        dir.0 = dir.0.canonicalize().unwrap();
        dir
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Deref for TempDir {
    type Target = Path;

    fn deref(&self) -> &Path {
        &self.0
    }
}

impl AsRef<Path> for TempDir {
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

impl AsRef<OsStr> for TempDir {
    fn as_ref(&self) -> &OsStr {
        self.0.as_os_str()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropping_removes_the_folder_and_what_is_in_it() {
        let dir = TempDir::new("drop");
        std::fs::create_dir_all(dir.join("a").join("b")).unwrap();
        std::fs::write(dir.join("a").join("b").join("c.txt"), "c").unwrap();
        let path = dir.to_path_buf();
        assert!(path.is_dir());
        drop(dir);
        assert!(!path.exists());
    }

    #[test]
    fn a_test_that_panics_still_removes_its_folder() {
        let mut path = None;
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let dir = TempDir::new("panic");
            std::fs::write(dir.join("x.txt"), "x").unwrap();
            path = Some(dir.to_path_buf());
            panic!("a failing assert");
        }));
        assert!(result.is_err());
        let path = path.unwrap();
        assert!(!path.exists(), "{} was left behind", path.display());
    }

    #[test]
    fn each_folder_is_new_and_named_for_its_tag() {
        let (a, b) = (TempDir::new("tag"), TempDir::new("tag"));
        assert_ne!(a.path(), b.path());
        assert!(a.starts_with(std::env::temp_dir()));
        assert!(a.file_name().unwrap().to_string_lossy().starts_with("quay-test-tag-"));
    }

    #[test]
    fn a_canonical_folder_has_its_canonical_path() {
        let dir = TempDir::canonical("canon");
        assert_eq!(dir.path(), dir.canonicalize().unwrap());
    }
}
