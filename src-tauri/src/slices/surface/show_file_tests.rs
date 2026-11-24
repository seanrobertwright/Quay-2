//! What a click on a file link does: which file the file manager shows, when the diff view opens instead, and
//! what the operator is told when neither does.

use std::path::{Path, PathBuf};

use parking_lot::Mutex;

use super::show_file::{show_file, Shown};
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::{test_terminal, ClaudeStatus, RunKind};
use crate::test_support::TempDir;

/// A folder spelled as a terminal's is, without the system's prefix.
fn plain(path: &Path) -> PathBuf {
    let path = path.to_str().unwrap();
    PathBuf::from(path.strip_prefix(r"\\?\").unwrap_or(path))
}

struct Quay {
    terminals: PtyManager,
    revealed: Mutex<Vec<PathBuf>>,
    dir: TempDir,
}

impl Quay {
    /// Two terminals, each in a folder of its own.
    fn new() -> Self {
        let dir = TempDir::canonical("surface-show");
        let terminals = PtyManager::new();
        for id in ["one", "two"] {
            std::fs::create_dir(dir.join(id)).unwrap();
            let info = test_terminal(id, RunKind::Claude, ClaudeStatus::Working);
            let project_path = plain(&dir.join(id)).to_str().unwrap().to_string();
            terminals.insert_test_terminal(crate::slices::pty::models::TerminalInfo { project_path, ..info });
        }
        Self { terminals, revealed: Mutex::default(), dir }
    }

    fn file(&self, path: &str) -> PathBuf {
        path.split('/').fold(plain(&self.dir), |dir, name| dir.join(name))
    }

    fn write(&self, path: &str, content: &str) {
        let file = self.file(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, content).unwrap();
    }

    fn git(&self, dir: &str, args: &[&str]) {
        let mut git = crate::slices::git::op_runner::headless_git();
        git.current_dir(self.file(dir)).args(["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "commit.gpgsign=false"]);
        let out = git.args(args).output().unwrap();
        assert!(out.status.success(), "{args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    /// Terminal `one`'s folder as a repository whose `src/a.rs` and `src/b.rs` are committed.
    fn repository(&self) {
        self.git("one", &["init", "-q", "-b", "main"]);
        self.write("one/src/a.rs", "a\n");
        self.write("one/src/b.rs", "b\n");
        self.write("one/.gitignore", "*.log\n");
        self.git("one", &["add", "."]);
        self.git("one", &["commit", "-q", "-m", "first"]);
    }

    fn show_line(&self, terminal: &str, path: &str, line: Option<u32>) -> Result<Shown, String> {
        show_file(&self.terminals, terminal, path, line, |path| {
            self.revealed.lock().push(path.to_path_buf());
            Ok(())
        })
    }

    fn show(&self, terminal: &str, path: &str) -> Result<Shown, String> {
        self.show_line(terminal, path, None)
    }

    fn revealed(&self) -> Vec<PathBuf> {
        std::mem::take(&mut self.revealed.lock())
    }
}

fn diff(path: &str, side: &str, line: Option<u32>) -> Result<Shown, String> {
    Ok(serde_json::from_value(serde_json::json!({ "kind": "diff", "path": path, "side": side, "line": line })).unwrap())
}

#[test]
fn a_file_is_revealed_in_its_own_terminals_folder_and_never_in_anothers() {
    let quay = Quay::new();
    quay.write("one/src/a.rs", "one");
    quay.write("two/src/a.rs", "two");
    quay.write("two/only.rs", "two");

    assert_eq!(quay.show("one", "src/a.rs"), Ok(Shown::Revealed));
    assert_eq!(quay.revealed(), [quay.file("one/src/a.rs")]);
    assert_eq!(quay.show("two", "src/a.rs:12"), Ok(Shown::Revealed));
    assert_eq!(quay.revealed(), [quay.file("two/src/a.rs")]);

    assert_eq!(quay.show("one", "only.rs"), Err("Not opened: there is no only.rs.".to_string()));
    assert_eq!(quay.show("three", "only.rs"), Err("Not opened: Quay no longer has this terminal.".to_string()));
    assert!(quay.revealed().is_empty());
    // An absolute path is allowed outside the project
    let path = quay.file("two/only.rs");
    assert_eq!(quay.show("one", path.to_str().unwrap()), Ok(Shown::Revealed));
    assert_eq!(quay.revealed(), [path]);
    assert_eq!(quay.show("one", "src"), Ok(Shown::Revealed));
    assert_eq!(quay.revealed(), [quay.file("one/src")]);
}

#[test]
fn a_file_with_uncommitted_changes_opens_the_diff_view_at_its_line() {
    let quay = Quay::new();
    quay.repository();

    assert_eq!(quay.show("one", "src/a.rs"), Ok(Shown::Revealed), "nothing has changed");
    quay.write("one/src/a.rs", "changed\n");
    quay.write("one/src/b.rs", "staged\n");
    quay.git("one", &["add", "src/b.rs"]);
    quay.write("one/new/c.rs", "new\n");
    quay.write("one/x.log", "ignored\n");
    quay.revealed();

    assert_eq!(quay.show("one", "src/a.rs"), diff("src/a.rs", "unstaged", None));
    assert_eq!(quay.show("one", "src/a.rs:12"), diff("src/a.rs", "unstaged", Some(12)));
    assert_eq!(quay.show_line("one", "src/a.rs:12", Some(7)), diff("src/a.rs", "unstaged", Some(7)));
    assert_eq!(quay.show("one", "./src/../src/b.rs"), diff("src/b.rs", "staged", None));
    assert_eq!(quay.show("one", quay.file("one/new/c.rs").to_str().unwrap()), diff("new/c.rs", "unstaged", None));
    assert!(quay.revealed().is_empty());

    assert_eq!(quay.show("one", "x.log"), Ok(Shown::Revealed), "git ignores it");
    assert_eq!(quay.show("one", "src"), Ok(Shown::Revealed), "a folder has no diff");
    assert_eq!(quay.show("two", quay.file("one/src/a.rs").to_str().unwrap()), Ok(Shown::Revealed), "another terminal's worktree");
    assert_eq!(quay.revealed().len(), 3);

    std::fs::remove_file(quay.file("one/src/a.rs")).unwrap();
    assert_eq!(quay.show("one", "src/a.rs"), Err("Not opened: there is no src/a.rs.".to_string()));
}

#[test]
fn a_conflicted_file_and_one_under_a_terminal_that_is_not_at_its_worktrees_root_are_revealed() {
    let quay = Quay::new();
    quay.repository();
    quay.git("one", &["checkout", "-q", "-b", "other"]);
    quay.write("one/src/a.rs", "theirs\n");
    quay.git("one", &["commit", "-q", "-am", "theirs"]);
    quay.git("one", &["checkout", "-q", "main"]);
    quay.write("one/src/a.rs", "ours\n");
    quay.git("one", &["commit", "-q", "-am", "ours"]);
    let mut merge = crate::slices::git::op_runner::headless_git();
    merge.current_dir(quay.file("one")).args(["-c", "user.name=t", "-c", "user.email=t@t.invalid", "merge", "-q", "other"]);
    assert!(!merge.output().unwrap().status.success(), "the merge conflicts");
    assert_eq!(quay.show("one", "src/a.rs"), Ok(Shown::Revealed));

    quay.write("one/src/b.rs", "changed\n");
    let info = quay.terminals.get_info("two").unwrap();
    let project_path = quay.file("one/src").to_str().unwrap().to_string();
    quay.terminals.insert_test_terminal(crate::slices::pty::models::TerminalInfo { project_path, ..info });
    assert_eq!(quay.show("two", "b.rs"), Ok(Shown::Revealed));
    assert_eq!(quay.revealed(), [quay.file("one/src/a.rs"), quay.file("one/src/b.rs")]);
}

#[test]
fn a_path_that_is_not_opened_says_so_and_nothing_is_revealed() {
    let quay = Quay::new();
    for (path, said) in [
        ("//host/share/x", "Not opened: //host/share/x is not a file on this computer, or Quay cannot tell that it is."),
        ("file://host/x", "Not opened: file://host/x is not a file on this computer, or Quay cannot tell that it is."),
        ("", "Not opened: the link names no file."),
        ("a\0b", "Not opened: a b is not a path Quay can open."),
    ] {
        assert_eq!(quay.show("one", path), Err(said.to_string()), "{path:?}");
    }
    let long = "x".repeat(5000);
    let said = quay.show("one", &long).unwrap_err();
    assert!(said.starts_with("Not opened: xxx") && said.chars().count() < 400, "{said}");
    assert!(quay.revealed().is_empty());
}

#[test]
fn what_the_file_manager_would_not_show_is_said() {
    let quay = Quay::new();
    quay.write("one/a", "a");
    let said = show_file(&quay.terminals, "one", "a", None, |_| Err("no window".to_string()));
    assert_eq!(said, Err("Not opened: the file manager could not show a (no window).".to_string()));
}
