//! The one `git log` a graph session runs (#350, #353, #370) and the parser for its records.

use std::io::BufRead;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Deserialize;

/// Commit order for the walk. Date order is the default; topo order is a per-session toggle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphOrder {
    #[default]
    Date,
    Topo,
}

/// The fixed format: hash, parents, author name, author email, author time, committer time,
/// subject, then the `Quay-Agent` and `Co-authored-by` trailer values (#353). Every field ends in
/// NUL: `%x00` ends the first eight, and `-z` ends the record after the ninth.
const LOG_FORMAT: &str = "--format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%ct%x00%s%x00\
%(trailers:key=Quay-Agent,valueonly,separator=%x1F)%x00\
%(trailers:key=Co-authored-by,valueonly,separator=%x1F)";

/// NUL-terminated fields per record.
const FIELDS: usize = 9;

/// The `git log` for a session in `repo`. `with_head` adds `HEAD` to the rev set; a repo whose HEAD
/// is unborn walks without it. The rev set never names `--tags` (#370) or `--all`, which would pull
/// in stash and notes refs.
pub fn log_command(repo: &Path, order: GraphOrder, with_head: bool) -> Command {
    let mut cmd = crate::spawn::hidden_command("git");
    cmd.arg("-C")
        .arg(repo)
        .args(["--no-optional-locks", "log", "--no-color", "--no-show-signature"])
        .arg(match order {
            GraphOrder::Date => "--date-order",
            GraphOrder::Topo => "--topo-order",
        })
        .args(["-z", LOG_FORMAT, "--branches", "--remotes"]);
    if with_head {
        cmd.arg("HEAD");
    }
    cmd.arg("--")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

/// One commit as `git log` printed it. Trailer values stay here for the provenance pass (#381)
/// and never reach the frontend raw.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogRecord {
    pub oid: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    /// Seconds since the epoch.
    pub author_time: i64,
    /// Seconds since the epoch.
    pub committer_time: i64,
    pub subject: String,
    /// `Quay-Agent` trailer values, in message order.
    pub quay_agent: Vec<String>,
    /// `Co-authored-by` trailer values, in message order.
    pub co_authored_by: Vec<String>,
}

/// Reads [`LogRecord`]s from `git log` output in the [`LOG_FORMAT`] layout.
pub struct LogReader<R> {
    input: R,
    field: Vec<u8>,
}

impl<R: BufRead> LogReader<R> {
    pub fn new(input: R) -> Self {
        Self { input, field: Vec::new() }
    }

    /// The next field as text, `None` at a clean end of input.
    fn next_field(&mut self) -> std::io::Result<Option<String>> {
        self.field.clear();
        if self.input.read_until(0, &mut self.field)? == 0 {
            return Ok(None);
        }
        if self.field.pop() != Some(0) {
            return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "git log ended mid-field"));
        }
        // Commit metadata isn't guaranteed to be UTF-8; never trust it to be.
        Ok(Some(String::from_utf8_lossy(&self.field).into_owned()))
    }

    /// The next record, `None` at a clean end of input, or an error for a cut-off or garbled one.
    pub fn next_record(&mut self) -> std::io::Result<Option<LogRecord>> {
        let mut fields = Vec::with_capacity(FIELDS);
        while fields.len() < FIELDS {
            match self.next_field()? {
                Some(field) => fields.push(field),
                None if fields.is_empty() => return Ok(None),
                None => {
                    return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "git log ended mid-record"))
                }
            }
        }
        let mut it = fields.into_iter();
        let mut next = || it.next().unwrap_or_default();
        let oid = next();
        if oid.is_empty() || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(invalid(format!("git log printed {oid:?} where a commit hash belongs")));
        }
        let parents = next().split_whitespace().map(str::to_string).collect();
        let author_name = next();
        let author_email = next();
        let author_time = parse_time(&next())?;
        let committer_time = parse_time(&next())?;
        let subject = next();
        let quay_agent = trailer_values(&next());
        let co_authored_by = trailer_values(&next());
        Ok(Some(LogRecord {
            oid,
            parents,
            author_name,
            author_email,
            author_time,
            committer_time,
            subject,
            quay_agent,
            co_authored_by,
        }))
    }
}

fn invalid(message: String) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message)
}

fn parse_time(text: &str) -> std::io::Result<i64> {
    text.parse().map_err(|_| invalid(format!("git log printed {text:?} where a timestamp belongs")))
}

/// Trailer values joined by U+001F, without empty ones.
fn trailer_values(text: &str) -> Vec<String> {
    text.split('\u{1f}').map(str::trim).filter(|v| !v.is_empty()).map(str::to_string).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(fields: &[&str]) -> Vec<u8> {
        fields.iter().flat_map(|f| f.bytes().chain(std::iter::once(0))).collect()
    }

    #[test]
    fn reads_records_with_merges_roots_and_trailers() {
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        let c = "c".repeat(40);
        let mut bytes = record(&[&a, &format!("{b} {c}"), "Ann", "ann@x", "100", "200", "Merge", "codex", ""]);
        bytes.extend(record(&[&b, "", "Bo", "bo@x", "50", "60", "root", "", "Claude <noreply@anthropic.com>\u{1f}Ed <e@x>"]));
        let mut reader = LogReader::new(&bytes[..]);
        let first = reader.next_record().unwrap().unwrap();
        assert_eq!(first.parents, vec![b.clone(), c]);
        assert_eq!((first.author_time, first.committer_time), (100, 200));
        assert_eq!(first.quay_agent, vec!["codex"]);
        assert!(first.co_authored_by.is_empty());
        let second = reader.next_record().unwrap().unwrap();
        assert!(second.parents.is_empty());
        assert_eq!(second.co_authored_by, vec!["Claude <noreply@anthropic.com>", "Ed <e@x>"]);
        assert_eq!(reader.next_record().unwrap(), None);
    }

    #[test]
    fn keeps_non_utf8_metadata_readable() {
        let a = "a".repeat(40);
        let mut bytes = record(&[&a, "", "", "e@x", "1", "1", "", "", ""]);
        // Replace the empty author name with Latin-1 "José".
        let at = bytes.iter().position(|&b| b == 0).unwrap() + 2;
        bytes.splice(at..at, [b'J', b'o', b's', 0xe9]);
        let rec = LogReader::new(&bytes[..]).next_record().unwrap().unwrap();
        assert_eq!(rec.author_name, "Jos\u{fffd}");
    }

    #[test]
    fn rejects_a_cut_off_or_garbled_record() {
        let a = "a".repeat(40);
        let full = record(&[&a, "", "A", "a@x", "1", "1", "s", "", ""]);
        let cut = &full[..full.len() - 3];
        assert!(LogReader::new(cut).next_record().is_err());
        let garbled = record(&["not-a-hash", "", "A", "a@x", "1", "1", "s", "", ""]);
        assert!(LogReader::new(&garbled[..]).next_record().is_err());
        let bad_time = record(&[&a, "", "A", "a@x", "soon", "1", "s", "", ""]);
        assert!(LogReader::new(&bad_time[..]).next_record().is_err());
    }
}
