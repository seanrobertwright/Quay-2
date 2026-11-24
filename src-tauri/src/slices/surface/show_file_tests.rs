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
    /// The folders of the projects added to Quay.
    projects: Vec<String>,
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
        Self { terminals, projects: Vec::new(), revealed: Mutex::default(), dir }
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

    /// The folder `dir` as a repository whose `src/a.rs` and `src/b.rs` are committed.
    fn repository_in(&self, dir: &str) {
        self.write(&format!("{dir}/src/a.rs"), "a\n");
        self.write(&format!("{dir}/src/b.rs"), "b\n");
        self.write(&format!("{dir}/.gitignore"), "*.log\n");
        self.git(dir, &["init", "-q", "-b", "main"]);
        self.git(dir, &["add", "."]);
        self.git(dir, &["commit", "-q", "-m", "first"]);
    }

    /// Terminal `one`'s folder as that repository.
    fn repository(&self) {
        self.repository_in("one");
    }

    /// Moves `terminal` to the folder `dir`.
    fn run_in(&self, terminal: &str, dir: &str) {
        let info = self.terminals.get_info(terminal).unwrap();
        let project_path = self.file(dir).to_str().unwrap().to_string();
        self.terminals.insert_test_terminal(crate::slices::pty::models::TerminalInfo { project_path, ..info });
    }

    /// The answer that has the diff view open on `path` in the worktree that is the folder `dir`.
    fn diff_in(&self, dir: &str, path: &str, side: &str, line: Option<u32>) -> Result<Shown, String> {
        let worktree = self.file(dir).to_str().unwrap().to_string();
        let diff = serde_json::json!({ "kind": "diff", "worktree": worktree, "path": path, "side": side, "line": line });
        Ok(serde_json::from_value(diff).unwrap())
    }

    /// The same in terminal `one`'s folder.
    fn diff(&self, path: &str, side: &str, line: Option<u32>) -> Result<Shown, String> {
        self.diff_in("one", path, side, line)
    }

    fn show_line(&self, terminal: &str, path: &str, line: Option<u32>) -> Result<Shown, String> {
        show_file(&self.terminals, &self.projects, terminal, path, line, |path| {
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

    assert_eq!(quay.show("one", "src/a.rs"), quay.diff("src/a.rs", "unstaged", None));
    assert_eq!(quay.show("one", "src/a.rs:12"), quay.diff("src/a.rs", "unstaged", Some(12)));
    assert_eq!(quay.show_line("one", "src/a.rs:12", Some(7)), quay.diff("src/a.rs", "unstaged", Some(7)));
    assert_eq!(quay.show("one", "./src/../src/b.rs"), quay.diff("src/b.rs", "staged", None));
    assert_eq!(quay.show("one", quay.file("one/new/c.rs").to_str().unwrap()), quay.diff("new/c.rs", "unstaged", None));
    assert!(quay.revealed().is_empty());

    assert_eq!(quay.show("one", "x.log"), Ok(Shown::Revealed), "git ignores it");
    assert_eq!(quay.show("one", "src"), Ok(Shown::Revealed), "a folder has no diff");
    assert_eq!(quay.show("two", quay.file("one/src/a.rs").to_str().unwrap()), Ok(Shown::Revealed), "another terminal's worktree");
    assert_eq!(quay.revealed().len(), 3);

    std::fs::remove_file(quay.file("one/src/a.rs")).unwrap();
    assert_eq!(quay.show("one", "src/a.rs"), Err("Not opened: there is no src/a.rs.".to_string()));
}

#[test]
fn a_conflicted_file_is_one_with_uncommitted_changes() {
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

    assert_eq!(quay.show("one", "src/a.rs:3"), quay.diff("src/a.rs", "conflicted", Some(3)));
    assert!(quay.revealed().is_empty());
}

#[test]
fn a_changed_file_opens_the_diff_view_under_a_terminal_in_a_subfolder() {
    let quay = Quay::new();
    quay.repository();
    quay.write("one/src/b.rs", "changed\n");
    quay.write("one/top.rs", "new\n");
    quay.run_in("two", "one/src");

    assert_eq!(quay.show("two", "b.rs"), quay.diff("src/b.rs", "unstaged", None));
    assert_eq!(quay.show("two", "../top.rs"), quay.diff("top.rs", "unstaged", None));
    assert!(quay.revealed().is_empty());
}

#[test]
fn a_changed_file_in_another_worktree_of_the_terminals_repository_opens_the_diff_view_there() {
    let quay = Quay::new();
    quay.repository();
    quay.git("one", &["worktree", "add", "-q", "../linked", "-b", "linked"]);
    quay.write("linked/src/a.rs", "changed\n");
    quay.write("one/src/b.rs", "changed\n");
    quay.run_in("two", "linked");

    for (terminal, written, dir, path) in [("one", "../linked/src/a.rs", "linked", "src/a.rs"), ("two", "../one/src/b.rs", "one", "src/b.rs")] {
        let shown = quay.show(terminal, written);
        let Ok(Shown::Diff { worktree, path: shown, .. }) = shown else { panic!("{shown:?}") };
        // As git spells it, which is with `/` on every system
        assert_eq!((PathBuf::from(worktree), shown.as_str()), (quay.file(dir), path));
    }
    assert!(quay.revealed().is_empty());
}

#[test]
fn a_changed_file_in_another_repository_opens_the_diff_view_only_when_that_is_a_project_of_quays() {
    let mut quay = Quay::new();
    quay.repository();
    quay.repository_in("other");
    quay.write("other/src/a.rs", "changed\n");
    // A program git runs where it looks for changes, as any repository can name one
    quay.git("other", &["config", "core.fsmonitor", "echo ran > ran.log; false"]);

    assert_eq!(quay.show("one", "../other/src/a.rs"), Ok(Shown::Revealed));
    assert_eq!(quay.revealed(), [quay.file("other/src/a.rs")]);
    assert!(!quay.file("other/ran.log").exists(), "git was run in it");

    let project = |dir: &str| quay.file(dir).to_str().unwrap().to_string();
    quay.projects = vec!["//host/share/gone".to_string(), project("nowhere"), project("other")];
    assert_eq!(quay.show("one", "../other/src/a.rs"), quay.diff_in("other", "src/a.rs", "unstaged", None));
    assert!(quay.revealed().is_empty());
    assert!(quay.file("other/ran.log").exists(), "the probe is one git runs");
}

#[test]
fn a_folder_that_only_claims_to_be_a_worktree_of_the_terminals_repository_has_no_diff() {
    let quay = Quay::new();
    quay.repository();
    quay.write("forged/src/a.rs", "new\n");
    quay.write("forged/.git", &format!("gitdir: {}\n", quay.file("one/.git").to_str().unwrap()));
    assert_eq!(quay.show("one", "../forged/src/a.rs"), Ok(Shown::Revealed));
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
    let said = show_file(&quay.terminals, &quay.projects, "one", "a", None, |_| Err("no window".to_string()));
    assert_eq!(said, Err("Not opened: the file manager could not show a (no window).".to_string()));
}
