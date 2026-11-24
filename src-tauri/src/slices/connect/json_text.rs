//! A JSON file's text, edited one member at a time: what is not that member keeps its bytes.

use std::collections::HashSet;
use std::ops::Range;

use serde::Serialize;
use serde_json::Value;
use serde_json::ser::PrettyFormatter;

/// What an object with no lines to copy is indented by.
const DEFAULT_UNIT: &str = "  ";

/// A JSON object's text, checked to be strict JSON whose edited objects have no key twice.
pub struct JsonText<'a> {
    text: &'a str,
    root: Object,
}

/// One object in a text.
struct Object {
    /// Just after its `{`.
    start: usize,
    /// At its `}`.
    end: usize,
    members: Vec<Member>,
}

struct Member {
    name: String,
    /// From the key's opening quote to the end of the value.
    span: Range<usize>,
    /// Where the value starts.
    value: usize,
}

/// A member that was asked for: its text, its key included, and its value.
pub struct Found<'a> {
    pub text: &'a str,
    pub value: Value,
}

/// How an object's members are laid out, for one that is added.
#[derive(Clone)]
enum Layout {
    /// All on one line.
    Compact,
    /// Each on a line of its own.
    Lines {
        newline: &'static str,
        /// One step of indentation.
        unit: String,
        /// What a member's line starts with.
        indent: String,
    },
}

impl<'a> JsonText<'a> {
    /// `text` as a JSON object, or why it can't be edited. The reason quotes nothing of `text`.
    pub fn parse(text: &'a str) -> Result<Self, String> {
        let start = if text.starts_with('\u{feff}') { '\u{feff}'.len_utf8() } else { 0 };
        if text[start..].trim().is_empty() {
            return Err("it is empty".to_string());
        }
        let value: Value = serde_json::from_str(&text[start..]).map_err(|e| format!("it is not JSON: {e}"))?;
        if !value.is_object() {
            return Err("it is not a JSON object".to_string());
        }
        let root = Object::at(text, after_space(text, start))?;
        Ok(Self { text, root })
    }

    /// The member `name` of the object `parent`.
    pub fn member(&self, parent: &str, name: &str) -> Result<Option<Found<'a>>, String> {
        let Some(object) = self.object(parent)? else { return Ok(None) };
        let Some(member) = object.find(name) else { return Ok(None) };
        let value = serde_json::from_str(&self.text[member.value..member.span.end])
            .map_err(|e| format!("it is not JSON: {e}"))?;
        Ok(Some(Found { text: &self.text[member.span.clone()], value }))
    }

    /// The text with the member `name` of the object `parent` set to `value`: in place of the one
    /// that is there, or after the last. An object `parent` that is not there is added the same way.
    pub fn with_member(&self, parent: &str, name: &str, value: &Value) -> Result<String, String> {
        let root = Layout::of_root(self.text, &self.root);
        let Some(object) = self.object(parent)? else {
            return Ok(root.insert(self.text, &self.root, parent, &serde_json::json!({ name: value })));
        };
        let layout = root.of_child(self.text, &object);
        Ok(match object.find(name) {
            Some(member) => splice(self.text, member.value..member.span.end, &layout.render(value)),
            None => layout.insert(self.text, &object, name, value),
        })
    }

    /// The text without the member `name` of the object `parent`.
    pub fn without_member(&self, parent: &str, name: &str) -> Result<Option<String>, String> {
        let Some(object) = self.object(parent)? else { return Ok(None) };
        let Some(at) = object.members.iter().position(|member| member.name == name) else { return Ok(None) };
        let span = &object.members[at].span;
        let cut = match (at.checked_sub(1), object.members.get(at + 1)) {
            (Some(before), _) => object.members[before].span.end..span.end,
            (None, Some(next)) => span.start..next.span.start,
            (None, None) => object.start..object.end,
        };
        Ok(Some(splice(self.text, cut, "")))
    }

    fn object(&self, name: &str) -> Result<Option<Object>, String> {
        let Some(member) = self.root.find(name) else { return Ok(None) };
        if !self.text[member.value..].starts_with('{') {
            return Err(format!("its \"{name}\" is not an object"));
        }
        Object::at(self.text, member.value).map(Some)
    }
}

impl Object {
    /// The object whose `{` is at `open` in `text`, which is JSON.
    fn at(text: &str, open: usize) -> Result<Self, String> {
        let start = open + 1;
        let mut members = Vec::new();
        let mut names = HashSet::new();
        let mut at = after_space(text, start);
        while text[at..].starts_with('"') {
            let key_end = string_end(text, at);
            let name: String = serde_json::from_str(&text[at..key_end]).map_err(|e| format!("it is not JSON: {e}"))?;
            if !names.insert(name.clone()) {
                return Err("it has the same key twice in one object".to_string());
            }
            let colon = after_space(text, key_end);
            let value = after_space(text, colon + 1);
            let end = value_end(text, value);
            members.push(Member { name, span: at..end, value });
            at = after_space(text, end);
            if text[at..].starts_with(',') {
                at = after_space(text, at + 1);
            }
        }
        Ok(Self { start, end: at, members })
    }

    fn find(&self, name: &str) -> Option<&Member> {
        self.members.iter().find(|member| member.name == name)
    }
}

impl Layout {
    fn of_root(text: &str, root: &Object) -> Self {
        Self::of_members(text, root, "").unwrap_or_else(|| Self::Lines {
            newline: if text.contains("\r\n") { "\r\n" } else { "\n" },
            unit: DEFAULT_UNIT.to_string(),
            indent: DEFAULT_UNIT.to_string(),
        })
    }

    /// The layout of `object`, a member of the object laid out as `self`.
    fn of_child(&self, text: &str, object: &Object) -> Self {
        let outer = match self {
            Self::Compact => "",
            Self::Lines { indent, .. } => indent,
        };
        Self::of_members(text, object, outer).unwrap_or_else(|| self.inner())
    }

    /// The layout `object`'s members have, or `None` when it has none. `outer` is what the line it
    /// starts on starts with.
    fn of_members(text: &str, object: &Object, outer: &str) -> Option<Self> {
        let before = &text[object.start..object.members.first()?.span.start];
        let Some((_, indent)) = before.rsplit_once('\n') else { return Some(Self::Compact) };
        let unit = indent.strip_prefix(outer).filter(|unit| !unit.is_empty()).unwrap_or(DEFAULT_UNIT);
        Some(Self::Lines {
            newline: if before.contains("\r\n") { "\r\n" } else { "\n" },
            unit: unit.to_string(),
            indent: indent.to_string(),
        })
    }

    /// The layout of an object that is a member here.
    fn inner(&self) -> Self {
        match self {
            Self::Compact => Self::Compact,
            Self::Lines { newline, unit, indent } => {
                Self::Lines { newline, unit: unit.clone(), indent: format!("{indent}{unit}") }
            }
        }
    }

    /// `value` as it is written for a member laid out so.
    fn render(&self, value: &Value) -> String {
        match self {
            Self::Compact => value.to_string(),
            Self::Lines { newline, unit, indent } => {
                let mut out = Vec::new();
                let formatter = PrettyFormatter::with_indent(unit.as_bytes());
                let mut serializer = serde_json::Serializer::with_formatter(&mut out, formatter);
                value.serialize(&mut serializer).expect("a JSON value is written to memory");
                let text = String::from_utf8(out).expect("JSON is UTF-8");
                text.replace('\n', &format!("{newline}{indent}"))
            }
        }
    }

    /// `text` with the member `name` added after `object`'s last.
    fn insert(&self, text: &str, object: &Object, name: &str, value: &Value) -> String {
        let member = format!("{}: {}", Value::from(name), self.render(value));
        let line = match self {
            Self::Compact => String::new(),
            Self::Lines { newline, indent, .. } => format!("{newline}{indent}"),
        };
        if let Some(last) = object.members.last() {
            let between = if line.is_empty() { " " } else { &line };
            return splice(text, last.span.end..last.span.end, &format!(",{between}{member}"));
        }
        let close = match self {
            Self::Compact => String::new(),
            Self::Lines { newline, unit, indent } => {
                format!("{newline}{}", indent.strip_suffix(unit.as_str()).unwrap_or(""))
            }
        };
        splice(text, object.start..object.end, &format!("{line}{member}{close}"))
    }
}

fn splice(text: &str, at: Range<usize>, with: &str) -> String {
    format!("{}{with}{}", &text[..at.start], &text[at.end..])
}

/// The first place in `text` at or after `at` that is not white space.
fn after_space(text: &str, at: usize) -> usize {
    text[at..].find(|c| !matches!(c, ' ' | '\t' | '\n' | '\r')).map_or(text.len(), |n| at + n)
}

/// Where the string whose opening quote is at `open` ends, its closing quote included.
fn string_end(text: &str, open: usize) -> usize {
    let bytes = text.as_bytes();
    let mut at = open + 1;
    while at < bytes.len() && bytes[at] != b'"' {
        at += if bytes[at] == b'\\' { 2 } else { 1 };
    }
    at + 1
}

/// Where the value that starts at `start` ends.
fn value_end(text: &str, start: usize) -> usize {
    let bytes = text.as_bytes();
    let mut at = start;
    let mut depth = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'"' => {
                at = string_end(text, at);
                if depth == 0 {
                    return at;
                }
                continue;
            }
            b'{' | b'[' => depth += 1,
            b'}' | b']' if depth == 0 => return at,
            b'}' | b']' => {
                depth -= 1;
                if depth == 0 {
                    return at + 1;
                }
            }
            b',' | b' ' | b'\t' | b'\n' | b'\r' if depth == 0 => return at,
            _ => {}
        }
        at += 1;
    }
    at
}
