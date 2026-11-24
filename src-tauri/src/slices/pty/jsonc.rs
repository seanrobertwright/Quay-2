//! JSON with comments and trailing commas, as OpenCode's configuration files are written.

use serde_json::{Map, Value};

/// `text` as a JSON object, its comments and trailing commas left out, or why it is not one. The
/// reason quotes nothing of `text`.
pub fn object(text: &str) -> Result<Map<String, Value>, String> {
    match serde_json::from_str(&plain(text.trim_start_matches('\u{feff}'))) {
        Ok(Value::Object(object)) => Ok(object),
        Ok(_) => Err("it is not a JSON object".to_string()),
        Err(e) => Err(format!("it is not JSON: {e}")),
    }
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
        assert_eq!(object(text).map(Value::Object), Ok(json!({ "a": [1, 2], "b": { "c": null } })));
    }

    #[test]
    fn what_is_inside_a_string_stays() {
        let text = r#"{"url": "https://x/*y*/", "quote": "a \" // b ,}", "end": "\\", }"#;
        assert_eq!(
            object(text).map(Value::Object),
            Ok(json!({ "url": "https://x/*y*/", "quote": "a \" // b ,}", "end": "\\" }))
        );
    }

    #[test]
    fn what_is_not_a_json_object_then_is_refused_with_the_reason_and_none_of_its_text() {
        for text in ["", "{", "{a: 1}", "[1,,]", "{\"a\": {env:X}}", "\"open", "1/**/2"] {
            let reason = object(text).unwrap_err();
            assert!(reason.starts_with("it is not JSON: "), "{text:?}: {reason}");
        }
        for text in ["[1]", "null", "\"a\""] {
            assert_eq!(object(text), Err("it is not a JSON object".to_string()), "{text:?}");
        }
        let reason = object("{\"key\": sk-hunter2}").unwrap_err();
        assert!(!reason.contains("hunter2"), "{reason}");
    }
}
