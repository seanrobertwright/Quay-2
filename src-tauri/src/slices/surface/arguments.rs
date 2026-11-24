//! Reading a typed tool's arguments, and collecting everything wrong with them.

use std::ops::RangeInclusive;

use serde_json::{Map, Value};

use super::rejection::Rejection;

/// The fields of one object in a call, and where in the call it is.
pub struct Fields<'a> {
    map: &'a Map<String, Value>,
    path: String,
}

impl<'a> Fields<'a> {
    pub fn get(&self, field: &str) -> Option<&'a Value> {
        self.map.get(field)
    }

    /// Where `field` is, or would be.
    pub fn path(&self, field: &str) -> String {
        format!("{}/{}", self.path, field.replace('~', "~0").replace('/', "~1"))
    }
}

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
    ) -> Option<Fields<'a>> {
        let Some(map) = value.as_object() else {
            self.invalid(path, format!("{what} is an object."));
            return None;
        };
        let read = Fields { map, path: path.to_string() };
        for key in map.keys().filter(|key| !fields.contains(&key.as_str())) {
            self.invalid(read.path(key), format!("{} has no field \"{key}\" here.", self.tool));
        }
        Some(read)
    }

    /// The text in `field`, which may be neither missing nor blank.
    pub fn text(&mut self, fields: &Fields, field: &str, what: &str, limit: usize) -> String {
        let path = fields.path(field);
        match fields.get(field).and_then(Value::as_str).filter(|text| !text.trim().is_empty()) {
            Some(text) => self.within(text, path, what, limit),
            None => {
                self.invalid(path, format!("{what} needs some text."));
                String::new()
            }
        }
    }

    /// The text in `field`, which may be left out.
    pub fn optional_text(&mut self, fields: &Fields, field: &str, what: &str, limit: usize) -> Option<String> {
        let path = fields.path(field);
        match fields.get(field)? {
            Value::String(text) => Some(self.within(text, path, what, limit)),
            _ => {
                self.invalid(path, format!("{what} is text."));
                None
            }
        }
    }

    /// Whether `field` is true. It may be left out.
    pub fn flag(&mut self, fields: &Fields, field: &str) -> bool {
        match fields.get(field) {
            None => false,
            Some(Value::Bool(flag)) => *flag,
            Some(_) => {
                self.invalid(fields.path(field), format!("{field} is true or false."));
                false
            }
        }
    }

    /// Checks that `list` holds as many `items` as `count` allows. `takes` starts the message: "A call
    /// takes" and "questions".
    pub fn count(&mut self, list: &[Value], count: RangeInclusive<usize>, path: &str, takes: &str, items: &str) {
        let length = list.len();
        if count.contains(&length) {
            return;
        }
        let (least, most) = (spelled(*count.start()), spelled(*count.end()));
        let mut message = format!("{takes} {least} to {most} {items}; this one has {length}.");
        if length > *count.end() {
            message.push_str(&self.for_more());
        }
        self.invalid(path, message);
    }

    /// `count`, for a list that may be empty. `has` starts the message: "A board has".
    pub fn at_most(&mut self, list: &[Value], most: usize, path: &str, has: &str, items: &str) {
        let length = list.len();
        if length > most {
            let (most, more) = (spelled(most), self.for_more());
            self.invalid(path, format!("{has} at most {most} {items}; this one has {length}.{more}"));
        }
    }

    /// How a message about a list with too many items ends.
    fn for_more(&self) -> String {
        format!(" For more, send a surface with quay_surface and place {}.", self.place)
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

/// `count` as a message says it: in words up to ten.
pub fn spelled(count: usize) -> String {
    const WORDS: [&str; 11] =
        ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    WORDS.get(count).map_or_else(|| count.to_string(), ToString::to_string)
}
