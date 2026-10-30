//! What a graph session sends over its `Channel` (#369): `Rows` pages as raw little-endian bytes,
//! every other [`GraphEvent`] as JSON. `src/slices/git/topos/graphPage.ts` decodes the bytes.
//!
//! Page layout, format version 1. Offsets are bytes from the start of the page; every `u32` and
//! `f64` is little-endian, and every section starts on an 8-byte boundary.
//!
//! | Offset | Type | Field |
//! | --- | --- | --- |
//! | 0 | u32 | [`PAGE_MAGIC`] |
//! | 4 | u16 | [`PAGE_FORMAT_VERSION`] |
//! | 6 | u16 | header length, [`HEADER_BYTES`] |
//! | 8 | u32 | session id |
//! | 12 | u32 | page index, from 0 within the session |
//! | 16 | u32 | first row, the session-wide index of the page's first row |
//! | 20 | u32 | row count |
//! | 24 | u32 | edge count, 0 until lanes land (#375) |
//! | 28 | u32 | close count, 0 until lanes land (#375) |
//! | 32 | u32 | offset of `authorTimeMs`: one `f64` per row, epoch ms |
//! | 36 | u32 | offset of `authorIds`: one `u32` per row, an index into the session's author table |
//! | 40 | u32 | offset of the JSON section |
//! | 44 | u32 | length of the JSON section in bytes |
//!
//! The JSON section is UTF-8 [`PageJson`]: the rows' oids and subjects, and the authors this page
//! adds to the session's author table, which the frontend appends in order.

use std::collections::HashMap;

use serde::Serialize;

use super::super::error::GitError;
use super::log::LogRecord;

/// "TGPG" read as a little-endian `u32`: Topos graph page.
pub const PAGE_MAGIC: u32 = u32::from_le_bytes(*b"TGPG");
pub const PAGE_FORMAT_VERSION: u16 = 1;
pub const HEADER_BYTES: usize = 48;

/// Every `GraphEvent` except `Rows`, which is a raw page. Each carries `sessionId`, so the frontend
/// drops messages from a session it no longer shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum GraphEvent {
    /// The walk has started.
    Started { session_id: u32 },
    /// Every row the frontend asked for has been sent and more remain; `git_graph_more` resumes.
    Paused { session_id: u32, rows_loaded: u32 },
    /// The walk finished; `total` rows were sent.
    Done { session_id: u32, total: u32 },
    /// The session stopped at the hard ceiling of `cap` rows with history left unread.
    Truncated { session_id: u32, cap: u32 },
    /// git failed; rows already sent stay valid.
    Failed { session_id: u32, error: GitError },
}

/// An author as the frontend's author table holds it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub name: String,
    pub email: String,
}

/// The JSON section of a page.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageJson<'a> {
    pub oids: Vec<&'a str>,
    pub subjects: Vec<&'a str>,
    /// Authors first seen in this page, appended to the session's table in order.
    pub new_authors: Vec<Author>,
}

/// Interns authors across a session, so each one crosses the channel once.
#[derive(Default)]
pub struct AuthorTable {
    ids: HashMap<Author, u32>,
}

impl AuthorTable {
    /// The id of `author`, pushing it onto `added` when it is new.
    fn intern(&mut self, author: Author, added: &mut Vec<Author>) -> u32 {
        let next = self.ids.len() as u32;
        *self.ids.entry(author).or_insert_with_key(|author| {
            added.push(author.clone());
            next
        })
    }
}

fn put_u32(out: &mut [u8], at: usize, value: u32) {
    out[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

fn align8(n: usize) -> usize {
    n.div_ceil(8) * 8
}

/// Encodes `rows` as page `page_index` of session `session_id`, starting at session row `first_row`.
pub fn encode_page(
    session_id: u32,
    page_index: u32,
    first_row: u32,
    rows: &[LogRecord],
    authors: &mut AuthorTable,
) -> Vec<u8> {
    let n = rows.len();
    let mut new_authors = Vec::new();
    let author_ids: Vec<u32> = rows
        .iter()
        .map(|r| authors.intern(Author { name: r.author_name.clone(), email: r.author_email.clone() }, &mut new_authors))
        .collect();
    let json = serde_json::to_vec(&PageJson {
        oids: rows.iter().map(|r| r.oid.as_str()).collect(),
        subjects: rows.iter().map(|r| r.subject.as_str()).collect(),
        new_authors,
    })
    .expect("page JSON serializes");

    let author_time_at = HEADER_BYTES;
    let author_ids_at = author_time_at + 8 * n;
    let json_at = align8(author_ids_at + 4 * n);
    let mut out = vec![0u8; json_at + json.len()];

    put_u32(&mut out, 0, PAGE_MAGIC);
    out[4..6].copy_from_slice(&PAGE_FORMAT_VERSION.to_le_bytes());
    out[6..8].copy_from_slice(&(HEADER_BYTES as u16).to_le_bytes());
    put_u32(&mut out, 8, session_id);
    put_u32(&mut out, 12, page_index);
    put_u32(&mut out, 16, first_row);
    put_u32(&mut out, 20, n as u32);
    put_u32(&mut out, 24, 0);
    put_u32(&mut out, 28, 0);
    put_u32(&mut out, 32, author_time_at as u32);
    put_u32(&mut out, 36, author_ids_at as u32);
    put_u32(&mut out, 40, json_at as u32);
    put_u32(&mut out, 44, json.len() as u32);

    for (i, r) in rows.iter().enumerate() {
        let a = author_time_at + 8 * i;
        out[a..a + 8].copy_from_slice(&((r.author_time as f64) * 1000.0).to_le_bytes());
        put_u32(&mut out, author_ids_at + 4 * i, author_ids[i]);
    }
    out[json_at..].copy_from_slice(&json);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rows behind the checked-in fixture that `graphPage.test.ts` decodes.
    fn fixture_rows() -> Vec<LogRecord> {
        let row = |oid: char, name: &str, email: &str, t: i64, subject: &str| LogRecord {
            oid: oid.to_string().repeat(40),
            parents: vec![],
            author_name: name.into(),
            author_email: email.into(),
            author_time: t,
            committer_time: t + 60,
            subject: subject.into(),
            quay_agent: vec![],
            co_authored_by: vec![],
        };
        vec![
            row('a', "Ada", "ada@example.invalid", 1_700_000_000, "Add the graph"),
            row('b', "Bo", "bo@example.invalid", 1_699_999_000, "Fix \"quotes\" and ünïcode"),
            row('c', "Ada", "ada@example.invalid", 1_699_998_000, "Initial commit"),
        ]
    }

    fn fixture_path() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/slices/git/topos/fixtures/graph-page-v1.bin")
    }

    /// The fixture is page 2 of session 7, starting at row 1024, after a page that already
    /// introduced one author, so the decoder sees a non-zero first author id.
    fn fixture_bytes() -> Vec<u8> {
        let mut authors = AuthorTable::default();
        authors.intern(Author { name: "Earlier".into(), email: "earlier@example.invalid".into() }, &mut Vec::new());
        encode_page(7, 2, 1024, &fixture_rows(), &mut authors)
    }

    #[test]
    fn the_checked_in_fixture_is_what_rust_encodes() {
        let bytes = fixture_bytes();
        if std::env::var_os("QUAY_UPDATE_FIXTURES").is_some() {
            std::fs::write(fixture_path(), &bytes).unwrap();
        }
        let checked_in = std::fs::read(fixture_path()).expect("fixture exists; QUAY_UPDATE_FIXTURES=1 writes it");
        assert_eq!(checked_in, bytes, "rerun with QUAY_UPDATE_FIXTURES=1 and commit the fixture");
    }

    #[test]
    fn the_header_names_aligned_sections_and_new_authors_only() {
        let bytes = fixture_bytes();
        let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
        assert_eq!(u32_at(0), PAGE_MAGIC);
        assert_eq!(&bytes[0..4], b"TGPG");
        assert_eq!((u32_at(8), u32_at(12), u32_at(16), u32_at(20)), (7, 2, 1024, 3));
        for section in [32, 36, 40] {
            assert_eq!(u32_at(section) % 8, 0, "section at header offset {section} is aligned");
        }
        let first_time = f64::from_le_bytes(bytes[HEADER_BYTES..HEADER_BYTES + 8].try_into().unwrap());
        assert_eq!(first_time, 1_700_000_000_000.0);
        let ids_at = u32_at(36) as usize;
        let ids: Vec<u32> = (0..3).map(|i| u32_at(ids_at + 4 * i)).collect();
        assert_eq!(ids, vec![1, 2, 1]);
        let (json_at, json_len) = (u32_at(40) as usize, u32_at(44) as usize);
        assert_eq!(json_at + json_len, bytes.len());
        let json: serde_json::Value = serde_json::from_slice(&bytes[json_at..]).unwrap();
        assert_eq!(json["newAuthors"].as_array().unwrap().len(), 2);
        assert_eq!(json["subjects"][1], "Fix \"quotes\" and ünïcode");
    }
}
