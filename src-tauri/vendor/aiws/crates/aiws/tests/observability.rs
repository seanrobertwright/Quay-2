use aiws_sdk::observability::*;
use aiws_sdk::sqlite::{import_audit, SqliteStore};
use aiws_sdk::*;
use serde_json::{json, Value};
use std::io::{Read, Write};
fn fixture() -> Value {
    serde_json::from_str::<Value>(include_str!("fixtures.json")).unwrap()[0].clone()
}
#[test]
fn attribution_redaction_alerts_and_tamper() {
    let f = fixture();
    let contract = Contract::from_value(f["contract"].clone()).unwrap();
    let mut store = SqliteStore::open(":memory:", Some(&contract)).unwrap();
    let mut command = f["steps"][0]["command"].clone();
    command["context"] =
        json!({"actor":"secret:actor","policyRevision":"policy:1","decisionClass":"HUMAN"});
    let s = store
        .apply(&Command::from_value(command.clone()).unwrap(), "10", None)
        .unwrap();
    assert!(!trace_payload(&s.as_value()["events"][0])
        .unwrap()
        .to_string()
        .contains("secret:actor"));
    assert_eq!(
        operational_summary(&s, "4000000", None, None).unwrap()["alerts"][0]["code"],
        "WORKFLOW_STALLED"
    );
    assert_eq!(
        operational_summary(&s, "9", None, None).unwrap_err().code,
        "CLOCK_REGRESSION"
    );
    store
        .record_rejection(&command, "AUTHORITY_DENIED", "11", command.get("context"))
        .unwrap();
    assert_eq!(
        store.diagnostics().unwrap()[0]["command"]["code"],
        "AUTHORITY_DENIED"
    );
    assert_eq!(store.snapshot().unwrap().as_value()["revision"], "1");
    let mut bundle: Value = serde_json::from_str(&store.export_audit().unwrap()).unwrap();
    bundle["events"][0]["observation"]["actor"] = json!("forged");
    bundle.as_object_mut().unwrap().remove("digest");
    bundle["digest"] = json!(digest(&bundle).unwrap());
    assert_eq!(
        import_audit(&bundle.to_string()).unwrap_err().code,
        "EVENT_MISMATCH"
    );
    assert_eq!(
        metric_payload(
            &json!({"metrics":{"spent_units":"9223372036854775808"},"durations":{}}),
            "10"
        )
        .unwrap_err()
        .code,
        "METRIC_RANGE"
    );
}
#[test]
fn http_retry_reopen_and_partial_success() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let mut paths = vec![];
        for (status, body) in [
            (503, "{}"),
            (200, "{}"),
            (200, "{\"partialSuccess\":{\"rejectedDataPoints\":\"1\"}}"),
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut bytes = vec![];
            let mut block = [0; 4096];
            loop {
                let n = stream.read(&mut block).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&block[..n]);
                if let Some(end) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]);
                    let length: usize = header
                        .lines()
                        .find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse().unwrap())
                        })
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        paths.push(header.lines().next().unwrap().to_owned());
                        serde_json::from_slice::<Value>(&bytes[end + 4..end + 4 + length]).unwrap();
                        break;
                    }
                }
            }
            write!(stream,"HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
        paths
    });
    let f = fixture();
    let contract = Contract::from_value(f["contract"].clone()).unwrap();
    let path = std::env::temp_dir().join(format!("aiws-obs-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let p = path.to_str().unwrap();
    let mut store = SqliteStore::open(p, Some(&contract)).unwrap();
    let command = Command::from_value(f["steps"][0]["command"].clone()).unwrap();
    assert!(store
        .apply_with_hook(&command, "10", None, || Err(error("CRASH")))
        .is_err());
    assert_eq!(store.export_state().unwrap()["pending"], "0");
    store.apply(&command, "10", None).unwrap();
    let mut exporter =
        OtlpHttpExporter::new(&format!("http://{address}"), Default::default(), 5000).unwrap();
    assert_eq!(
        store.flush_telemetry(&mut exporter, "10", 100).unwrap()[0]["status"],
        "PENDING"
    );
    assert_eq!(
        store.flush_telemetry(&mut exporter, "11", 100).unwrap(),
        json!([])
    );
    drop(store);
    let mut store = SqliteStore::open(p, None).unwrap();
    assert_eq!(
        store.flush_telemetry(&mut exporter, "1010", 100).unwrap()[0]["status"],
        "SENT"
    );
    store.enqueue_metrics("1010").unwrap();
    assert_eq!(
        store.flush_telemetry(&mut exporter, "1010", 100).unwrap()[0]["status"],
        "FAILED"
    );
    assert_eq!(
        store.flush_telemetry(&mut exporter, "100000", 100).unwrap(),
        json!([])
    );
    assert_eq!(
        store.export_state().unwrap(),
        json!({"pending":"0","failed":"1"})
    );
    assert_eq!(store.snapshot().unwrap().as_value()["revision"], "1");
    drop(store);
    assert_eq!(
        server.join().unwrap(),
        vec![
            "POST /v1/traces HTTP/1.1",
            "POST /v1/traces HTTP/1.1",
            "POST /v1/metrics HTTP/1.1"
        ]
    );
    std::fs::remove_file(path).unwrap();
}
