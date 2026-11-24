//! `quay_board` at the `/mcp` seam: what the agent is told and what the window is sent.

use std::time::Duration;

use serde_json::{json, Value};

use super::board::{ID_LIMIT, MOST_STATS, MOST_STEPS, NOTE_LIMIT, STAT_LIMIT, STEP_LABEL_LIMIT, TITLE_LIMIT};
use super::names::SURFACE_TOOLS;
use super::place::Place;
use super::store::SurfaceRecord;
use super::test_seam::{accepted, answer_to, key, question, start, FakeCli, FakeWebview, OpenCall, Seam};
use super::timing::Timing;
use crate::dates::now_ms;
use crate::slices::pty::models::{ClaudeStatus, RunKind};

/// Has `cli` show a board, which the webview accepts. Returns what the window is sent.
async fn show(seam: &Seam, webview: &mut FakeWebview, cli: &FakeCli, arguments: Value) -> SurfaceRecord {
    let call = cli.call("quay_board", arguments);
    seam.surfaces.verdict(webview.next_check().await.call, accepted(false));
    let shown = webview.next_shown().await;
    assert_eq!(call.answer().await, json!({ "shown": true }));
    shown
}

#[tokio::test]
async fn a_board_is_shown_on_the_strip_and_its_call_returns_at_once() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let mut board = json!({
        "title": "Migrating call sites",
        "steps": [{ "label": "Find them", "state": "done", "note": "41" }, { "label": "Change them", "state": "active" }],
        "progress": { "done": 3, "total": 7.5 },
        "stats": [{ "label": "passed", "value": "186" }],
    });
    let call = cli.call("quay_board", board.clone());

    let check = webview.next_check().await;
    assert_eq!((check.tool.as_str(), check.surface_id.as_str()), ("quay_board", "board"));
    board["status"] = json!("running");
    assert_eq!(check.arguments, board);
    seam.surfaces.verdict(check.call, accepted(false));

    let shown = webview.next_shown().await;
    assert_eq!((shown.id.as_str(), shown.tool.as_str(), shown.place), ("board", "quay_board", Place::Strip));
    assert_eq!(json!(shown)["place"], "strip");
    assert_eq!((shown.asks, shown.revision), (false, 1));
    assert_eq!(call.answer().await, json!({ "shown": true }));

    let named = show(&seam, &mut webview, &cli, json!({ "title": "Nightly", "id": "nightly" })).await;
    assert_eq!(named.id, "nightly");
}

/// The board record of a surface, as the window is sent it.
fn board_of(record: &SurfaceRecord) -> Value {
    json!(record)["board"].clone()
}

fn started_at(record: &SurfaceRecord) -> i64 {
    board_of(record)["started_at"].as_i64().expect("no clock")
}

/// Lets the clock the store reads move on.
async fn a_moment() {
    tokio::time::sleep(Duration::from_millis(5)).await;
}

#[tokio::test]
async fn the_same_id_replaces_the_board_and_keeps_its_clock() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let before = now_ms();
    let first = show(&seam, &mut webview, &cli, json!({ "title": "One" })).await;
    let started = started_at(&first);
    assert!(before <= started && started <= now_ms());
    assert_eq!(
        board_of(&first),
        json!({ "title": "One", "status": "running", "started_at": started, "updated_at": started, "stopped_at": null })
    );
    a_moment().await;

    let second = show(&seam, &mut webview, &cli, json!({ "title": "Two", "id": "board" })).await;

    assert_eq!((second.id.as_str(), second.order, second.revision), ("board", first.order, 2));
    assert!(second.change > first.change, "the newer record can be told");
    let board = board_of(&second);
    assert_eq!((&board["title"], &board["started_at"]), (&json!("Two"), &json!(started)));
    assert!(board["updated_at"].as_i64().unwrap() > started);
    assert_eq!(seam.surfaces.surfaces(), vec![second]);

    let other = show(&seam, &mut webview, &seam.cli("term-b"), json!({ "title": "Another terminal's" })).await;
    assert_eq!((other.revision, seam.surfaces.surfaces().len()), (1, 2));
}

#[tokio::test]
async fn done_and_failed_stop_the_clock_and_running_after_that_starts_a_fresh_one() {
    for status in ["done", "failed"] {
        let (seam, mut webview) = start(Timing::default()).await;
        let cli = seam.cli("term-a");
        let started = started_at(&show(&seam, &mut webview, &cli, json!({ "title": "One" })).await);
        a_moment().await;

        let settled = show(&seam, &mut webview, &cli, json!({ "title": "One", "status": status })).await;
        let board = board_of(&settled);
        assert_eq!((&board["status"], &board["started_at"]), (&json!(status), &json!(started)));
        let stopped = board["stopped_at"].clone();
        assert!(stopped.as_i64().unwrap() > started);
        a_moment().await;

        let again = show(&seam, &mut webview, &cli, json!({ "title": "Corrected", "status": "failed" })).await;
        let board = board_of(&again);
        assert_eq!((&board["stopped_at"], &board["started_at"]), (&stopped, &json!(started)), "a stopped clock stays");
        assert_eq!((&board["status"], &board["title"]), (&json!("failed"), &json!("Corrected")));
        a_moment().await;

        let running = show(&seam, &mut webview, &cli, json!({ "title": "One" })).await;
        let board = board_of(&running);
        assert!(board["started_at"].as_i64().unwrap() > stopped.as_i64().unwrap(), "a fresh clock");
        assert_eq!((&board["status"], &board["stopped_at"]), (&json!("running"), &Value::Null));
        assert_eq!(running.order, settled.order);
    }
}

#[tokio::test]
async fn a_board_that_is_done_when_it_is_first_shown_is_settled_at_once() {
    let (seam, mut webview) = start(Timing::default()).await;
    let shown = show(&seam, &mut webview, &seam.cli("term-a"), json!({ "title": "One", "status": "done" })).await;
    let board = board_of(&shown);
    assert!(board["stopped_at"].is_i64() && board["stopped_at"] == board["started_at"], "{board}");
}

#[tokio::test]
async fn an_id_in_use_by_another_kind_of_surface_is_rejected() {
    let (seam, mut webview) = start(Timing::default()).await;
    let waiting = seam.asked(&mut webview, "term-a", "One?").await;
    let before = seam.surfaces.surfaces();
    let refused = async |webview: &mut FakeWebview| {
        let call = seam.cli("term-a").call("quay_board", json!({ "title": "One", "id": "ask_1" }));
        seam.surfaces.verdict(webview.next_check().await.call, accepted(false));
        serde_json::from_str::<Value>(&call.failure().await).unwrap()
    };
    assert_eq!(
        refused(&mut webview).await,
        json!({
            "errors": [{
                "code": "INTEGRITY_ERROR",
                "surfaceId": "ask_1",
                "path": "/id",
                "message": "Surface \"ask_1\" already exists. Update it, or delete it and create it again.",
            }],
            "next": "Nothing was shown. Correct the call and send it again.",
        })
    );
    assert!(webview.nothing_shown().await && webview.none_removed());
    assert_eq!(seam.surfaces.surfaces(), before);

    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer_to("One?")).unwrap();
    waiting.answer().await;
    assert_eq!(refused(&mut webview).await["errors"][0]["code"], "INTEGRITY_ERROR", "a settled one keeps its id");
}

#[tokio::test]
async fn an_ask_is_not_named_as_a_board_is() {
    let (seam, mut webview) = start(Timing::default()).await;
    show(&seam, &mut webview, &seam.cli("term-a"), json!({ "title": "One", "id": "ask_1" })).await;
    let _call = seam.cli("term-a").call("quay_ask", question("Two?"));
    assert_eq!(webview.next_check().await.surface_id, "ask_2");
}

#[tokio::test]
async fn a_dismissed_id_is_told_so_and_shows_nothing_until_the_terminal_exits() {
    let (seam, mut webview) = start(Timing::default()).await;
    let launch = seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    let cli = seam.cli("term-a");
    // Dismissed as it runs, and once it has settled
    for (id, status) in [("one", "running"), ("two", "done")] {
        show(&seam, &mut webview, &cli, json!({ "title": "One", "id": id, "status": status })).await;
        seam.surfaces.dismiss(&key("term-a", id)).unwrap();
        assert_eq!(webview.next_removed().await, key("term-a", id));
        assert_eq!(seam.typed("term-a"), "", "one that asks nothing tells its agent nothing");

        let again = cli.call("quay_board", json!({ "title": "One", "id": id }));
        assert_eq!(again.answer().await, json!({ "dismissed": true }));
        let read = cli.call("quay_surface_read", json!({ "surface_id": id })).answer().await;
        assert_eq!(read, json!({ "surface_id": id, "state": "dismissed" }));
    }
    assert!(webview.no_check().await && webview.nothing_shown().await);
    show(&seam, &mut webview, &cli, json!({ "title": "Later run", "id": "three" })).await;

    seam.pty_manager.exit_launch(&launch, Some(0));
    webview.next_shown().await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    show(&seam, &mut webview, &cli, json!({ "title": "One", "id": "one" })).await;
}

#[tokio::test]
async fn one_dismissed_while_its_next_call_is_checked_shows_nothing() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    show(&seam, &mut webview, &cli, json!({ "title": "One" })).await;
    let call = cli.call("quay_board", json!({ "title": "Two" }));
    let check = webview.next_check().await;
    seam.surfaces.dismiss(&key("term-a", "board")).unwrap();
    seam.surfaces.verdict(check.call, accepted(false));
    assert_eq!(call.answer().await, json!({ "dismissed": true }));
    assert!(seam.surfaces.surfaces().is_empty());
}

#[tokio::test]
async fn a_fifth_live_board_is_rejected_naming_the_strip_and_a_settled_one_makes_room() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    for id in ["one", "two", "three", "four"] {
        show(&seam, &mut webview, &cli, json!({ "title": id, "id": id })).await;
    }
    let refused = async |webview: &mut FakeWebview, arguments: Value| {
        let call = cli.call("quay_board", arguments);
        seam.surfaces.verdict(webview.next_check().await.call, accepted(false));
        let rejection: Value = serde_json::from_str(&call.failure().await).unwrap();
        assert_eq!(
            rejection["errors"],
            json!([{
                "code": "VALIDATION_FAILED",
                "path": "",
                "message": "This terminal has four live surfaces in strip, the most allowed. Wait for an answer, delete one, or put several questions in one quay_ask.",
            }])
        );
    };
    refused(&mut webview, json!({ "title": "five", "id": "five" })).await;
    let _question = seam.asked(&mut webview, "term-a", "The companion has its own four?").await;
    // One that has room already, and one that needs none
    show(&seam, &mut webview, &cli, json!({ "title": "one again", "id": "one" })).await;
    show(&seam, &mut webview, &cli, json!({ "title": "five", "id": "five", "status": "done" })).await;
    refused(&mut webview, json!({ "title": "five", "id": "five" })).await;

    show(&seam, &mut webview, &cli, json!({ "title": "one", "id": "one", "status": "failed" })).await;
    show(&seam, &mut webview, &cli, json!({ "title": "five", "id": "five" })).await;
    refused(&mut webview, json!({ "title": "one", "id": "one" })).await;
}

#[tokio::test]
async fn calls_sent_at_once_cannot_pass_the_four_live_boards() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let boards = |n: usize| json!({ "title": "One", "id": format!("board_{n}") });
    let calls: Vec<OpenCall> = (0..8).map(|n| cli.call("quay_board", boards(n))).collect();
    for _ in 0..8 {
        seam.surfaces.verdict(webview.next_check().await.call, accepted(false));
    }
    let mut shown = 0;
    for call in calls {
        shown += usize::from(call.result().await["isError"].is_null());
    }
    assert_eq!((shown, seam.surfaces.surfaces().len()), (4, 4));
}

#[tokio::test]
async fn the_settled_boards_past_ten_leave_and_count_as_deleted() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    for n in 1..=11 {
        let board = json!({ "title": "One", "id": format!("run_{n}"), "status": "done" });
        assert!(webview.none_removed(), "ten are kept");
        show(&seam, &mut webview, &cli, board).await;
    }
    assert_eq!(webview.next_removed().await, key("term-a", "run_1"));
    show(&seam, &mut webview, &cli, json!({ "title": "One", "id": "run_1" })).await;
}

#[tokio::test]
async fn a_settled_board_that_is_sent_again_leaves_after_those_that_settled_before_that() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let settled = |n: usize| json!({ "title": "One", "id": format!("run_{n}"), "status": "done" });
    for n in 1..=10 {
        show(&seam, &mut webview, &cli, settled(n)).await;
    }
    show(&seam, &mut webview, &cli, settled(1)).await;
    assert!(webview.none_removed());
    show(&seam, &mut webview, &cli, settled(11)).await;
    assert_eq!(webview.next_removed().await, key("term-a", "run_2"));
    assert!(webview.none_removed());
}

#[tokio::test]
async fn an_exit_stops_a_running_board_and_leaves_a_settled_one_as_it_was() {
    let (seam, mut webview) = start(Timing::default()).await;
    let launch = seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    let cli = seam.cli("term-a");
    let running = show(&seam, &mut webview, &cli, json!({ "title": "One" })).await;
    let done = show(&seam, &mut webview, &cli, json!({ "title": "Two", "id": "two", "status": "done" })).await;

    seam.pty_manager.exit_launch(&launch, Some(0));

    let ended = webview.next_shown().await;
    assert_eq!((ended.id.as_str(), ended.asks), ("board", false));
    let at = ended.ended_at.expect("when it ended");
    let board = board_of(&ended);
    assert_eq!((&board["status"], &board["stopped_at"]), (&json!("running"), &json!(at)), "its clock stopped");
    assert!(webview.nothing_shown().await);
    assert!(seam.surfaces.surfaces().contains(&done));

    // What a later launch shows by the same id is a board of its own
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    a_moment().await;
    for id in ["board", "two"] {
        let fresh = show(&seam, &mut webview, &cli, json!({ "title": "One", "id": id })).await;
        assert!(fresh.order > running.order && fresh.order > done.order && started_at(&fresh) > at, "{id}");
        assert_eq!((fresh.revision, fresh.ended_at), (1, None), "{id}");
    }
    assert_eq!(seam.surfaces.surfaces().len(), 2);
}

#[tokio::test]
async fn a_call_returns_at_once_whatever_the_webview_says_it_asks() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call("quay_board", json!({ "title": "One" }));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    assert_eq!(call.answer().await, json!({ "shown": true }));
    assert!(!webview.next_shown().await.asks);
}

#[tokio::test]
async fn a_hundred_calls_at_once_are_all_answered_and_the_last_one_taken_stays() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let calls: Vec<OpenCall> =
        (0..100).map(|n| cli.call("quay_board", json!({ "title": format!("Call {n}") }))).collect();
    let mut last = String::new();
    for _ in 0..100 {
        let check = webview.next_check().await;
        last = check.arguments["title"].as_str().unwrap().to_string();
        seam.surfaces.verdict(check.call, accepted(false));
    }
    for call in calls {
        assert_eq!(call.answer().await, json!({ "shown": true }));
    }
    let boards = seam.surfaces.surfaces();
    assert_eq!((boards.len(), boards[0].revision), (1, 100));
    assert_eq!(board_of(&boards[0])["title"], last.as_str());
}

#[tokio::test]
async fn progress_past_its_total_or_below_none_is_shown_as_it_was_sent() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    for done in [json!(8), json!(-1)] {
        let call = cli.call("quay_board", json!({ "title": "One", "progress": { "done": done, "total": 7 } }));
        let check = webview.next_check().await;
        assert_eq!(check.arguments["progress"], json!({ "done": done, "total": 7 }));
        seam.surfaces.verdict(check.call, accepted(false));
        assert_eq!(call.answer().await, json!({ "shown": true }));
    }
}

/// The errors a call of these arguments is rejected with, each its path and message.
async fn errors(cli: &FakeCli, arguments: Value) -> Vec<(String, String)> {
    let rejection: Value = serde_json::from_str(&cli.call("quay_board", arguments).failure().await).unwrap();
    let errors = rejection["errors"].as_array().unwrap().iter();
    let text = |error: &Value, field: &str| error[field].as_str().unwrap().to_string();
    errors
        .map(|error| {
            assert_eq!(error["code"], "VALIDATION_FAILED");
            (text(error, "path"), text(error, "message"))
        })
        .collect()
}

#[tokio::test]
async fn a_call_over_a_limit_is_rejected_by_name_and_one_at_every_limit_is_shown() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let board = |over: usize| {
        let text = |limit: usize| "x".repeat(limit + over);
        json!({
            "title": text(80),
            "steps": vec![json!({ "label": text(80), "state": "done", "note": text(120) }); 30 + over],
            "stats": vec![json!({ "label": text(20), "value": text(20) }); 6 + over],
            "id": text(40),
        })
    };
    let more = "For more, send a surface with quay_surface and place strip.";
    let longer = "For longer content send a surface with quay_surface and place strip.";
    let mut over = board(1);
    over["steps"] = json!([over["steps"][0]]);
    over["stats"] = json!([over["stats"][0]]);
    let at = |path: &str, message: String| (path.to_string(), message);
    assert_eq!(
        errors(&cli, over).await,
        [
            at("/title", format!("A board title is at most 80 characters; this one is 81. {longer}")),
            at("/steps/0/label", format!("A step label is at most 80 characters; this one is 81. {longer}")),
            at("/steps/0/note", format!("A step note is at most 120 characters; this one is 121. {longer}")),
            at("/stats/0/label", format!("A stat label is at most 20 characters; this one is 21. {longer}")),
            at("/stats/0/value", format!("A stat value is at most 20 characters; this one is 21. {longer}")),
            at("/id", format!("A board id is at most 40 characters; this one is 41. {longer}")),
        ]
    );
    let many = json!({
        "title": "One",
        "steps": vec![json!({ "label": "x", "state": "done" }); 31],
        "stats": vec![json!({ "label": "x", "value": "x" }); 7],
    });
    assert_eq!(
        errors(&cli, many).await,
        [
            at("/steps", format!("A board has at most 30 steps; this one has 31. {more}")),
            at("/stats", format!("A board has at most six stats; this one has 7. {more}")),
        ]
    );
    assert!(webview.no_check().await && seam.surfaces.surfaces().is_empty());

    show(&seam, &mut webview, &cli, board(0)).await;
}

#[tokio::test]
async fn a_call_that_is_no_board_is_rejected_field_by_field() {
    let (seam, _webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let progress = "The progress is done and total, two numbers, total above 0.";
    let state = "A step state is one of pending, active, done, failed.";
    let of = |field: &str, value: Value| {
        let mut board = json!({ "title": "One" });
        board[field] = value;
        board
    };
    let cases = [
        (json!([]), "", "A call is an object."),
        (json!({}), "/title", "A board title needs some text."),
        (of("title", json!(" ")), "/title", "A board title needs some text."),
        (of("colour", json!("red")), "/colour", "quay_board has no field \"colour\" here."),
        (of("id", json!("")), "/id", "A board id needs some text."),
        (of("id", Value::Null), "/id", "A board id needs some text."),
        (of("status", json!("stopped")), "/status", "A board status is one of running, done, failed."),
        (of("steps", json!("one")), "/steps", "A board's steps are a list."),
        (of("steps", json!(["one"])), "/steps/0", "A step is an object."),
        (of("steps", json!([{ "label": "x" }])), "/steps/0/state", state),
        (of("steps", json!([{ "label": "x", "state": "Done" }])), "/steps/0/state", state),
        (of("steps", json!([{ "state": "done" }])), "/steps/0/label", "A step label needs some text."),
        (of("stats", json!([{ "label": "x", "value": 3 }])), "/stats/0/value", "A stat value needs some text."),
        (of("progress", json!(3)), "/progress", "The progress is an object."),
        (of("progress", json!({ "done": 3 })), "/progress", progress),
        (of("progress", json!({ "done": "3", "total": 7 })), "/progress", progress),
        (of("progress", json!({ "done": 0, "total": 0 })), "/progress", progress),
    ];
    for (arguments, path, message) in cases {
        assert_eq!(errors(&cli, arguments.clone()).await, [(path.to_string(), message.to_string())], "{arguments}");
    }
}

#[tokio::test]
async fn the_listed_schema_states_the_limits_the_calls_are_held_to() {
    let (seam, _webview) = start(Timing::default()).await;
    let list = seam.cli("term-a").post("tools/list", json!({})).result().await;
    let tool = list["tools"].as_array().unwrap().iter().find(|tool| tool["name"] == "quay_board").unwrap();
    let call = &tool["inputSchema"]["properties"];
    let says = |value: &Value, part: String| {
        let description = value["description"].as_str().unwrap();
        assert!(description.contains(&part), "{part:?} in {description:?}");
    };
    says(&call["title"], format!("at most {TITLE_LIMIT} characters"));
    says(&call["id"], format!("At most {ID_LIMIT} characters"));
    let (step, stat) = (&call["steps"]["items"]["properties"], &call["stats"]["items"]["properties"]);
    says(&step["label"], format!("At most {STEP_LABEL_LIMIT} characters"));
    says(&step["note"], format!("At most {NOTE_LIMIT} characters"));
    for field in ["label", "value"] {
        says(&stat[field], format!("At most {STAT_LIMIT} characters"));
    }
    assert_eq!(call["steps"]["maxItems"], MOST_STEPS);
    assert_eq!(call["stats"]["maxItems"], MOST_STATS);
    assert_eq!(tool["inputSchema"]["required"], json!(["title"]));
    says(tool, r#"{"dismissed": true}"#.to_string());
    says(tool, "a new id".to_string());
}

#[tokio::test]
async fn the_surface_tools_fit_in_the_characters_the_six_have() {
    let (seam, _webview) = start(Timing::default()).await;
    let list = seam.cli("term-a").post("tools/list", json!({})).result().await;
    let tools = list["tools"].as_array().unwrap().iter();
    let surface_tools = tools.filter(|tool| SURFACE_TOOLS.contains(&tool["name"].as_str().unwrap()));
    let characters: usize = surface_tools.map(|tool| tool.to_string().chars().count()).sum();
    assert!(characters <= 6000, "{characters}");
}
