//! What the window is told of a terminal's handshake with Quay's MCP server, which the mark for
//! terminals that can't show surfaces goes by: the handshake itself is a real `POST /mcp`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::{json, Value};

use super::mcp_tests::TestBridge;
use crate::slices::connect::handshake::report_handshakes;
use crate::slices::pty::handshake::Handshake;
use crate::slices::pty::models::RunKind;
use crate::slices::pty::plugin_watch::LaunchRef;
use crate::slices::pty::PtyManager;
use crate::webview::WebviewEvents;

const GRACE: Duration = Duration::from_secs(60);

async fn shake_hands(bridge: &TestBridge, launch: &LaunchRef) {
    let message = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} });
    let reply = bridge.post_to(&format!("/mcp/{}", launch.launch), &message).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
}

/// What the window is told of `term-mcp` `later` from now.
fn told(terminals: &PtyManager, later: Duration) -> Option<Handshake> {
    terminals.handshake("term-mcp", Instant::now() + later)
}

fn not_seen(grace_left_ms: u64) -> Option<Handshake> {
    Some(Handshake { seen: false, grace_left_ms })
}

#[tokio::test]
async fn the_grace_runs_from_the_launch_and_a_relaunch_has_a_grace_of_its_own() {
    let bridge = TestBridge::start_with(RunKind::Claude, true).await;
    let terminals = &bridge.pty_manager;
    assert_eq!(told(terminals, GRACE), None, "it was never launched");

    let before = Instant::now();
    terminals.begin_launch("term-mcp", RunKind::Claude);

    let left = terminals.handshake("term-mcp", before).unwrap().grace_left_ms;
    assert!((60_000..61_000).contains(&left), "{left}");
    let late = told(terminals, GRACE - Duration::from_millis(1)).unwrap();
    assert!(!late.seen && late.grace_left_ms <= 1, "{late:?}");
    assert_eq!(told(terminals, GRACE), not_seen(0));
    assert_eq!(told(terminals, GRACE * 100), not_seen(0));

    tokio::time::sleep(Duration::from_millis(50)).await;
    terminals.begin_launch("term-mcp", RunKind::Claude);
    let anew = terminals.handshake("term-mcp", before + GRACE).unwrap().grace_left_ms;
    assert!(anew >= 50, "{anew}");
}

#[tokio::test]
async fn a_handshake_is_told_however_late_it_comes_and_for_that_launch_alone() {
    let bridge = TestBridge::start_with(RunKind::Claude, true).await;
    let terminals = &bridge.pty_manager;
    let old = terminals.begin_launch("term-mcp", RunKind::Claude);
    assert_eq!(told(terminals, GRACE), not_seen(0));

    shake_hands(&bridge, &old).await;
    assert!(told(terminals, GRACE).unwrap().seen);

    terminals.begin_launch("term-mcp", RunKind::Claude);
    assert_eq!(told(terminals, GRACE), not_seen(0));
    shake_hands(&bridge, &old).await;
    assert_eq!(told(terminals, GRACE), not_seen(0), "it is the old launch's");
}

#[tokio::test]
async fn a_terminal_that_has_exited_or_closed_has_nothing_to_tell() {
    let bridge = TestBridge::start_with(RunKind::Claude, true).await;
    let terminals = &bridge.pty_manager;
    let launch = terminals.begin_launch("term-mcp", RunKind::Claude);
    terminals.exit_launch(&launch, Some(0));
    assert_eq!(told(terminals, GRACE), None);

    terminals.begin_launch("term-mcp", RunKind::Claude);
    assert_eq!(told(terminals, GRACE), not_seen(0));
    terminals.kill("term-mcp").unwrap();
    assert_eq!(told(terminals, GRACE), None);
}

/// Every event the window has been sent.
fn listen(terminals: &PtyManager) -> Arc<Mutex<Vec<(String, Value)>>> {
    let sent = Arc::new(Mutex::new(Vec::new()));
    let log = sent.clone();
    report_handshakes(terminals, WebviewEvents::to(move |event, payload| log.lock().push((event.to_string(), payload))));
    sent
}

#[tokio::test]
async fn the_window_hears_of_a_launchs_first_handshake_and_no_other_request() {
    let bridge = TestBridge::start_with(RunKind::Claude, true).await;
    let terminals = &bridge.pty_manager;
    let launch = terminals.begin_launch("term-mcp", RunKind::Claude);
    let sent = listen(terminals);

    bridge.post(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" })).await;
    assert!(sent.lock().is_empty());
    shake_hands(&bridge, &launch).await;
    shake_hands(&bridge, &launch).await;

    assert_eq!(*sent.lock(), [("terminal-handshake".to_string(), json!({ "terminal_id": "term-mcp" }))]);
}

#[tokio::test]
async fn the_window_hears_of_a_relaunch_and_of_an_exit() {
    let bridge = TestBridge::start_with(RunKind::Claude, true).await;
    let terminals = &bridge.pty_manager;
    let info = terminals.get_info("term-mcp").unwrap();
    let sent = listen(terminals);

    let launch = terminals.begin_launch("term-mcp", RunKind::Claude);
    assert!(terminals.relist_launched(&launch, info, || ()).is_ok());
    assert_eq!(sent.lock().pop().unwrap().1, json!({ "terminal_id": "term-mcp" }));
    sent.lock().clear();

    terminals.exit_launch(&launch, Some(0));
    assert_eq!(sent.lock().pop().unwrap().1, json!({ "terminal_id": "term-mcp" }));
}
