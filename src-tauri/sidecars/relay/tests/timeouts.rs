//! The relay's waits, by the real clock. These tests take as long as the waits do, so only
//! `cargo test --test timeouts -- --ignored` runs them.

mod support;

use std::time::{Duration, Instant};

use serde_json::json;
use support::{Listener, Relay, TOKEN};

#[test]
#[ignore = "takes as long as the wait it is about"]
fn an_answer_after_the_100_s_wait_still_comes_back() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);
    relay.send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call"}"#);
    let request = quay.next();

    // The wait is 100 s, after Quay has checked the call
    std::thread::sleep(Duration::from_secs(108));
    request.answer(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#);
    assert_eq!(relay.next()["result"], json!({}));
}

#[test]
#[ignore = "takes as long as the wait it is about"]
fn a_call_with_no_answer_is_closed_and_is_an_error_before_the_clis_150_s_limit() {
    let quay = Listener::start();
    let mut relay = Relay::start(&quay.url(), TOKEN);
    let started = Instant::now();
    relay.send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call"}"#);
    let mut request = quay.next();

    let reply = relay.next_within(Duration::from_secs(140));
    assert!(started.elapsed() > Duration::from_secs(108));
    assert_eq!(reply["id"], 1);
    assert_eq!(reply["error"]["message"], "Quay did not reply in 120 s.");
    assert!(request.closes_soon());
}

#[test]
#[ignore = "takes as long as the wait it is about"]
fn it_gives_up_on_a_cli_that_sends_requests_and_never_reads_the_replies() {
    let mut relay = Relay::unread(&[]);
    let mut stdin = relay.take_stdin();
    let flood = std::thread::spawn(move || {
        use std::io::Write;
        let version = "v".repeat(200_000);
        let line = format!(
            "{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{{\"protocolVersion\":\"{version}\"}}}}\n"
        );
        // Ends when the relay does
        while stdin.write_all(line.as_bytes()).is_ok() {}
    });

    let status = relay.exits_within(Duration::from_secs(60)).expect("the relay did not exit");
    assert!(!status.success(), "{status}");
    flood.join().unwrap();
}
