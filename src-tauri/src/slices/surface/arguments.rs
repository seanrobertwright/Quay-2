//! Reading a typed tool's arguments, and collecting everything wrong with them.

use std::ops::RangeInclusive;

use serde_json::{Map, Value};

use super::rejection::Rejection;

/// A reading of one call. What it returns for a value that is wrong only stands in for it: the call
/// is rejected, so nothing uses it.
pub struct Arguments {
    tool: &'static str,
    /// The place where the raw tool draws the tool's longer content.
    place: &'static str,
    rejection: Rejection,
}

impl Arguments {
    pub fn new(tool: &'static str, place: &'static str) -> Self {
        Self { tool, place, rejection: Rejection::default() }
    }

    /// `read`, unless something was wrong with the call.
    pub fn finish<T>(self, read: T) -> Result<T, Rejection> {
        if self.rejection.is_empty() {
            Ok(read)
        } else {
            Err(self.rejection)
        }
    }

    pub fn invalid(&mut self, path: impl Into<String>, message: impl Into<String>) {
        self.rejection.add_invalid(path, message);
    }

    /// `value` as an object with no field outside `fields`.
    pub fn object<'a>(
        &mut self,
        value: &'a Value,
        path: &str,
        what: &str,
        fields: &[&str],
    ) -> Option<&'a Map<String, Value>> {
        let Some(map) = value.as_object() else {
            self.invalid(path, format!("{what} is an object."));
            return None;
        };
        for key in map.keys().filter(|key| !fields.contains(&key.as_str())) {
            let path = format!("{path}/{}", key.replace('~', "~0").replace('/', "~1"));
            self.invalid(path, format!("{} has no field \"{key}\" here.", self.tool));
        }
        Some(map)
    }

    /// The text in `field`, which may be neither missing nor blank.
    pub fn text(&mut self, fields: &Map<String, Value>, field: &str, path: &str, what: &str, limit: usize) -> String {
        let path = format!("{path}/{field}");
        match fields.get(field).and_then(Value::as_str).filter(|text| !text.trim().is_empty()) {
            Some(text) => self.within(text, path, what, limit),
            None => {
                self.invalid(path, format!("{what} needs some text."));
                String::new()
            }
        }
    }

    /// The text in `field`, which may be left out.
    pub fn optional_text(
        &mut self,
        fields: &Map<String, Value>,
        field: &str,
        path: &str,
        what: &str,
        limit: usize,
    ) -> Option<String> {
        let path = format!("{path}/{field}");
        match fields.get(field)? {
            Value::String(text) => Some(self.within(text, path, what, limit)),
            _ => {
                self.invalid(path, format!("{what} is text."));
                None
            }
        }
    }

    /// Whether `field` is true. It may be left out.
    pub fn flag(&mut self, fields: &Map<String, Value>, field: &str, path: &str) -> bool {
        match fields.get(field) {
            None => false,
            Some(Value::Bool(flag)) => *flag,
            Some(_) => {
                self.invalid(format!("{path}/{field}"), format!("{field} is true or false."));
                false
            }
        }
    }

    /// Checks that `list` holds as many as `count` allows, which `rule` says in words.
    pub fn count(&mut self, list: &[Value], count: RangeInclusive<usize>, path: &str, rule: &str) {
        let length = list.len();
        if count.contains(&length) {
            return;
        }
        let mut message = format!("{rule}; this one has {length}.");
        if length > *count.end() {
            message.push_str(&format!(" For more, send a surface with quay_surface and place {}.", self.place));
        }
        self.invalid(path, message);
    }

    /// `text`, which may be at most `limit` characters.
    fn within(&mut self, text: &str, path: String, what: &str, limit: usize) -> String {
        let length = text.chars().count();
        if length > limit {
            let place = self.place;
            let message = format!(
                "{what} is at most {limit} characters; this one is {length}. \
                 For longer content send a surface with quay_surface and place {place}."
            );
            self.invalid(path, message);
        }
        text.to_string()
    }
}
