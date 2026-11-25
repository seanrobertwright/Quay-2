//! `quay_surface_guide` at the `/mcp` seam, and what the guide says against what Rust holds a call to.

use serde_json::{json, Value};

use super::arguments::spelled;
use super::names::SURFACE_TOOLS;
use super::place::MOST_LIVE;
use super::raw::{RawCall, TITLE_LIMIT};
use super::raw_seam::{created, plan};
use super::test_seam::{start, FakeCli, Seam};
use super::timing::{Timing, WAIT};

/// What `cli` gets for `quay_surface_guide`.
async fn guide(cli: &FakeCli) -> String {
    let result = cli.call("quay_surface_guide", json!({})).result().await;
    assert!(result["isError"].is_null(), "{result}");
    assert_eq!(result["content"].as_array().unwrap().len(), 1);
    result["content"][0]["text"].as_str().unwrap().to_string()
}

/// The surface tools `term-a` is listed.
async fn listed(seam: &Seam) -> Vec<Value> {
    let list = seam.cli("term-a").post("tools/list", json!({})).result().await;
    let tools = list["tools"].as_array().unwrap().iter();
    tools.filter(|tool| SURFACE_TOOLS.contains(&tool["name"].as_str().unwrap())).cloned().collect()
}

#[tokio::test]
async fn the_guide_is_returned_as_it_is_written_to_any_terminal_and_with_any_arguments() {
    let (seam, _webview) = start(Timing::default()).await;
    let written = include_str!("surface_guide.md");
    for terminal_id in ["term-a", "term-b"] {
        assert_eq!(guide(&seam.cli(terminal_id)).await, written);
    }
    for arguments in [Value::Null, json!({ "topic": "buttons" })] {
        let result = seam.cli("term-a").call("quay_surface_guide", arguments).result().await;
        assert_eq!(result["content"][0]["text"], written);
    }
}

#[tokio::test]
async fn the_guide_waits_neither_for_a_check_nor_for_an_answer_of_its_terminal() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (waiting, _) = created(&seam, &mut webview, &cli, "first", "companion", true).await;
    let checked = cli.call("quay_surface", plan("second", "companion"));
    webview.next_check().await;

    assert!(guide(&cli).await.starts_with("# Raw surfaces"));

    assert!(waiting.is_open() && checked.is_open());
    assert!(webview.no_check().await, "the window is asked nothing");
}

#[tokio::test]
async fn all_six_tools_are_listed_and_each_says_when_to_use_it() {
    let (seam, _webview) = start(Timing::default()).await;
    let tools = listed(&seam).await;
    let names: Vec<&str> = tools.iter().map(|tool| tool["name"].as_str().unwrap()).collect();
    assert_eq!(names, SURFACE_TOOLS);
    let uses = [
        "when you need a decision or an answer before you go on",
        "to read and decide on before you go on",
        "how a long run stands",
        "what no other tool can",
        "before your first",
        "for an answer you did not get",
    ];
    for (tool, use_) in tools.iter().zip(uses) {
        let description = tool["description"].as_str().unwrap();
        assert!(description.contains(use_), "{use_:?} in {description:?}");
    }
}

#[tokio::test]
async fn the_raw_tools_schema_states_the_limits_the_calls_are_held_to() {
    let (seam, _webview) = start(Timing::default()).await;
    let tools = listed(&seam).await;
    let tool = tools.iter().find(|tool| tool["name"] == "quay_surface").unwrap();
    let call = &tool["inputSchema"]["properties"];
    let says = |value: &Value, part: String| {
        let description = value["description"].as_str().unwrap();
        assert!(description.contains(&part), "{part:?} in {description:?}");
    };
    says(tool, format!("up to {} seconds", WAIT.as_secs()));
    says(&call["title"], format!("At most {TITLE_LIMIT} characters"));
    assert_eq!(call["messages"]["minItems"], 1);
}

#[tokio::test]
async fn the_guide_states_the_limits_rust_holds_a_call_to() {
    let (seam, _webview) = start(Timing::default()).await;
    let guide = guide(&seam.cli("term-a")).await;
    for limit in [
        format!("at most {TITLE_LIMIT} characters"),
        format!("{} live surfaces in each place", spelled(MOST_LIVE)),
        format!("up to {} seconds", WAIT.as_secs()),
    ] {
        assert!(guide.contains(&limit), "{limit}");
    }
}

#[tokio::test]
async fn rust_finds_nothing_wrong_with_the_guides_examples() {
    let (seam, _webview) = start(Timing::default()).await;
    let guide = guide(&seam.cli("term-a")).await;
    let examples: Vec<Value> =
        guide.split("```json\n").skip(1).map(|rest| serde_json::from_str(rest.split("```").next().unwrap()).unwrap()).collect();
    assert!(!examples.is_empty());
    for example in examples {
        let (_, found) = RawCall::parse(&example).unwrap_or_else(|found| panic!("{found:?} in {example}"));
        assert!(found.is_empty(), "{found:?} in {example}");
    }
}
