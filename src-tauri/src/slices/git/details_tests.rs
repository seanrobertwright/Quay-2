//! Commit details, files and verify (#397) against throwaway repositories built with the system git.

use std::path::Path;

use super::checkout_tests::rev;
use super::details::{commit_details, commit_files, verify_commit, CommitFiles, SignatureStatus, Trailer, Verification};
use super::graph::provenance::AgentSource;
use super::staging_tests::{git, repo_with_worktree};

/// Commits `message` in `wt` as `author`, with `committer` as its committer, changing `README.md`.
fn commit_as(wt: &Path, message: &str, author: (&str, &str), committer: (&str, &str)) -> String {
    std::fs::write(wt.join("README.md"), format!("{message}\n")).unwrap();
    git(wt, &["add", "README.md"]);
    let out = crate::spawn::hidden_command("git")
        .current_dir(wt)
        .args(["commit", "-q", "-F", "-"])
        .env("GIT_AUTHOR_NAME", author.0)
        .env("GIT_AUTHOR_EMAIL", author.1)
        .env("GIT_AUTHOR_DATE", "1700000000 +0000")
        .env("GIT_COMMITTER_NAME", committer.0)
        .env("GIT_COMMITTER_EMAIL", committer.1)
        .env("GIT_COMMITTER_DATE", "1700000600 +0000")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child.stdin.take().unwrap().write_all(message.as_bytes())?;
            child.wait_with_output()
        })
        .unwrap();
    assert!(out.status.success(), "commit: {}", String::from_utf8_lossy(&out.stderr));
    rev(wt, "HEAD")
}

#[test]
fn details_carry_the_body_committer_trailers_provenance_and_no_signature() {
    let (_root, wt) = repo_with_worktree();
    let message = "Fix the parser\n\nSee https://example.com/issue for why.\nSecond line.\n\nQuay-Agent: claude\nReviewed-by: Ada <ada@example.invalid>\n";
    let oid = commit_as(&wt, message, ("Ada", "ada@example.invalid"), ("Bob", "bob@example.invalid"));

    let details = commit_details(&wt, &oid[..10]).expect("details read");

    assert_eq!(details.oid, oid, "an abbreviated oid resolves to the full one");
    assert_eq!(details.subject, "Fix the parser");
    assert!(details.body.starts_with("See https://example.com/issue for why.\nSecond line."), "body: {:?}", details.body);
    assert_eq!(details.parents, vec![rev(&wt, "HEAD~1")]);
    assert_eq!((details.author.name.as_str(), details.author.email.as_str()), ("Ada", "ada@example.invalid"));
    assert_eq!(details.author.time_ms, 1_700_000_000_000);
    assert_eq!((details.committer.name.as_str(), details.committer.email.as_str()), ("Bob", "bob@example.invalid"));
    assert_eq!(details.committer.time_ms, 1_700_000_600_000);
    assert_eq!(
        details.trailers,
        vec![
            Trailer { key: "Quay-Agent".into(), value: "claude".into() },
            Trailer { key: "Reviewed-by".into(), value: "Ada <ada@example.invalid>".into() },
        ]
    );
    let agent = details.provenance.expect("the stamp names an agent");
    assert_eq!(agent.source, AgentSource::Stamp);
    assert!(!details.has_signature, "the commit is unsigned");
}

#[test]
fn details_refuse_an_oid_that_is_not_a_commit_it_can_resolve() {
    let (_root, wt) = repo_with_worktree();
    let tree = rev(&wt, "HEAD^{tree}");
    git(&wt, &["tag", "-a", "-m", "annotated", "v1"]);
    let tag = rev(&wt, "v1");
    for bad in ["", "--all", "HEAD", "main", "abc", "zzzzzzz", "0000000000", tree.as_str(), tag.as_str()] {
        assert!(commit_details(&wt, bad).is_err(), "{bad:?} is refused");
    }
}

#[test]
fn verifying_an_unsigned_commit_says_none_with_no_signer() {
    let (_root, wt) = repo_with_worktree();
    let head = rev(&wt, "HEAD");

    let verified = verify_commit(&wt, &head).expect("verify runs");

    assert_eq!(verified, Verification { status: SignatureStatus::None, signer: None });
    assert!(verify_commit(&wt, "--help").is_err(), "an option is refused");
}

/// Whether `ssh-keygen` runs here, which signing a commit with an SSH key needs.
fn has_ssh_keygen() -> bool {
    crate::spawn::hidden_command("ssh-keygen").arg("-?").output().is_ok()
}

#[test]
fn an_ssh_signed_commit_has_a_signature_that_verifies_good_once_its_key_is_allowed() {
    if !has_ssh_keygen() {
        eprintln!("skipped: no ssh-keygen");
        return;
    }
    let (root, wt) = repo_with_worktree();
    let key = root.join("signing_key");
    let out = crate::spawn::hidden_command("ssh-keygen")
        .args(["-q", "-t", "ed25519", "-N", "", "-C", "signer@example.invalid", "-f"])
        .arg(&key)
        .output()
        .unwrap();
    assert!(out.status.success(), "ssh-keygen: {}", String::from_utf8_lossy(&out.stderr));
    let public = std::fs::read_to_string(root.join("signing_key.pub")).unwrap();
    let key_path = key.to_string_lossy().replace('\\', "/");
    git(&wt, &["config", "gpg.format", "ssh"]);
    git(&wt, &["config", "user.signingkey", &key_path]);
    std::fs::write(wt.join("README.md"), "signed\n").unwrap();
    git(&wt, &["commit", "-q", "-S", "-am", "signed"]);
    let head = rev(&wt, "HEAD");

    assert!(commit_details(&wt, &head).unwrap().has_signature, "the commit carries a signature");
    let unknown = verify_commit(&wt, &head).expect("verify runs");
    assert_ne!(unknown.status, SignatureStatus::Good, "no allowed signers file yet: {unknown:?}");

    let allowed = root.join("allowed_signers");
    std::fs::write(&allowed, format!("signer@example.invalid {public}")).unwrap();
    git(&wt, &["config", "gpg.ssh.allowedSignersFile", &allowed.to_string_lossy().replace('\\', "/")]);
    let good = verify_commit(&wt, &head).expect("verify runs");
    assert_eq!(good.status, SignatureStatus::Good, "{good:?}");
}

/// The files as `(status, path, old path, additions, deletions)`.
fn files_of(files: &CommitFiles) -> Vec<(String, String, Option<String>, Option<u32>, Option<u32>)> {
    files.files.iter().map(|f| (f.status.clone(), f.path.clone(), f.old_path.clone(), f.additions, f.deletions)).collect()
}

#[test]
fn files_list_status_numstat_and_a_rename_with_an_odd_path() {
    let (_root, wt) = repo_with_worktree();
    let body: String = (1..=20).map(|n| format!("line {n}\n")).collect();
    std::fs::write(wt.join("notes.txt"), &body).unwrap();
    git(&wt, &["add", "notes.txt"]);
    git(&wt, &["commit", "-q", "-m", "notes"]);
    git(&wt, &["mv", "notes.txt", "odd name é.txt"]);
    std::fs::write(wt.join("odd name é.txt"), body.replace("line 3\n", "line three\n")).unwrap();
    std::fs::write(wt.join("README.md"), "readme\nmore\n").unwrap();
    git(&wt, &["add", "-A"]);
    git(&wt, &["commit", "-q", "-m", "rename"]);
    let head = rev(&wt, "HEAD");

    let files = commit_files(&wt, &head, None).expect("files read");

    let mut got = files_of(&files);
    got.sort();
    assert_eq!(
        got,
        vec![
            ("M".into(), "README.md".into(), None, Some(1), Some(0)),
            ("R".into(), "odd name é.txt".into(), Some("notes.txt".into()), Some(1), Some(1)),
        ]
    );
    assert_eq!((files.total, files.truncated), (2, false));
}

#[test]
fn a_binary_file_has_no_line_counts() {
    let (_root, wt) = repo_with_worktree();
    std::fs::write(wt.join("blob.bin"), [0u8, 1, 2, 0, 255, 0, 7]).unwrap();
    git(&wt, &["add", "blob.bin"]);
    git(&wt, &["commit", "-q", "-m", "binary"]);

    let files = commit_files(&wt, &rev(&wt, "HEAD"), None).expect("files read");

    assert_eq!(files_of(&files), vec![("A".into(), "blob.bin".into(), None, None, None)]);
}

/// `wt` with a merge of `side`, which changed `side.txt`, into `feat`, which changed `README.md`.
fn with_merge(wt: &Path) -> String {
    git(wt, &["switch", "-q", "-c", "side", "main"]);
    std::fs::write(wt.join("side.txt"), "side\n").unwrap();
    git(wt, &["add", "side.txt"]);
    git(wt, &["commit", "-q", "-m", "side"]);
    git(wt, &["switch", "-q", "feat"]);
    std::fs::write(wt.join("README.md"), "feat\n").unwrap();
    git(wt, &["commit", "-q", "-am", "feat"]);
    git(wt, &["merge", "-q", "--no-ff", "--no-edit", "side"]);
    rev(wt, "HEAD")
}

#[test]
fn a_merge_diffs_against_parent_one_by_default_and_parent_two_on_request() {
    let (_root, wt) = repo_with_worktree();
    let merge = with_merge(&wt);
    let paths = |files: &CommitFiles| files.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>();

    assert_eq!(paths(&commit_files(&wt, &merge, None).unwrap()), vec!["side.txt"], "parent 1 is feat");
    assert_eq!(paths(&commit_files(&wt, &merge, Some(1)).unwrap()), vec!["side.txt"]);
    assert_eq!(paths(&commit_files(&wt, &merge, Some(2)).unwrap()), vec!["README.md"], "parent 2 is side");
    assert_eq!(commit_details(&wt, &merge).unwrap().parents.len(), 2);
}

#[test]
fn a_parent_index_outside_the_parent_count_is_refused() {
    let (_root, wt) = repo_with_worktree();
    let merge = with_merge(&wt);
    let root = rev(&wt, "main");

    for bad in [0, 3, u32::MAX] {
        assert!(commit_files(&wt, &merge, Some(bad)).is_err(), "parent {bad} of a merge is refused");
    }
    assert!(commit_files(&wt, &root, Some(1)).is_err(), "a root commit has no parent 1");
    assert!(commit_files(&wt, "-p", None).is_err(), "an option is refused as an oid");
    let files = commit_files(&wt, &root, None).expect("a root commit diffs against the empty tree");
    let mut paths: Vec<_> = files.files.iter().map(|f| (f.status.clone(), f.path.clone())).collect();
    paths.sort();
    assert_eq!(paths, vec![("A".into(), "README.md".into()), ("A".into(), "src/lib.rs".into())]);
}
