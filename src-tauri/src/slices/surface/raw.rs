//! `quay_surface`: what Rust reads of its call. The A2UI in it is the webview's to check.

use std::collections::BTreeSet;

use serde_json::Value;

use super::arguments::Arguments;
use super::place::Place;
use super::raw_changes::{Effect, Kind, Message};
use super::rejection::{CallError, Rejection};

pub const TOOL: &str = "quay_surface";

pub(super) const TITLE_LIMIT: usize = 80;

const FIELDS: [&str; 3] = ["messages", "place", "title"];

/// A call whose messages are a list.
pub struct RawCall {
    /// Of the surface it creates. Empty when it names none.
    pub title: String,
    /// Of the surface it creates. The companion when it names none.
    pub place: Place,
    /// `place` and `title` as a call that creates nothing has them.
    pub(super) repeated: [Option<Value>; 2],
    pub(super) messages: Vec<Message>,
}

impl RawCall {
    /// The call `arguments` hold, with what is wrong with it so far. The error is what is wrong with one
    /// that cannot be read any further.
    pub fn parse(arguments: &Value) -> Result<(Self, Rejection), Rejection> {
        let mut args = Arguments::new(TOOL, "tab");
        let Some(fields) = args.object(arguments, "", "A call", &FIELDS) else {
            return Err(found(args));
        };
        let messages = fields.get("messages").and_then(Value::as_array).filter(|messages| !messages.is_empty());
        let Some(messages) = messages else {
            args.invalid("/messages", "quay_surface needs a list of A2UI 1.0 messages.");
            return Err(found(args));
        };
        let messages: Vec<Message> = messages.iter().enumerate().filter_map(Message::read).collect();
        for message in messages.iter().filter(|message| message.id.is_none()) {
            args.invalid(format!("{}/surfaceId", message.path), "A message names its surface by a surfaceId.");
        }
        let creates = messages.iter().any(|message| message.kind == Kind::Create);
        let place = fields.get("place").and_then(Value::as_str).and_then(Place::named);
        let title = fields.get("title").and_then(Value::as_str).filter(|title| !title.trim().is_empty());
        if creates && place.is_none() {
            args.invalid("/place", "A call that creates a surface needs a place: companion, tab or strip.");
        }
        match title.map(|title| title.chars().count()) {
            None if creates => args.invalid("/title", "A call that creates a surface needs a title."),
            Some(length) if creates && length > TITLE_LIMIT => {
                args.invalid("/title", format!("A title is at most {TITLE_LIMIT} characters; this one is {length}."));
            }
            _ => {}
        }
        let repeated = match creates {
            true => [None, None],
            false => ["place", "title"].map(|field| fields.get(field).cloned()),
        };
        let place = place.unwrap_or(Place::Companion);
        let call = Self { title: title.unwrap_or_default().to_string(), place, repeated, messages };
        Ok((call, found(args)))
    }

    /// The first message that creates a surface.
    fn create(&self) -> Option<&Message> {
        self.messages.iter().find(|message| message.kind == Kind::Create)
    }

    /// The id of the surface the call creates. Empty when it creates none, or its create names none.
    pub fn creates(&self) -> &str {
        self.create().and_then(|message| message.id.as_deref()).unwrap_or_default()
    }

    /// The surfaces the call names, each once.
    pub fn names(&self) -> Vec<&str> {
        self.changes().into_iter().map(|change| change.id).collect()
    }

    /// The surfaces that are there by the call: those it creates or updates.
    pub fn shows(&self) -> Vec<&str> {
        let there = self.changes().into_iter().filter(|change| change.effect != Effect::Delete);
        there.map(|change| change.id).collect()
    }

    /// The surfaces that a message of the call updates, each once.
    pub fn updated(&self) -> Vec<&str> {
        let updates = self.messages.iter().filter(|message| matches!(message.kind, Kind::Update { .. }));
        let updated: BTreeSet<_> = updates.filter_map(|message| message.id.as_deref()).collect();
        updated.into_iter().collect()
    }

    /// An error about the surface `id`, at the message that is told what is wrong with it.
    pub fn at(&self, id: &str, code: &'static str, message: String) -> CallError {
        let path = self.changes().into_iter().find(|change| change.id == id).map(|change| change.path.to_string());
        CallError { code: code.into(), surface_id: Some(id.to_string()), path: path.unwrap_or_default(), message }
    }
}

/// Everything found wrong with a call so far.
fn found(args: Arguments) -> Rejection {
    args.finish(()).err().unwrap_or_default()
}
