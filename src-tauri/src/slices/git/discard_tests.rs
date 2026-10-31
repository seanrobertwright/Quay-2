//! Discarding unstaged changes with a backup, and restoring them (#387), against throwaway
//! repositories with a linked worktree, built with the system git.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::diff::{read_file_diff, DiffSide, LineRef, Selection};
use super::discard::{copy_discarded, discard_paths, discard_selection, restore_discarded, DiscardBackup, DiscardRequest, DiscardTarget, RecycleBin};
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

fn paths(list: &[&str]) -> DiscardTarget {
    DiscardTarget::Paths { paths: list.iter().map(|p| p.to_string()).collect() }
}

/// The index's version of `path`, as `git show :path` prints it.
fn index_text(wt: &Path, path: &str) -> String {
    git(wt, &["show", &format!(":{path}")])
}

#[test]
fn discard_all_restores_every_tracked_change_and_leaves_untracked_files_unless_asked() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), "staged\n").unwrap();
    git(&wt, &["add", "README.md"]);
    std::fs::write(wt.join("README.md"), "staged, then changed\n").unwrap();
    std::fs::remove_file(wt.join("src/lib.rs")).unwrap();
    std::fs::write(wt.join("new.txt"), "untracked\n").unwrap();

    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let out = discard_paths(&locks, &bin, &wt, 4, &DiscardTarget::All { include_untracked: false }).unwrap();
    assert_eq!(out.status.request_id, 4);
    // The staged change stays staged and the worktree matches it; the untracked file stays.
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), "staged\n");
    assert_eq!(index_text(&wt, "README.md"), "staged\n");
    assert_eq!(std::fs::read_to_string(wt.join("src/lib.rs")).unwrap(), "fn main() {}\n");
    assert_eq!(std::fs::read_to_string(wt.join("new.txt")).unwrap(), "untracked\n");
    assert!(bin.names().is_empty());
    let mut kept: Vec<(String, Option<Vec<u8>>)> =
        out.backups.iter().map(|b| (b.path.clone(), b.blob.as_deref().map(|o| blob_bytes(&wt, o)))).collect();
    kept.sort();
    assert_eq!(kept, [("README.md".into(), Some(b"staged, then changed\n".to_vec())), ("src/lib.rs".into(), None)]);

    // Undo puts both back: the edit, and the deletion.
    restore_discarded(&locks, &bin, &wt, 5, &out.backups).unwrap();
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), "staged, then changed\n");
    assert!(!wt.join("src/lib.rs").exists());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn discard_all_with_untracked_files_acts_beyond_the_status_cap() {
    let _heavy = crate::slices::git::test_load::heavy();
    let (root, wt) = repo_with_worktree();
    std::fs::create_dir_all(wt.join("many")).unwrap();
    for i in 0..10_002 {
        std::fs::write(wt.join(format!("many/f{i:05}.txt")), format!("{i}")).unwrap();
    }
    std::fs::write(wt.join("README.md"), "changed\n").unwrap();
    std::fs::write(wt.join(".gitignore"), "*.log\n").unwrap();
    git(&wt, &["add", ".gitignore"]);
    git(&wt, &["commit", "-q", "-m", "ignore logs"]);
    std::fs::write(wt.join("debug.log"), "ignored\n").unwrap();

    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let out = discard_paths(&locks, &bin, &wt, 1, &DiscardTarget::All { include_untracked: true }).unwrap();
    assert!(out.status.entries.is_empty(), "{:?}", &out.status.entries[..1]);
    assert_eq!(out.backups.len(), 10_003);
    assert_eq!(bin.names().len(), 10_002);
    // The emptied folder goes; an ignored file is never touched.
    assert!(!wt.join("many").exists());
    assert_eq!(std::fs::read_to_string(wt.join("debug.log")).unwrap(), "ignored\n");
    let last = out.backups.iter().find(|b| b.path == "many/f10001.txt").unwrap();
    assert_eq!(blob_bytes(&wt, last.blob.as_deref().unwrap()), b"10001");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn discarding_an_untracked_folder_bins_its_files_and_keeps_ignored_ones() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join(".gitignore"), "*.log\n").unwrap();
    git(&wt, &["add", ".gitignore"]);
    git(&wt, &["commit", "-q", "-m", "ignore logs"]);
    std::fs::create_dir_all(wt.join("notes/deep")).unwrap();
    std::fs::write(wt.join("notes/a.md"), "a\n").unwrap();
    std::fs::write(wt.join("notes/deep/b.md"), "b\n").unwrap();
    std::fs::write(wt.join("notes/run.log"), "ignored\n").unwrap();
    std::fs::write(wt.join("other.md"), "other\n").unwrap();

    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let out = discard_paths(&locks, &bin, &wt, 1, &paths(&["notes"])).unwrap();
    assert_eq!(bin.names(), ["a.md", "b.md"]);
    assert!(!wt.join("notes/deep").exists());
    assert_eq!(std::fs::read_to_string(wt.join("notes/run.log")).unwrap(), "ignored\n");
    assert!(wt.join("other.md").exists());
    assert_eq!(out.backups.len(), 2);

    restore_discarded(&locks, &bin, &wt, 1, &out.backups).unwrap();
    assert_eq!(std::fs::read_to_string(wt.join("notes/deep/b.md")).unwrap(), "b\n");
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

#[test]
fn a_stale_diff_discards_nothing() {
    let (root, wt, changed) = two_hunks();
    let stale = token(&wt, "README.md");
    let edited = changed.replace("line 6\n", "line six\n");
    std::fs::write(wt.join("README.md"), &edited).unwrap();

    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    for selection in [Selection::Hunks { hunks: vec![0] }, Selection::File] {
        assert_eq!(
            discard_selection(&locks, &bin, &wt, 1, 2, &discard("README.md", &stale, selection)),
            Err(GitError::StaleDiff)
        );
    }
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), edited);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn discarding_some_lines_of_an_untracked_file_keeps_the_rest_of_it() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("new.txt"), "keep\ndrop\nkeep too\n").unwrap();
    let diff = read_file_diff(&wt, 1, "new.txt", &DiffSide::Unstaged, 3, false).unwrap();
    assert_eq!(diff.hunks[0].lines[1].text, "drop");

    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let lines = Selection::Lines { lines: vec![LineRef { hunk: 0, line: 1 }] };
    let out = discard_selection(&locks, &bin, &wt, 1, 2, &discard("new.txt", &diff.diff_token, lines)).unwrap();
    assert_eq!(std::fs::read_to_string(wt.join("new.txt")).unwrap(), "keep\nkeep too\n");
    assert!(bin.names().is_empty());
    // It stays untracked: discarding lines never touches the index.
    assert_eq!(out.status.entries.iter().map(|e| e.xy.as_str()).collect::<Vec<_>>(), ["??"]);
    restore_discarded(&locks, &bin, &wt, 1, &[out.backup]).unwrap();
    assert_eq!(std::fs::read_to_string(wt.join("new.txt")).unwrap(), "keep\ndrop\nkeep too\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_restore_or_copy_only_writes_inside_the_worktree() {
    let (root, wt, _) = two_hunks();
    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let out = discard_selection(&locks, &bin, &wt, 1, 2, &discard("README.md", &token(&wt, "README.md"), Selection::File)).unwrap();
    let outside = root.join("outside.txt");
    let absolute = outside.to_string_lossy().into_owned();
    for bad in ["../outside.txt", "a/../../outside.txt", absolute.as_str(), "/etc/passwd", "C:/Windows/x.txt", ".git/config", ".GIT/hooks/pre-commit", ""] {
        let backup = DiscardBackup { path: bad.into(), ..out.backup.clone() };
        assert!(matches!(restore_discarded(&locks, &bin, &wt, 1, &[backup.clone()]), Err(GitError::Other { .. })), "{bad:?} restored");
        assert!(matches!(copy_discarded(&locks, &wt, 1, &[backup]), Err(GitError::Other { .. })), "{bad:?} copied");
    }
    assert!(!outside.exists());
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn a_restore_through_a_symlinked_folder_that_leaves_the_worktree_is_refused() {
    let (root, wt, _) = two_hunks();
    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let out = discard_selection(&locks, &bin, &wt, 1, 2, &discard("README.md", &token(&wt, "README.md"), Selection::File)).unwrap();
    std::fs::create_dir_all(root.join("elsewhere")).unwrap();
    std::os::unix::fs::symlink(root.join("elsewhere"), wt.join("link")).unwrap();
    let backup = DiscardBackup { path: "link/README.md".into(), blob: out.backup.blob.clone(), after: None };
    assert!(matches!(restore_discarded(&locks, &bin, &wt, 1, &[backup]), Err(GitError::Other { .. })));
    assert!(!root.join("elsewhere/README.md").exists());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn copying_a_discard_writes_its_bytes_to_a_new_file_beside_the_changed_one() {
    let (root, wt, changed) = two_hunks();
    let locks = StagingLocks::default();
    let bin = TestBin::new(&root);
    let out = discard_selection(&locks, &bin, &wt, 1, 2, &discard("README.md", &token(&wt, "README.md"), Selection::File)).unwrap();
    std::fs::write(wt.join("README.md"), "edited after the discard\n").unwrap();
    assert!(restore_discarded(&locks, &bin, &wt, 1, &[out.backup.clone()]).is_err());

    let copied = copy_discarded(&locks, &wt, 7, &[out.backup.clone()]).unwrap();
    assert_eq!(copied.paths, ["README (discarded).md"]);
    assert_eq!(copied.status.request_id, 7);
    assert_eq!(std::fs::read_to_string(wt.join("README (discarded).md")).unwrap(), changed);
    // The changed file is left alone, and a second copy never overwrites the first.
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), "edited after the discard\n");
    let again = copy_discarded(&locks, &wt, 8, &[out.backup]).unwrap();
    assert_eq!(again.paths, ["README (discarded 2).md"]);
    assert_eq!(std::fs::read_to_string(wt.join("README (discarded).md")).unwrap(), changed);
    let _ = std::fs::remove_dir_all(root);
}
