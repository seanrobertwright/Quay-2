//! Discarding unstaged changes with a backup, and restoring them (#387), against throwaway
//! repositories with a linked worktree, built with the system git.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::diff::{read_file_diff, DiffSide, LineRef, Selection};
use super::discard::{discard_selection, restore_discarded, DiscardBackup, DiscardRequest, RecycleBin};
use super::error::GitError;
use super::staging::StagingLocks;
use super::staging_tests::{git, repo_with_worktree};

/// A Recycle Bin that moves what it is given into its own folder, so a test can see that a
/// discarded file went there and was never deleted outright.
struct TestBin {
    dir: PathBuf,
    moved: Mutex<Vec<PathBuf>>,
}

impl TestBin {
    fn new(root: &Path) -> TestBin {
        let dir = root.join("bin");
        std::fs::create_dir_all(&dir).unwrap();
        TestBin { dir, moved: Mutex::new(Vec::new()) }
    }

    /// The names of the files in the bin, sorted.
    fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.moved.lock().unwrap().iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }
}

impl RecycleBin for TestBin {
    fn delete_all(&self, paths: &[PathBuf]) -> Result<(), String> {
        for path in paths {
            let to = self.dir.join(format!("{}-{}", uuid::Uuid::new_v4().simple(), path.file_name().unwrap().to_string_lossy()));
            std::fs::rename(path, &to).map_err(|e| e.to_string())?;
            self.moved.lock().unwrap().push(PathBuf::from(path.file_name().unwrap()));
        }
        Ok(())
    }
}

/// The bytes of the blob `oid`.
fn blob_bytes(wt: &Path, oid: &str) -> Vec<u8> {
    let out = crate::spawn::hidden_command("git").current_dir(wt).args(["cat-file", "blob", oid]).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    out.stdout
}

fn twelve() -> String {
    (1..=12).map(|i| format!("line {i}\n")).collect()
}

fn token(wt: &Path, path: &str) -> String {
    read_file_diff(wt, 1, path, &DiffSide::Unstaged, 3, false).unwrap().diff_token
}

fn discard(path: &str, token: &str, selection: Selection) -> DiscardRequest {
    DiscardRequest { path: path.into(), diff_token: token.into(), selection, load_large: false }
}

/// A committed twelve-line README with line 2 changed and line 11 deleted in the worktree.
fn two_hunks() -> (PathBuf, PathBuf, String) {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), twelve()).unwrap();
    git(&wt, &["commit", "-q", "-am", "twelve"]);
    let changed = twelve().replace("line 2\n", "line two\n").replace("line 11\n", "");
    std::fs::write(wt.join("README.md"), &changed).unwrap();
    (root, wt, changed)
}

#[test]
fn discarding_a_hunk_reverse_applies_it_and_backs_up_the_bytes_first() {
    let (root, wt, changed) = two_hunks();
    git(&wt, &["add", "README.md"]);
    // A staged change stays staged: discard acts on the worktree against the index.
    std::fs::write(wt.join("README.md"), changed.replace("line 5\n", "line five\n")).unwrap();
    let before = std::fs::read(wt.join("README.md")).unwrap();
    let bin = TestBin::new(&root);

    let locks = StagingLocks::default();
    let out = discard_selection(&locks, &bin, &wt, 3, 4, &discard("README.md", &token(&wt, "README.md"), Selection::Hunks { hunks: vec![0] })).unwrap();

    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), changed);
    let DiscardBackup { path, blob, after } = &out.backup;
    assert_eq!(path, "README.md");
    assert_eq!(blob_bytes(&wt, blob.as_deref().unwrap()), before);
    assert!(after.is_some());
    assert_eq!(out.status.request_id, 3);
    assert_eq!(out.diff.request_id, 4);
    assert!(out.diff.hunks.is_empty());
    assert!(bin.names().is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn discarding_lines_of_a_crlf_file_and_restoring_them_puts_back_every_byte() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), b"one\r\ntwo\r\nthree\r\n").unwrap();
    git(&wt, &["commit", "-q", "-am", "crlf"]);
    let changed: &[u8] = b"one\r\nTWO\r\nthree\r\nfour\r\n";
    std::fs::write(wt.join("README.md"), changed).unwrap();
    let diff = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();
    // Lines: context one, del two, add TWO, context three, add four. Discard only the added "four".
    assert_eq!(diff.hunks[0].lines[4].text, "four\r");

    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let lines = Selection::Lines { lines: vec![LineRef { hunk: 0, line: 4 }] };
    let out = discard_selection(&locks, &bin, &wt, 1, 2, &discard("README.md", &diff.diff_token, lines)).unwrap();
    assert_eq!(std::fs::read(wt.join("README.md")).unwrap(), b"one\r\nTWO\r\nthree\r\n");
    assert_eq!(blob_bytes(&wt, out.backup.blob.as_deref().unwrap()), changed);

    let status = restore_discarded(&locks, &bin, &wt, 9, &[out.backup]).unwrap();
    assert_eq!(status.request_id, 9);
    assert_eq!(std::fs::read(wt.join("README.md")).unwrap(), changed);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_restore_is_refused_once_the_file_changed_since_the_discard() {
    let (root, wt, changed) = two_hunks();
    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let out = discard_selection(&locks, &bin, &wt, 1, 2, &discard("README.md", &token(&wt, "README.md"), Selection::Hunks { hunks: vec![1] })).unwrap();
    let edited = changed.replace("line 1\n", "edited after the discard\n");
    std::fs::write(wt.join("README.md"), &edited).unwrap();

    assert_eq!(
        restore_discarded(&locks, &bin, &wt, 1, &[out.backup.clone()]),
        Err(GitError::ChangedSinceDiscard { paths: vec!["README.md".into()] })
    );
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), edited);
    let _ = std::fs::remove_dir_all(root);
}

/// Bytes git reads as binary: a NUL, a lone CR, and bytes that aren't UTF-8.
fn binary(tail: u8) -> Vec<u8> {
    vec![0x89, b'P', b'N', b'G', 0, 0xff, 0xfe, b'\r', 0, b'\r', b'\n', tail, 0x80, 0]
}

#[test]
fn discarding_a_whole_binary_file_restores_the_index_bytes_and_undo_puts_back_the_old_ones() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("logo.png"), binary(1)).unwrap();
    git(&wt, &["add", "logo.png"]);
    git(&wt, &["commit", "-q", "-m", "logo"]);
    std::fs::write(wt.join("logo.png"), binary(2)).unwrap();
    let diff = read_file_diff(&wt, 1, "logo.png", &DiffSide::Unstaged, 3, false).unwrap();
    assert!(diff.binary);

    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let out = discard_selection(&locks, &bin, &wt, 1, 2, &discard("logo.png", &diff.diff_token, Selection::File)).unwrap();
    assert_eq!(std::fs::read(wt.join("logo.png")).unwrap(), binary(1));
    assert_eq!(blob_bytes(&wt, out.backup.blob.as_deref().unwrap()), binary(2));
    assert!(out.status.entries.is_empty());
    assert!(bin.names().is_empty());

    restore_discarded(&locks, &bin, &wt, 1, &[out.backup]).unwrap();
    assert_eq!(std::fs::read(wt.join("logo.png")).unwrap(), binary(2));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_hunk_of_a_binary_file_is_refused() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("logo.png"), binary(1)).unwrap();
    git(&wt, &["add", "logo.png"]);
    git(&wt, &["commit", "-q", "-m", "logo"]);
    std::fs::write(wt.join("logo.png"), binary(2)).unwrap();
    let token = token(&wt, "logo.png");

    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    assert!(matches!(
        discard_selection(&locks, &bin, &wt, 1, 2, &discard("logo.png", &token, Selection::Hunks { hunks: vec![0] })),
        Err(GitError::Other { .. })
    ));
    assert_eq!(std::fs::read(wt.join("logo.png")).unwrap(), binary(2));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn discarding_an_untracked_file_moves_it_to_the_recycle_bin_and_undo_brings_it_back() {
    let (root, wt) = repo_with_worktree();
    std::fs::create_dir_all(wt.join("notes")).unwrap();
    std::fs::write(wt.join("notes/new.bin"), binary(3)).unwrap();
    let token = token(&wt, "notes/new.bin");

    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let out = discard_selection(&locks, &bin, &wt, 1, 2, &discard("notes/new.bin", &token, Selection::File)).unwrap();
    assert!(!wt.join("notes/new.bin").exists());
    assert_eq!(bin.names(), ["new.bin"]);
    assert_eq!(out.backup.after, None);
    assert_eq!(blob_bytes(&wt, out.backup.blob.as_deref().unwrap()), binary(3));
    assert!(out.status.entries.is_empty());

    restore_discarded(&locks, &bin, &wt, 1, &[out.backup]).unwrap();
    assert_eq!(std::fs::read(wt.join("notes/new.bin")).unwrap(), binary(3));
    let _ = std::fs::remove_dir_all(root);
}

/// Makes storing the blob of `bytes` fail: a file where its fan-out folder under `objects/` goes,
/// so git can't write the object while everything else it does still works.
fn block_blob(wt: &Path, bytes: &[u8]) {
    let probe = wt.join("probe.tmp");
    std::fs::write(&probe, bytes).unwrap();
    let oid = git(wt, &["hash-object", "--no-filters", "probe.tmp"]).trim().to_string();
    std::fs::remove_file(&probe).unwrap();
    let objects = PathBuf::from(git(wt, &["rev-parse", "--path-format=absolute", "--git-path", "objects"]).trim());
    assert!(!objects.join(&oid[..2]).exists(), "pick bytes whose fan-out folder is new");
    std::fs::write(objects.join(&oid[..2]), "not a folder").unwrap();
}

#[test]
fn a_failed_backup_discards_nothing() {
    let (root, wt, changed) = two_hunks();
    std::fs::write(wt.join("untracked.txt"), "keep me\n").unwrap();
    block_blob(&wt, changed.as_bytes());
    block_blob(&wt, b"keep me\n");

    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    for selection in [Selection::Hunks { hunks: vec![0] }, Selection::Lines { lines: vec![LineRef { hunk: 0, line: 1 }] }, Selection::File] {
        let err = discard_selection(&locks, &bin, &wt, 1, 2, &discard("README.md", &token(&wt, "README.md"), selection)).unwrap_err();
        assert!(err.to_string().contains("nothing was discarded"), "{err}");
        assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), changed);
    }
    let err = discard_selection(&locks, &bin, &wt, 1, 2, &discard("untracked.txt", &token(&wt, "untracked.txt"), Selection::File)).unwrap_err();
    assert!(err.to_string().contains("nothing was discarded"), "{err}");
    assert_eq!(std::fs::read_to_string(wt.join("untracked.txt")).unwrap(), "keep me\n");
    assert!(bin.names().is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn discarding_a_deleted_file_brings_it_back_and_undo_deletes_it_again_through_the_recycle_bin() {
    let (root, wt) = repo_with_worktree();
    std::fs::remove_file(wt.join("README.md")).unwrap();
    let token = token(&wt, "README.md");

    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let out = discard_selection(&locks, &bin, &wt, 1, 2, &discard("README.md", &token, Selection::File)).unwrap();
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), "readme\n");
    assert_eq!(out.backup.blob, None);

    restore_discarded(&locks, &bin, &wt, 1, &[out.backup]).unwrap();
    assert!(!wt.join("README.md").exists());
    assert_eq!(bin.names(), ["README.md"]);
    let _ = std::fs::remove_dir_all(root);
}
