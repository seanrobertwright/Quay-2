//! Durable SQLite event store, one immutable mission contract per database.
use crate::core::check;
use crate::*;
use rusqlite::{params, Connection};
use serde_json::json;
fn db<T>(r: rusqlite::Result<T>) -> Result<T> {
    r.map_err(|_| error("STORAGE_ERROR"))
}
pub struct SqliteStore {
    pub(crate) connection: Connection,
}
impl SqliteStore {
    pub fn open(path: &str, contract: Option<&Contract>) -> Result<Self> {
        let connection = db(Connection::open(path))?;
        let handoff: bool = db(connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='handoff_config')", [], |r| r.get(0)))?;
        check(!handoff, "UNSUPPORTED_PROTOCOL")?;
        db(connection.execute_batch("CREATE TABLE IF NOT EXISTS telemetry_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, signal TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, last_code TEXT NOT NULL DEFAULT 'QUEUED'); CREATE TABLE IF NOT EXISTS diagnostics (seq INTEGER PRIMARY KEY, record TEXT NOT NULL, previous TEXT NOT NULL, digest TEXT NOT NULL)"))?;
        db(connection.execute_batch("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS mission (id INTEGER PRIMARY KEY CHECK(id=1), contract TEXT NOT NULL); CREATE TABLE IF NOT EXISTS journal (seq INTEGER PRIMARY KEY, event TEXT NOT NULL, previous TEXT NOT NULL, digest TEXT NOT NULL)"))?;
        if let Some(c) = contract {
            create_mission(c)?;
            db(connection.execute(
                "INSERT OR IGNORE INTO mission VALUES (1, ?)",
                params![canonical(c.as_value())?],
            ))?;
        }
        let stored: String = connection
            .query_row("SELECT contract FROM mission WHERE id=1", [], |r| r.get(0))
            .map_err(|_| error("CONTRACT_REQUIRED"))?;
        if let Some(c) = contract {
            check(stored == canonical(c.as_value())?, "CONTRACT_CONFLICT")?;
        }
        Ok(Self { connection })
    }
    pub(crate) fn load(&self) -> Result<Snapshot> {
        let text: String =
            db(self
                .connection
                .query_row("SELECT contract FROM mission WHERE id=1", [], |r| r.get(0)))?;
        let contract = Contract::parse(&text)?;
        let mut s = create_mission(&contract)?;
        let mut previous = digest(contract.as_value())?;
        let mut stmt = db(self
            .connection
            .prepare("SELECT event,previous,digest FROM journal ORDER BY seq"))?;
        let rows = db(stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        }))?;
        for row in rows {
            let (text, prev, hash) = db(row)?;
            let event = parse_strict(&text)?;
            check(
                event["sequence"]
                    == (crate::core::q(&s.0["revision"]) + num_bigint::BigUint::from(1u8))
                        .to_string()
                    && prev == previous
                    && hash == digest(&json!({"previous":previous,"event":event}))?,
                "JOURNAL_INTEGRITY",
            )?;
            s = reduce(
                &s,
                &Command::from_value(event["command"].clone())?,
                crate::core::st(&event["at"]),
            )?;
            check(
                s.0["events"].as_array().unwrap().last() == Some(&event),
                "EVENT_MISMATCH",
            )?;
            previous = hash;
        }
        Ok(s)
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        db(self.connection.execute_batch("BEGIN"))?;
        match self.load() {
            Ok(s) => {
                db(self.connection.execute_batch("COMMIT"))?;
                Ok(s)
            }
            Err(e) => {
                let _ = self.connection.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }
    pub fn apply(
        &mut self,
        command: &Command,
        now: &str,
        expected: Option<&str>,
    ) -> Result<Snapshot> {
        self.apply_with_hook(command, now, expected, || Ok(()))
    }
    pub fn apply_with_hook<F: FnOnce() -> Result<()>>(
        &mut self,
        command: &Command,
        now: &str,
        expected: Option<&str>,
        before_commit: F,
    ) -> Result<Snapshot> {
        db(self.connection.execute_batch("BEGIN IMMEDIATE"))?;
        let result = (|| {
            let old = self.load()?;
            if let Some(rev) = expected {
                check(old.0["revision"] == rev, "REVISION_CONFLICT")?;
            }
            let next = reduce(&old, command, now)?;
            let event = next.0["events"].as_array().unwrap().last().unwrap();
            let previous = if old.0["revision"] == "0" {
                digest(&old.0["contract"])?
            } else {
                db(self.connection.query_row(
                    "SELECT digest FROM journal ORDER BY seq DESC LIMIT 1",
                    [],
                    |r| r.get::<_, String>(0),
                ))?
            };
            let seq = crate::core::st(&next.0["revision"])
                .parse::<i64>()
                .map_err(|_| error("STORAGE_LIMIT"))?;
            db(self.connection.execute(
                "INSERT INTO journal VALUES (?,?,?,?)",
                params![
                    seq,
                    canonical(event)?,
                    previous,
                    digest(&json!({"previous":previous,"event":event}))?
                ],
            ))?;
            before_commit()?;
            self.enqueue("traces", &crate::observability::trace_payload(event)?, now)?;
            db(self.connection.execute_batch("COMMIT"))?;
            Ok(next)
        })();
        if result.is_err() {
            let _ = self.connection.execute_batch("ROLLBACK");
        }
        result
    }
    pub fn export_audit(&self) -> Result<String> {
        let s = self.snapshot()?;
        let mut body = json!({"profile":"finite-v1","contract":s.0["contract"],"events":s.0["events"],"diagnostics":self.read_diagnostics(&s.0["contract"])?});
        body["digest"] = json!(digest(&body)?);
        canonical(&body)
    }
}
pub fn import_audit(text: &str) -> Result<Snapshot> {
    let mut b = parse_strict(text)?;
    check(
        b.is_object()
            && b.as_object().unwrap().len() == 5
            && b["profile"] == "finite-v1"
            && b["events"].is_array()
            && b["diagnostics"].is_array()
            && b["digest"].is_string()
            && b["contract"].is_object(),
        "INVALID_RECORD",
    )?;
    let hash = b.as_object_mut().unwrap().remove("digest").unwrap();
    check(hash == digest(&b)?, "JOURNAL_INTEGRITY")?;
    audit_playback(&Contract::from_value(b["contract"].clone())?, &b["events"])
}
