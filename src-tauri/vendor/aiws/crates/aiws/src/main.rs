//! The same tool as the TypeScript aiws and Python aiws-python CLIs: same commands, output, error codes and exit statuses.
use aiws_sdk::*;
use serde_json::{json, Value};
use std::path::Path;
/// A database command never creates the file it is asked to read.
fn snapshot(path: &Path) -> Result<Snapshot> {
    if !std::fs::metadata(path).is_ok_and(|m| m.is_file()) {
        return Err(error("FILE_ERROR"));
    }
    let path = path.to_str().ok_or_else(|| error("FILE_ERROR"))?;
    sqlite::SqliteStore::open(path, None)?.snapshot()
}
/// Replays each shared fixture; a refused contract or command is reported beside the others, not returned.
fn fixtures(text: &str) -> Result<Value> {
    let fs = parse_strict(text)?;
    // reduce checks a step's time, so a malformed one is reported as INVALID_TIME beside the other steps.
    let step = |s: &Value| s.get("command").is_some() && s["now"].is_string();
    let list = fs
        .as_array()
        .filter(|list| {
            list.iter().all(|f| {
                f["name"].is_string()
                    && f["contract"].is_object()
                    && f["steps"].as_array().is_some_and(|s| s.iter().all(step))
            })
        })
        .ok_or_else(|| error("INVALID_RECORD"))?;
    let mut out = vec![];
    for f in list {
        let mut s =
            match Contract::from_value(f["contract"].clone()).and_then(|c| create_mission(&c)) {
                Ok(s) => s,
                Err(e) => {
                    out.push(json!({"name":f["name"],"error":e.code,"results":[]}));
                    continue;
                }
            };
        let mut results = vec![];
        for step in f["steps"].as_array().unwrap() {
            let result = Command::from_value(step["command"].clone())
                .and_then(|c| reduce(&s, &c, step["now"].as_str().unwrap()));
            match result {
                Ok(next) => {
                    s = next;
                    results.push(json!({"digest":digest(s.as_value())?}));
                }
                Err(e) => results.push(json!({"error":e.code,"digest":digest(s.as_value())?})),
            }
        }
        out.push(json!({"name":f["name"],"results":results}));
    }
    Ok(json!(out))
}
fn read(path: &Path) -> Result<String> {
    std::fs::read_to_string(path).map_err(|_| error("FILE_ERROR"))
}
fn observe(path: &Path) -> Result<Value> {
    let state = snapshot(path)?;
    let summary = observability::operational_summary(&state, "4000000", None, None)?;
    let traces: Vec<Value> = state.as_value()["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(observability::trace_payload)
        .collect::<Result<_>>()?;
    Ok(
        json!({"summary":summary,"traces":traces,"metrics":observability::metric_payload(&summary,"4000000")?}),
    )
}
type Run = fn(&Path) -> Result<Value>;
/// Every command, in usage order: an entry here is in the usage text and is dispatched.
const COMMANDS: [(&str, Run); 6] = [
    ("validate", |path| {
        create_mission(&Contract::parse(&read(path)?)?)?;
        Ok(json!({"valid":true}))
    }),
    ("graph", |path| {
        workflow::validate_graph(&parse_strict(&read(path)?)?)?;
        Ok(json!({"valid":true}))
    }),
    ("replay", |path| {
        Ok(sqlite::import_audit(&read(path)?)?.as_value().clone())
    }),
    ("fixtures", |path| fixtures(&read(path)?)),
    ("snapshot", |path| Ok(snapshot(path)?.as_value().clone())),
    ("observe", observe),
];
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let usage = format!(
        "USAGE: aiws-sdk {} FILE",
        COMMANDS.map(|(name, _)| name).join("|")
    );
    let command = args.first().and_then(|a| a.to_str()).unwrap_or("");
    if args.len() == 1 && (command == "-h" || command == "--help") {
        println!("{usage}");
        return;
    }
    let run = match COMMANDS.iter().find(|(name, _)| *name == command) {
        Some((_, run)) if args.len() == 2 => run,
        _ => {
            eprintln!("{usage}");
            std::process::exit(2);
        }
    };
    match run(Path::new(&args[1])).and_then(|v| canonical(&v)) {
        Ok(text) => println!("{text}"),
        Err(e) => {
            eprintln!("{}", json!({"error":e.code}));
            std::process::exit(1);
        }
    }
}
