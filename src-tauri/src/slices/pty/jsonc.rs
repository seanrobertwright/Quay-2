//! JSON with comments and trailing commas, as OpenCode's configuration files are written.

use serde_json::Value;

/// `text` as JSON, its comments and trailing commas left out. `None` when it is not JSON then.
pub fn parse(text: &str) -> Option<Value> {
    serde_json::from_str(&plain(text.trim_start_matches('\u{feff}'))).ok()
}

/// `text` without its comments and trailing commas. What is inside a string stays.
fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    // Where in `out` a comma is that only white space and comments have followed
    let mut comma = None;
    while let Some(c) = chars.next() {
        match (c, chars.peek()) {
            ('"', _) => {
                out.push(c);
                comma = None;
                while let Some(c) = chars.next() {
                    out.push(c);
                    match c {
                        '"' => break,
                        '\\' => out.extend(chars.next()),
                        _ => {}
                    }
                }
            }
            ('/', Some('/')) => {
                while chars.next_if(|&c| c != '\n').is_some() {}
            }
            ('/', Some('*')) => {
                chars.next();
                let mut last = ' ';
                for c in chars.by_ref() {
                    if last == '*' && c == '/' {
                        break;
                    }
                    last = c;
                }
                // So that what a comment stood between stays apart
                out.push(' ');
            }
            _ => {
                if c == ',' {
                    comma = Some(out.len());
                } else if !c.is_whitespace() {
                    if let (']' | '}', Some(at)) = (c, comma) {
                        out.remove(at);
                    }
                    comma = None;
                }
                out.push(c);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn comments_and_trailing_commas_are_left_out() {
        let text = "\u{feff}// first\n{ /* a, } */ \"a\": [1, 2, // last\n ], \"b\": {\"c\": null,},\r\n /**/ }\n/* unclosed";
        assert_eq!(parse(text), Some(json!({ "a": [1, 2], "b": { "c": null } })));
    }

    #[test]
    fn what_is_inside_a_string_stays() {
        let text = r#"{"url": "https://x/*y*/", "quote": "a \" // b ,}", "end": "\\", }"#;
        assert_eq!(parse(text), Some(json!({ "url": "https://x/*y*/", "quote": "a \" // b ,}", "end": "\\" })));
    }

    #[test]
    fn what_is_not_json_then_is_refused() {
        for text in ["", "{", "{a: 1}", "[1,,]", "{\"a\": {env:X}}", "\"open", "1/**/2"] {
            assert_eq!(parse(text), None, "{text:?}");
        }
    }
}
