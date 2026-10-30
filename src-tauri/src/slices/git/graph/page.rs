//! What a graph session sends over its `Channel` (#369): `Rows` pages as raw little-endian bytes,
//! every other [`GraphEvent`] as JSON. `src/slices/git/topos/graphPage.ts` decodes the bytes.
//!
//! Page layout, format version 2. Offsets are bytes from the start of the page; every `u16`, `u32`
//! and `f64` is little-endian, and every section starts on an 8-byte boundary.
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
//! | 24 | u32 | edge count: edges whose child row is in this page |
//! | 28 | u32 | close count: edges from earlier pages whose parent row is in this page |
//! | 32 | u32 | offset of `authorTimeMs`: one `f64` per row, epoch ms |
//! | 36 | u32 | offset of `authorIds`: one `u32` per row, an index into the session's author table |
//! | 40 | u32 | offset of the JSON section |
//! | 44 | u32 | length of the JSON section in bytes |
//! | 48 | u32 | first edge id: edges are numbered from 0 across the session, in child-row order |
//! | 52 | u32 | checkpoint count |
//! | 56 | u32 | peak lane count so far |
//! | 60 | u32 | offset of `rowLanes`: one `u16` per row |
//! | 64 | u32 | offset of `rowTracks`: one `u32` track id per row |
//! | 68 | u32 | offset of `edges`: six `u32` per edge, `childRow, parentRow, lane, childLane, parentLane, track` |
//! | 72 | u32 | offset of `closes`: three `u32` per close, `edge, parentRow, parentLane` |
//! | 76 | u32 | offset of `checkpoint`: one `u32` edge id per edge open at the page's first row |
//!
//! An edge is sent once, in the page holding its child row. When its parent row is in a later page
//! it is sent with `parentRow` [`OPEN_ROW`], and that later page carries its close (#351).
//!
//! The JSON section is UTF-8 [`PageJson`]: the rows' oids and subjects, the authors this page adds
//! to the session's author table, and the tracks it opens, which the frontend appends in order.

use std::collections::HashMap;

use serde::Serialize;

use super::super::error::GitError;
use super::lanes::{PageLayout, Track};
use super::log::LogRecord;

/// "TGPG" read as a little-endian `u32`: Topos graph page.
pub const PAGE_MAGIC: u32 = u32::from_le_bytes(*b"TGPG");
pub const PAGE_FORMAT_VERSION: u16 = 2;
pub const HEADER_BYTES: usize = 80;
/// The `parentRow` of an edge whose parent row hasn't been placed yet.
pub const OPEN_ROW: u32 = u32::MAX;

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
    /// A refresh found the old rows again (#370): the `newRows` rows sent next, from row 0,
    /// replace the first `replaceRows` rows, and the rows below move by `rowDelta`. Their edge ids
    /// from `edgesFrom` on become ids from `edgesTo` on, and their track ids from `tracksFrom` on
    /// become ids from `tracksTo` on. The edges and tracks crossing the splice keep the new ids:
    /// each `[old, new]` pair in `crossingEdges` gives the new edge its old edge's close, and
    /// `liveTracks` maps the tracks in use there. Later pages follow the renumbered rows.
    Splice {
        session_id: u32,
        replace_rows: u32,
        new_rows: u32,
        row_delta: i64,
        edges_from: u32,
        edges_to: u32,
        tracks_from: u32,
        tracks_to: u32,
        crossing_edges: Vec<[u32; 2]>,
        live_tracks: Vec<[u32; 2]>,
    },
    /// A refresh found no old row to splice at within its search: every row sent so far is gone,
    /// and the pages that follow, from row 0, reload them.
    Reset { session_id: u32 },
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
    /// Tracks this page opens, in id order.
    pub new_tracks: &'a [Track],
}

/// Interns authors across a session, so each one crosses the channel once.
#[derive(Default, Clone)]
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

fn put_u16(out: &mut [u8], at: usize, value: u16) {
    out[at..at + 2].copy_from_slice(&value.to_le_bytes());
}

/// Encodes `rows`, laid out as `layout`, as page `page_index` of session `session_id`, starting at
/// session row `first_row`.
pub fn encode_page(
    session_id: u32,
    page_index: u32,
    first_row: u32,
    rows: &[LogRecord],
    layout: &PageLayout,
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
        new_tracks: &layout.tracks,
    })
    .expect("page JSON serializes");
    debug_assert_eq!(layout.rows.len(), n, "every row is laid out");

    let author_time_at = HEADER_BYTES;
    let author_ids_at = author_time_at + 8 * n;
    let lanes_at = align8(author_ids_at + 4 * n);
    let tracks_at = align8(lanes_at + 2 * n);
    let edges_at = align8(tracks_at + 4 * n);
    let closes_at = align8(edges_at + 24 * layout.edges.len());
    let checkpoint_at = align8(closes_at + 12 * layout.closes.len());
    let json_at = align8(checkpoint_at + 4 * layout.checkpoint.len());
    let mut out = vec![0u8; json_at + json.len()];

    put_u32(&mut out, 0, PAGE_MAGIC);
    out[4..6].copy_from_slice(&PAGE_FORMAT_VERSION.to_le_bytes());
    out[6..8].copy_from_slice(&(HEADER_BYTES as u16).to_le_bytes());
    put_u32(&mut out, 8, session_id);
    put_u32(&mut out, 12, page_index);
    put_u32(&mut out, 16, first_row);
    put_u32(&mut out, 20, n as u32);
    put_u32(&mut out, 24, layout.edges.len() as u32);
    put_u32(&mut out, 28, layout.closes.len() as u32);
    put_u32(&mut out, 32, author_time_at as u32);
    put_u32(&mut out, 36, author_ids_at as u32);
    put_u32(&mut out, 40, json_at as u32);
    put_u32(&mut out, 44, json.len() as u32);
    put_u32(&mut out, 48, layout.first_edge);
    put_u32(&mut out, 52, layout.checkpoint.len() as u32);
    put_u32(&mut out, 56, layout.peak_lanes);
    put_u32(&mut out, 60, lanes_at as u32);
    put_u32(&mut out, 64, tracks_at as u32);
    put_u32(&mut out, 68, edges_at as u32);
    put_u32(&mut out, 72, closes_at as u32);
    put_u32(&mut out, 76, checkpoint_at as u32);

    for (i, r) in rows.iter().enumerate() {
        let a = author_time_at + 8 * i;
        out[a..a + 8].copy_from_slice(&((r.author_time as f64) * 1000.0).to_le_bytes());
        put_u32(&mut out, author_ids_at + 4 * i, author_ids[i]);
    }
    for (i, &(lane, track)) in layout.rows.iter().enumerate() {
        // No repo has 65,535 lanes open at once; a lane past that draws on the last one.
        put_u16(&mut out, lanes_at + 2 * i, lane.min(u16::MAX as u32) as u16);
        put_u32(&mut out, tracks_at + 4 * i, track);
    }
    for (i, e) in layout.edges.iter().enumerate() {
        for (f, value) in [e.child_row, e.parent_row, e.lane, e.child_lane, e.parent_lane, e.track].into_iter().enumerate() {
            put_u32(&mut out, edges_at + 24 * i + 4 * f, value);
        }
    }
    for (i, c) in layout.closes.iter().enumerate() {
        for (f, value) in [c.edge, c.parent_row, c.parent_lane].into_iter().enumerate() {
            put_u32(&mut out, closes_at + 12 * i + 4 * f, value);
        }
    }
    for (i, &edge) in layout.checkpoint.iter().enumerate() {
        put_u32(&mut out, checkpoint_at + 4 * i, edge);
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
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/slices/git/topos/fixtures/graph-page-v2.bin")
    }

    /// The layout behind the fixture: `feature` opens at row 1025 in lane 1 and runs on past the
    /// page; edge 39, open since an earlier page, closes at row 1025.
    fn fixture_layout() -> PageLayout {
        use super::super::lanes::{Close, Edge, TrackKind};
        PageLayout {
            first_edge: 40,
            checkpoint: vec![37, 39],
            rows: vec![(0, 0), (1, 5), (0, 0)],
            edges: vec![
                Edge { child_row: 1024, parent_row: 1026, lane: 0, child_lane: 0, parent_lane: 0, track: 0 },
                Edge { child_row: 1025, parent_row: OPEN_ROW, lane: 1, child_lane: 1, parent_lane: 1, track: 5 },
            ],
            closes: vec![Close { edge: 39, parent_row: 1025, parent_lane: 1 }],
            tracks: vec![Track { id: 5, key: "feature".into(), kind: TrackKind::Named, left: Some(0), right: None }],
            peak_lanes: 3,
        }
    }

    /// The fixture is page 2 of session 7, starting at row 1024, after a page that already
    /// introduced one author, so the decoder sees a non-zero first author id.
    fn fixture_bytes() -> Vec<u8> {
        let mut authors = AuthorTable::default();
        authors.intern(Author { name: "Earlier".into(), email: "earlier@example.invalid".into() }, &mut Vec::new());
        encode_page(7, 2, 1024, &fixture_rows(), &fixture_layout(), &mut authors)
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
        for section in [32, 36, 40, 60, 64, 68, 72, 76] {
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
        assert_eq!(json["newTracks"][0], serde_json::json!({ "id": 5, "key": "feature", "kind": "named", "left": 0, "right": null }));
        assert_eq!((u32_at(24), u32_at(28), u32_at(48), u32_at(52), u32_at(56)), (2, 1, 40, 2, 3));
        let edge = |i: usize, f: usize| u32_at(u32_at(68) as usize + 24 * i + 4 * f);
        assert_eq!((edge(1, 0), edge(1, 1), edge(1, 2)), (1025, OPEN_ROW, 1));
        let lane = |i: usize| u16::from_le_bytes(bytes[u32_at(60) as usize + 2 * i..][..2].try_into().unwrap());
        assert_eq!((lane(0), lane(1), lane(2)), (0, 1, 0));
    }
}
