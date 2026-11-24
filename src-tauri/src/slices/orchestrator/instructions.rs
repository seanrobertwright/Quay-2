//! The `instructions` Quay's MCP server sends in its handshake. A CLI may show them to its model or
//! not, so each tool's own description says all that is needed to use it.

/// The most bytes of `instructions`. Claude Code cuts a server's off after 2 KB.
const LIMIT: usize = 2048;

const OPENING: &str = "Quay is the app this terminal runs in. Its tools here:";

/// What each tool is for, naming no other tool, since a terminal may lack any of them.
const USES: [(&str, &str); 13] = [
    ("quay_list_agents", "list the agents in Quay's terminals and what each is doing"),
    ("quay_send_message", "send an agent in another terminal a message, and wait for its reply if you need one"),
    ("quay_broadcast", "send every other agent in your project a notice"),
    ("quay_get_agent_status", "see what one agent is doing"),
    ("machina_submit_work_order", "submit a work order, which waits until a human admits it"),
    ("machina_get_work_order", "read a work order and its latest findings"),
    ("machina_submit_deliverable", "submit your work on a work order to its gate"),
    ("quay_ask", "ask the operator when you need an answer or a decision before you go on"),
    ("quay_review", "show the operator a plan, results or findings to decide on"),
    ("quay_board", "show the operator how a long run stands"),
    ("quay_surface", "show the operator anything else, as A2UI 1.0 messages"),
    ("quay_surface_guide", "read how to write the A2UI messages Quay draws"),
    ("quay_surface_read", "read the operator's answer again, by the id it was asked under"),
];

/// The instructions for a terminal that has `tools`: a line on each that has a use here, in their
/// order, for as long as they fit. `None` when there is no line.
pub fn for_tools<'a>(tools: impl Iterator<Item = &'a str>) -> Option<String> {
    let uses = tools.filter_map(|tool| USES.iter().find(|(name, _)| *name == tool));
    let mut text = OPENING.to_string();
    for (tool, use_) in uses {
        let line = format!("\n- {tool}: {use_}.");
        if text.len() + line.len() > LIMIT {
            break;
        }
        text.push_str(&line);
    }
    (text != OPENING).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_on_every_tool_fits_in_what_claude_code_shows() {
        let text = for_tools(USES.iter().map(|(tool, _)| *tool)).unwrap();

        assert_eq!(text.lines().count(), 1 + 13, "{text}");
        assert!(text.len() <= 2048, "{}", text.len());
    }

    #[test]
    fn what_does_not_fit_is_left_out_whole() {
        let text = for_tools(std::iter::repeat_n("quay_ask", 100)).unwrap();

        assert!(text.len() <= 2048, "{}", text.len());
        assert!(text.ends_with("before you go on."), "{text}");
    }

    #[test]
    fn a_tool_without_a_line_is_not_named() {
        assert_eq!(for_tools(["quay_unheard_of"].into_iter()), None);
    }
}
