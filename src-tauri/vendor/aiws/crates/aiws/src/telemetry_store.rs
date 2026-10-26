//! Implementation kept separate to make the effect journal easy to inspect.
use crate::core::{check, st};
use crate::observability::*;
use crate::sqlite::SqliteStore;
use crate::*;
use rusqlite::params;
use serde_json::{json, Value};
fn db<T>(r: rusqlite::Result<T>) -> Result<T> {
    r.map_err(|_| error("STORAGE_ERROR"))
}
impl SqliteStore {
    pub(crate) fn enqueue(&self, signal: &str, payload: &Value, at: &str) -> Result<()> {
        db(self.connection.execute(
            "INSERT INTO telemetry_outbox (signal,payload,available_at) VALUES (?,?,?)",
            params![signal, payload.to_string(), at],
        ))?;
        Ok(())
    }
    pub fn export_state(&self) -> Result<Value> {
        let mut stmt = db(self
            .connection
            .prepare("SELECT status,count(*) FROM telemetry_outbox GROUP BY status"))?;
        let mut result = json!({"pending":"0","failed":"0"});
        let rows = db(stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))))?;
        for row in rows {
            let (status, count) = db(row)?;
            if status == "PENDING" {
                result["pending"] = json!(count.to_string());
            }
            if status == "FAILED" {
                result["failed"] = json!(count.to_string());
            }
        }
        Ok(result)
    }
    pub fn enqueue_metrics(&self, now: &str) -> Result<()> {
        let s = self.snapshot()?;
        self.enqueue(
            "metrics",
            &metric_payload(
                &operational_summary(&s, now, None, Some(&self.export_state()?))?,
                now,
            )?,
            now,
        )
    }
    pub fn flush_telemetry(
        &mut self,
        exporter: &mut impl TelemetryExporter,
        now_ms: &str,
        limit: usize,
    ) -> Result<Value> {
        check(
            !now_ms.is_empty()
                && now_ms.len() <= 18
                && now_ms.bytes().all(|b| b.is_ascii_digit())
                && (now_ms == "0" || !now_ms.starts_with('0'))
                && (1..=1000).contains(&limit),
            "EXPORT_CONFIG",
        )?;
        let now = now_ms.parse::<i64>().map_err(|_| error("EXPORT_CONFIG"))?;
        db(self.connection.execute_batch("BEGIN IMMEDIATE"))?;
        let claimed = (|| -> Result<Vec<(i64, String, String, i64)>> {
            let mut stmt=db(self.connection.prepare("SELECT id,signal,payload,attempts FROM telemetry_outbox WHERE status='PENDING' AND CAST(available_at AS INTEGER)<=? ORDER BY id LIMIT ?"))?;
            let rows = db(stmt.query_map(params![now, limit as i64], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, i64>(3)? + 1))
            }))?;
            let rows = rows.map(db).collect::<Result<Vec<_>>>()?;
            drop(stmt);
            for (id, _, _, attempts) in &rows {
                db(self.connection.execute(
                    "UPDATE telemetry_outbox SET attempts=?,available_at=? WHERE id=?",
                    params![attempts, (now + 30000).to_string(), id],
                ))?;
            }
            db(self.connection.execute_batch("COMMIT"))?;
            Ok(rows)
        })();
        let rows = match claimed {
            Ok(r) => r,
            Err(e) => {
                let _ = self.connection.execute_batch("ROLLBACK");
                return Err(e);
            }
        };
        let mut results = vec![];
        for (id, signal, payload, attempts) in rows {
            let result = exporter.send(
                &signal,
                &serde_json::from_str(&payload).map_err(|_| error("JOURNAL_INTEGRITY"))?,
            );
            let status = if result["status"] == "RETRY" {
                if attempts >= 8 {
                    "FAILED"
                } else {
                    "PENDING"
                }
            } else {
                st(&result["status"])
            };
            let requested = st(&result["retryAfterMs"])
                .parse::<u64>()
                .unwrap_or(86400000);
            let delay = std::cmp::min(
                86400000,
                std::cmp::max(
                    requested,
                    std::cmp::min(
                        60000,
                        1000u64.saturating_mul(2u64.saturating_pow((attempts - 1) as u32)),
                    ),
                ),
            );
            db(self.connection.execute("UPDATE telemetry_outbox SET status=?,available_at=?,last_code=? WHERE id=? AND attempts=?",params![status,(now+delay as i64).to_string(),st(&result["code"]),id,attempts]))?;
            results.push(json!({"id":id.to_string(),"status":status,"code":result["code"]}));
        }
        Ok(json!(results))
    }
    pub fn purge_sent_telemetry(&self) -> Result<()> {
        db(self
            .connection
            .execute("DELETE FROM telemetry_outbox WHERE status='SENT'", []))?;
        Ok(())
    }
    pub(crate) fn read_diagnostics(&self, contract: &Value) -> Result<Value> {
        let mut previous = digest(&json!(["diagnostics", contract]))?;
        let mut records = vec![];
        let mut stmt = db(self
            .connection
            .prepare("SELECT record,previous,digest FROM diagnostics ORDER BY seq"))?;
        let rows = db(stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        }))?;
        for row in rows {
            let (text, prev, hash) = db(row)?;
            let record = parse_strict(&text)?;
            check(
                prev == previous
                    && hash == digest(&json!({"previous":previous,"record":record}))?
                    && record["sequence"] == (records.len() + 1).to_string(),
                "JOURNAL_INTEGRITY",
            )?;
            records.push(record);
            previous = hash;
        }
        Ok(json!(records))
    }
    pub fn diagnostics(&self) -> Result<Value> {
        self.read_diagnostics(&self.snapshot()?.as_value()["contract"])
    }
    pub fn record_rejection(
        &mut self,
        command: &Value,
        code: &str,
        now: &str,
        context: Option<&Value>,
    ) -> Result<()> {
        db(self.connection.execute_batch("BEGIN IMMEDIATE"))?;
        let result = (|| {
            let mut s = self.load()?.as_value().clone();
            let sequence = (self
                .read_diagnostics(&s["contract"])?
                .as_array()
                .unwrap()
                .len()
                + 1)
            .to_string();
            let tag = st(&command["type"]);
            let tag = if !tag.is_empty()
                && tag.len() <= 40
                && tag.bytes().all(|b| b.is_ascii_alphabetic())
            {
                tag
            } else {
                "INVALID"
            };
            let code = if !code.is_empty()
                && code.len() <= 64
                && code
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
            {
                code
            } else {
                "COMMAND_ERROR"
            };
            let mut safe = json!({"type":"commandRejected","code":code,"rejectedType":tag});
            if let Some(ctx) = context {
                safe["context"] = ctx.clone();
            }
            for key in [
                "runId",
                "operationId",
                "attemptId",
                "nodeId",
                "triggerId",
                "waitId",
            ] {
                if command[key].is_string() {
                    safe[key] = command[key].clone();
                }
            }
            s["revision"] = json!(format!("rejection:{sequence}"));
            let record = json!({"sequence":sequence,"at":now,"command":safe,"observation":event_envelope(&s,&safe,now)?});
            let previous = if sequence == "1" {
                digest(&json!(["diagnostics", s["contract"]]))?
            } else {
                db(self.connection.query_row(
                    "SELECT digest FROM diagnostics ORDER BY seq DESC LIMIT 1",
                    [],
                    |r| r.get::<_, String>(0),
                ))?
            };
            db(self.connection.execute(
                "INSERT INTO diagnostics VALUES (?,?,?,?)",
                params![
                    sequence.parse::<i64>().unwrap(),
                    canonical(&record)?,
                    previous,
                    digest(&json!({"previous":previous,"record":record}))?
                ],
            ))?;
            self.enqueue("traces", &trace_payload(&record)?, now)?;
            db(self.connection.execute_batch("COMMIT"))?;
            Ok(())
        })();
        if result.is_err() {
            let _ = self.connection.execute_batch("ROLLBACK");
        }
        result
    }
}
