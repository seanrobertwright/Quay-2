//! One long-lived `git cat-file --batch` per repo (#350), so object reads don't pay a process spawn
//! each. A graph session owns its repo's reader and starts it on the first read.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Stdio};

use super::super::error::GitError;

/// An object as `cat-file --batch` returned it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitObject {
    /// `commit`, `tree`, `blob` or `tag`.
    pub kind: String,
    pub bytes: Vec<u8>,
}

/// A running `git cat-file --batch` for one repo. Dropping it ends the process.
pub struct CatFileBatch {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

fn other(stderr: impl Into<String>) -> GitError {
    GitError::Other { stderr: stderr.into() }
}

impl CatFileBatch {
    pub fn start(repo: &Path) -> Result<Self, GitError> {
        let mut child = crate::spawn::hidden_command("git")
            .arg("-C")
            .arg(repo)
            .args(["--no-optional-locks", "cat-file", "--batch"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| other(format!("could not run git cat-file: {e}")))?;
        let stdin = child.stdin.take().ok_or_else(|| other("git cat-file has no stdin"))?;
        let stdout = BufReader::new(child.stdout.take().ok_or_else(|| other("git cat-file has no stdout"))?);
        Ok(Self { child, stdin, stdout })
    }

    /// The object `name` names (an oid or any revision git resolves), or `None` when there is none.
    pub fn read(&mut self, name: &str) -> Result<Option<GitObject>, GitError> {
        // cat-file reads one name per line, so a line break would smuggle in a second request.
        if name.is_empty() || name.contains(['\n', '\r', '\0']) {
            return Err(other(format!("{name:?} is not an object name")));
        }
        writeln!(self.stdin, "{name}")
            .and_then(|()| self.stdin.flush())
            .map_err(|e| other(format!("git cat-file stopped accepting requests: {e}")))?;
        let mut header = String::new();
        if self.stdout.read_line(&mut header).map_err(|e| other(format!("git cat-file: {e}")))? == 0 {
            return Err(other("git cat-file exited"));
        }
        let header = header.trim_end_matches('\n');
        if header.ends_with(" missing") || header.ends_with(" ambiguous") {
            return Ok(None);
        }
        // "<oid> <type> <size>"
        let mut parts = header.rsplitn(3, ' ');
        let size = parts.next().and_then(|s| s.parse::<usize>().ok());
        let kind = parts.next();
        let (Some(size), Some(kind)) = (size, kind) else {
            return Err(other(format!("git cat-file printed {header:?}")));
        };
        let mut bytes = vec![0u8; size];
        let mut newline = [0u8; 1];
        self.stdout
            .read_exact(&mut bytes)
            .and_then(|()| self.stdout.read_exact(&mut newline))
            .map_err(|e| other(format!("git cat-file ended mid-object: {e}")))?;
        Ok(Some(GitObject { kind: kind.to_string(), bytes }))
    }
}

impl Drop for CatFileBatch {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
