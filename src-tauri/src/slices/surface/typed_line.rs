//! The line Quay types into an agent's terminal for an answer that no open call can return.

use serde_json::Value;

const LEAD: &str = "[Quay surface \"";

/// `result`, what a surface's call would have returned, as the line typed into its terminal. Nothing
/// in it reaches the terminal as a control code: `title` and `id` lose their non-printing characters,
/// and in the JSON each is escaped, so what is read back is what was written.
pub fn typed_line(title: &str, id: &str, result: &Value) -> String {
    let printed = |text: &str| text.chars().filter(|c| !is_non_printing(*c)).collect::<String>();
    format!("{LEAD}{}\" ({})]: {}", printed(title), printed(id), escaped(&result.to_string()))
}

/// Whether `prompt`, which a CLI reports its turn started with, has the shape of a line `typed_line`
/// makes. Text of that shape which the operator typed counts as one too.
pub fn is_typed_line(prompt: &str) -> bool {
    prompt.strip_prefix(LEAD).is_some_and(|rest| rest.contains("\" (") && rest.contains(")]: {"))
}

/// `json` with each non-printing character escaped. JSON holds one only inside a string.
fn escaped(json: &str) -> String {
    let mut line = String::with_capacity(json.len());
    for c in json.chars() {
        if is_non_printing(c) {
            for unit in c.encode_utf16(&mut [0; 2]) {
                line.push_str(&format!("\\u{unit:04x}"));
            }
        } else {
            line.push(c);
        }
    }
    line
}

/// A control character (C0, DEL or C1), a line or paragraph separator, or one of Unicode's format
/// characters, which show nothing and can reorder or hide the text beside them.
fn is_non_printing(c: char) -> bool {
    c.is_control()
        || matches!(c,
            '\u{ad}'
            | '\u{600}'..='\u{605}'
            | '\u{61c}'
            | '\u{6dd}'
            | '\u{70f}'
            | '\u{890}'..='\u{891}'
            | '\u{8e2}'
            | '\u{180e}'
            | '\u{200b}'..='\u{200f}'
            | '\u{2028}'..='\u{202e}'
            | '\u{2060}'..='\u{206f}'
            | '\u{feff}'
            | '\u{fff9}'..='\u{fffb}'
            | '\u{110bd}'
            | '\u{110cd}'
            | '\u{13430}'..='\u{1343f}'
            | '\u{1bca0}'..='\u{1bca3}'
            | '\u{1d173}'..='\u{1d17a}'
            | '\u{e0000}'..='\u{e007f}')
}
