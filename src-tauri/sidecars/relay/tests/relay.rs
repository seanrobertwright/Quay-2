//! Runs the relay as a CLI does, as a process on pipes, against a real loopback listener that
//! stands in for Quay's `/mcp`.

mod support;

use std::time::Duration;

use serde_json::json;
use support::{Listener, Relay, TOKEN};

#[test]
fn a_request_goes_to_mcp_with_the_token_and_its_reply_comes_back() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);

    let line = r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"quay_ask"}}"#;
    relay.send(line);
    let request = quay.next();
    assert!(request.head.starts_with("POST /mcp HTTP/1.1\r\n"), "{}", request.head);
    assert_eq!(request.header("authorization"), Some("Bearer tok-relay-secret"));
    assert_eq!(request.header("host"), Some(format!("127.0.0.1:{}", quay.port).as_str()));
    assert_eq!(request.header("content-type"), Some("application/json"));
    assert_eq!(request.header("origin"), None);
    assert_eq!(request.body, line);

    request.answer(r#"{"jsonrpc":"2.0","id":7,"result":{"content":[]}}"#);
    assert_eq!(relay.next(), json!({ "jsonrpc": "2.0", "id": 7, "result": { "content": [] } }));
}

#[test]
fn outside_quay_the_handshake_gets_an_empty_tool_list_and_nothing_is_said() {
    for vars in [
        &[][..],
        &[("QUAY_MCP_URL", "http://127.0.0.1:9/mcp")],
        &[("QUAY_A2A_TOKEN", TOKEN)],
        &[("QUAY_MCP_URL", ""), ("QUAY_A2A_TOKEN", TOKEN)],
        &[("QUAY_MCP_URL", "http://127.0.0.1:9/mcp"), ("QUAY_A2A_TOKEN", "")],
    ] {
        let mut relay = Relay::with_env(vars);

        relay.send(r#"{"jsonrpc":"2.0","id":"a","method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#);
        let reply = relay.next();
        assert_eq!(reply["id"], "a");
        assert_eq!(reply["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(reply["result"]["capabilities"], json!({ "tools": {} }));
        assert!(reply["result"]["serverInfo"]["name"].is_string(), "{reply}");
        assert!(reply["result"]["serverInfo"]["version"].is_string(), "{reply}");

        relay.send(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        relay.send(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        assert_eq!(relay.next(), json!({ "jsonrpc": "2.0", "id": 2, "result": { "tools": [] } }));
        relay.send(r#"{"jsonrpc":"2.0","id":3,"method":"ping"}"#);
        assert_eq!(relay.next(), json!({ "jsonrpc": "2.0", "id": 3, "result": {} }));
        relay.send(r#"{"jsonrpc":"2.0","id":4,"method":"server/discover"}"#);
        assert_eq!(relay.next()["error"]["code"], -32601);
        relay.send(r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"quay_ask"}}"#);
        assert_eq!(relay.next()["error"]["code"], -32602);

        let (stdout, stderr) = relay.finish();
        assert!(stdout.is_empty(), "{stdout:?}");
        assert_eq!(stderr, "");
    }
}

#[test]
fn a_url_that_is_not_loopback_is_refused_and_nothing_is_sent() {
    let quay = Listener::start();
    let port = quay.port;
    for url in [
        format!("http://example.com:{port}/mcp"),
        format!("http://127.0.0.1.example.com:{port}/mcp"),
        format!("http://127.0.0.1:{port}@example.com:{port}/mcp"),
        format!("http://0.0.0.0:{port}/mcp"),
        format!("http://10.0.0.1:{port}/mcp"),
        format!("https://127.0.0.1:{port}/mcp"),
        format!("http://127.0.0.1:{port}/m cp"),
        format!("http://127.0.0.1:{port}/mcp?token={TOKEN}"),
        "not a url".to_string(),
    ] {
        let mut relay = Relay::start(&url, TOKEN);

        relay.send(r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#);
        let reply = relay.next();
        assert_eq!(reply["id"], 1, "{url}: {reply}");
        assert_eq!(
            reply["error"]["message"],
            "QUAY_MCP_URL is not a loopback http:// URL with a port and a path, so the relay refuses it.",
            "{url}"
        );

        let (stdout, stderr) = relay.finish();
        assert!(stdout.is_empty(), "{url}: {stdout:?}");
        assert!(!stderr.contains(TOKEN) && !stderr.contains("example.com"), "{url}: {stderr}");
    }
    assert!(quay.stays_unused());
}

#[test]
fn a_token_that_could_split_the_request_is_refused_and_not_repeated() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), "tok-relay-secret\r\nX-Evil: 1");

    relay.send(r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#);
    let reply = relay.next();
    assert_eq!(reply["error"]["message"], "QUAY_A2A_TOKEN can't be sent in a header, so the relay refuses it.");

    let (_, stderr) = relay.finish();
    assert!(!stderr.contains(TOKEN), "{stderr}");
    assert!(quay.stays_unused());
}

/// A request for `method` that the listener answers with `status`, `headers` and `body`, and the
/// error the CLI gets for it.
fn error_of(method: &str, status: &str, headers: &str, body: &str) -> serde_json::Value {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);
    let line = format!(r#"{{"jsonrpc":"2.0","id":"x1","method":"{method}"}}"#);
    relay.send(&line);
    let request = quay.next();
    assert_eq!(request.body, line);
    request.respond(status, headers, body);
    let reply = relay.next();
    assert_eq!(reply["jsonrpc"], "2.0");
    assert_eq!(reply["id"], "x1");
    assert!(quay.stays_unused());
    let (stdout, stderr) = relay.finish();
    assert!(stdout.is_empty(), "{stdout:?}");
    assert!(!stderr.contains(TOKEN), "{stderr}");
    reply["error"].clone()
}

/// The message of the relay's own error for a `tools/list` answered so.
fn error_for(status: &str, headers: &str, body: &str) -> String {
    let error = error_of("tools/list", status, headers, body);
    assert_eq!(error["code"], -32000);
    error["message"].as_str().unwrap().to_string()
}

#[test]
fn a_probe_quay_has_no_reply_for_tells_the_cli_to_fall_back_to_the_handshake() {
    let http_400 = "Quay's MCP server answered HTTP 400.";
    let no_reply = "Quay's MCP server sent no reply to this request.";
    for (status, body, message) in
        [("400 Bad Request", "", http_400), ("400 Bad Request", "no", http_400), ("200 OK", "", no_reply), ("200 OK", "<html>", no_reply)]
    {
        assert_eq!(
            error_of("server/discover", status, "", body),
            json!({ "code": -32601, "message": message }),
            "{status} {body}"
        );
    }
    // Quay's own answer to it passes through, and the same 400 to another request is a failure
    let own = r#"{"jsonrpc":"2.0","id":"x1","error":{"code":-32004,"message":"m"}}"#;
    assert_eq!(error_of("server/discover", "200 OK", "", own)["code"], -32004);
    assert_eq!(error_for("400 Bad Request", "", ""), http_400);
}

#[test]
fn a_redirect_is_not_followed() {
    let elsewhere = Listener::start();
    let location = format!("Location: {}\r\n", elsewhere.url());

    for status in ["302 Found", "307 Temporary Redirect", "308 Permanent Redirect"] {
        let code = &status[..3];
        assert_eq!(error_for(status, &location, ""), format!("Quay's MCP server answered HTTP {code}."));
    }
    assert!(elsewhere.stays_unused());
}

#[test]
fn an_http_failure_is_an_error_that_repeats_none_of_its_body() {
    assert_eq!(
        error_for("401 Unauthorized", "Content-Type: text/plain\r\n", "Invalid Bearer token tok-relay-secret"),
        "Quay's MCP server answered HTTP 401."
    );
}

#[test]
fn an_answer_that_is_not_this_requests_reply_never_reaches_stdout() {
    for body in [
        "<html>",
        "",
        "[]",
        r#"{"jsonrpc":"2.0","id":"x1","method":"tools/list"}"#,
        r#"{"jsonrpc":"2.0","id":"x2","result":{}}"#,
        r#"{"jsonrpc":"1.0","id":"x1","result":{}}"#,
        "{\"jsonrpc\":\"2.0\",\"id\":\"x1\",\"result\":{}}\n{\"jsonrpc\":\"2.0\",\"method\":\"extra\"}",
    ] {
        assert_eq!(error_for("200 OK", "", body), "Quay's MCP server sent no reply to this request.", "{body}");
    }
}

#[test]
fn a_reply_spread_over_lines_goes_out_as_one() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);
    relay.send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
    quay.next().answer("{\r\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"error\": { \"code\": 1, \"message\": \"a\\nb\" }\n}\n");
    assert_eq!(relay.next(), json!({ "jsonrpc": "2.0", "id": 1, "error": { "code": 1, "message": "a\nb" } }));
}

#[test]
fn a_quay_that_is_not_there_is_an_error() {
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let mut relay = Relay::start(&format!("http://127.0.0.1:{port}/mcp"), TOKEN);
    relay.send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
    assert_eq!(relay.next()["error"]["message"], "The relay can't reach Quay.");
}

#[test]
fn a_connection_that_drops_before_its_reply_is_an_error() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);
    relay.send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
    drop(quay.next());
    assert_eq!(relay.next()["error"]["message"], "Quay closed the connection before it replied.");
}

#[test]
fn a_notification_is_forwarded_and_whatever_comes_back_is_dropped() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);
    let line = r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;

    relay.send(line);
    let request = quay.next();
    assert_eq!(request.body, line);
    request.respond("202 Accepted", "", "");
    relay.send(line);
    quay.next().answer(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#);
    relay.send(line);
    quay.next().respond("401 Unauthorized", "", "no");

    assert!(relay.stays_silent());
}

#[test]
fn a_cancel_closes_the_named_requests_call_and_no_other() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);
    let mut call = |id: &str| {
        relay.send(&format!(r#"{{"jsonrpc":"2.0","id":{id},"method":"tools/call","params":{{"name":"quay_ask"}}}}"#));
        quay.next()
    };
    let mut number = call("1");
    let mut text = call(r#""1""#);
    let mut other = call("2");

    relay.send(
        r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1,"reason":"context canceled"}}"#,
    );
    assert!(number.closes_soon());
    assert!(text.stays_open() && other.stays_open());

    // The closed connection is all Quay sees of it: another relay in this terminal may have a
    // call with the same id
    assert!(quay.stays_unused());

    // The cancelled call gets no reply, and the others still get theirs
    other.answer(r#"{"jsonrpc":"2.0","id":2,"result":{}}"#);
    assert_eq!(relay.next()["id"], 2);
    text.answer(r#"{"jsonrpc":"2.0","id":"1","result":{}}"#);
    assert_eq!(relay.next()["id"], "1");
    assert!(relay.stays_silent());
}

#[test]
fn a_cancel_for_a_finished_call_or_an_unknown_one_closes_nothing() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);
    relay.send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
    quay.next().answer(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#);
    assert_eq!(relay.next()["id"], 1);
    relay.send(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
    let mut open = quay.next();

    for params in [r#"{"requestId":1}"#, r#"{"requestId":99}"#, "{}", "[]", r#"{"requestId":null}"#] {
        relay.send(&format!(r#"{{"jsonrpc":"2.0","method":"notifications/cancelled","params":{params}}}"#));
    }

    assert!(open.stays_open() && quay.stays_unused());
    open.answer(r#"{"jsonrpc":"2.0","id":2,"result":{}}"#);
    assert_eq!(relay.next()["id"], 2);
}

#[test]
fn it_exits_when_its_stdin_closes_and_closes_every_open_call() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);
    relay.send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call"}"#);
    let mut call = quay.next();

    relay.close_stdin();
    let status = relay.exits_soon().expect("the relay did not exit");
    assert!(status.success(), "{status}");
    assert!(call.closes_soon());
}

#[test]
fn what_it_has_answered_is_written_before_it_exits() {
    let mut relay = Relay::unread(&[]);
    // Each reply is more than a pipe holds, so most still wait when stdin closes
    for id in 1..=12 {
        relay.send(&initialize_of(id, 100_000));
    }
    relay.close_stdin();
    std::thread::sleep(Duration::from_millis(200));
    relay.read_stdout();

    let ids: Vec<u64> = relay.finish().0.iter().map(|line| id_of(line)).collect();
    assert_eq!(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
}

fn id_of(line: &str) -> u64 {
    let reply: serde_json::Value = serde_json::from_str(line).expect("a whole reply");
    reply["id"].as_u64().unwrap()
}

#[test]
fn it_exits_when_its_stdin_closes_though_nobody_reads_its_stdout() {
    let mut relay = Relay::unread(&[]);
    // Each reply is more than a pipe holds
    for id in [1, 2] {
        relay.send(&initialize_of(id, 1_000_000));
    }
    relay.close_stdin();
    assert!(relay.exits_soon().is_some(), "the relay did not exit");
}

#[test]
fn it_exits_when_its_stdout_closes() {
    let mut relay = Relay::unread(&[]);
    relay.close_stdout();
    relay.send(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#);
    assert!(relay.exits_soon().is_some(), "the relay did not exit");
}

/// A handshake whose reply holds `size` bytes of it.
fn initialize_of(id: u32, size: usize) -> String {
    let version = "v".repeat(size);
    format!(r#"{{"jsonrpc":"2.0","id":{id},"method":"initialize","params":{{"protocolVersion":"{version}"}}}}"#)
}

#[test]
fn a_line_that_is_not_a_request_gets_an_error_and_the_next_one_still_goes_through() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);

    relay.send("");
    for (line, code) in [
        ("not json", -32700),
        (r#"{"jsonrpc":"2.0","id":1"#, -32700),
        (r#"[{"jsonrpc":"2.0","id":1,"method":"ping"}]"#, -32600),
        (r#"{"jsonrpc":"2.0","id":1}"#, -32600),
        (r#"{"jsonrpc":"2.0","id":{},"method":"ping"}"#, -32600),
    ] {
        relay.send(line);
        let reply = relay.next();
        assert_eq!(reply["id"], serde_json::Value::Null, "{line}: {reply}");
        assert_eq!(reply["error"]["code"], code, "{line}: {reply}");
    }
    assert!(quay.stays_unused());

    relay.send("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\r");
    let request = quay.next();
    assert_eq!(request.body, r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#);
    request.answer(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#);
    assert_eq!(relay.next()["id"], 1);
}

/// Two megabytes, the most `/mcp` takes in one request.
const TWO_MB: usize = 2_097_152;

/// A request of `size` bytes, whose `id` comes before its padding or after it.
fn request_of(size: usize, id_first: bool) -> String {
    let (before, after) = if id_first {
        (r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"a":""#, r#""}}"#)
    } else {
        (r#"{"method":"tools/call","params":{"id":6,"a":""#, r#""},"jsonrpc":"2.0","id":5}"#)
    };
    format!("{before}{}{after}", "x".repeat(size - before.len() - after.len()))
}

#[test]
fn a_request_over_2_mb_is_refused_by_its_id_and_the_next_one_still_goes_through() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);

    for (size, id_first) in [(TWO_MB + 1, true), (TWO_MB + 1, false), (8 * TWO_MB, true), (4 * TWO_MB, false)] {
        relay.send(&request_of(size, id_first));
        let reply = relay.next();
        assert_eq!(reply["id"], 5, "{reply}");
        assert_eq!(reply["error"]["message"], "The request is over 2 MB, so the relay refuses it.");
    }
    // One with no id gets no reply, and one that is not JSON gets one with no id
    relay.send(&request_of(TWO_MB + 100, true).replace(r#""id":5,"#, ""));
    relay.send(&"x".repeat(3 * TWO_MB));
    assert_eq!(relay.next()["id"], serde_json::Value::Null);
    assert!(quay.stays_unused());

    for line in [request_of(TWO_MB, true), request_of(TWO_MB, false) + "\r"] {
        relay.send(&line);
        let request = quay.next();
        assert_eq!(request.body.len(), TWO_MB);
        request.answer(r#"{"jsonrpc":"2.0","id":5,"result":{}}"#);
        assert_eq!(relay.next()["result"], json!({}));
    }
}

#[test]
fn a_reply_over_4_mb_is_an_error() {
    let body = format!(r#"{{"jsonrpc":"2.0","id":"x1","result":"{}"}}"#, "x".repeat(4 * 1024 * 1024));
    assert_eq!(error_for("200 OK", "", &body), "Quay's reply is over 4 MB, so the relay dropped it.");
}

#[test]
fn requests_run_side_by_side_up_to_a_limit() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);
    let call = |relay: &mut Relay, id: usize| {
        relay.send(&format!(r#"{{"jsonrpc":"2.0","id":{id},"method":"tools/call"}}"#));
    };
    let mut open = Vec::new();
    for id in 0..16 {
        call(&mut relay, id);
        open.push(quay.next());
    }

    call(&mut relay, 16);
    let reply = relay.next();
    assert_eq!(reply["id"], 16);
    assert_eq!(reply["error"]["message"], "Too many requests are open. Try again when one has finished.");

    // A cancel still closes its call, and makes room
    relay.send(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":3}}"#);
    assert!(open[3].closes_soon());
    open.remove(3);

    // They finish in any order
    open.pop().unwrap().answer(r#"{"jsonrpc":"2.0","id":15,"result":{}}"#);
    assert_eq!(relay.next()["id"], 15);
    open.remove(0).answer(r#"{"jsonrpc":"2.0","id":0,"result":{}}"#);
    assert_eq!(relay.next()["id"], 0);
    call(&mut relay, 17);
    quay.next().answer(r#"{"jsonrpc":"2.0","id":17,"result":{}}"#);
    assert_eq!(relay.next()["id"], 17);
}
