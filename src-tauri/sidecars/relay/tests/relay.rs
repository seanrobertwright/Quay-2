//! Runs the relay as a CLI does, as a process on pipes, against a real loopback listener that
//! stands in for Quay's `/mcp`.

mod support;

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

/// A request the listener answers with `status`, `headers` and `body`, and the message of the
/// error the CLI gets for it.
fn error_for(status: &str, headers: &str, body: &str) -> String {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);
    relay.send(r#"{"jsonrpc":"2.0","id":"x1","method":"tools/list"}"#);
    quay.next().respond(status, headers, body);
    let reply = relay.next();
    assert_eq!(reply["jsonrpc"], "2.0", "{reply}");
    assert_eq!(reply["id"], "x1", "{reply}");
    assert_eq!(reply["error"]["code"], -32000, "{reply}");
    assert!(quay.stays_unused());
    let (stdout, stderr) = relay.finish();
    assert!(stdout.is_empty(), "{stdout:?}");
    assert!(!stderr.contains(TOKEN), "{stderr}");
    reply["error"]["message"].as_str().unwrap().to_string()
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
