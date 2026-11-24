//! `quay_surface`: what Rust reads of its call. The A2UI in it is the webview's to check.

use serde_json::Value;

use super::arguments::Arguments;
use super::place::Place;
use super::rejection::{CallError, Rejection};

pub const TOOL: &str = "quay_surface";

pub(super) const TITLE_LIMIT: usize = 80;

const FIELDS: [&str; 3] = ["messages", "place", "title"];

const CREATE: &str = "createSurface";
const DELETE: &str = "deleteSurface";

/// The messages that are for a surface, by the one key each has.
const KINDS: [&str; 4] = [CREATE, "updateComponents", "updateDataModel", DELETE];

/// A message that is for a surface.
struct Message {
    kind: &'static str,
    /// Where it is in the call.
    path: String,
    /// The surface it names.
    id: Option<String>,
}

/// What the terminal has as a surface that a message names.
pub struct Held {
    pub place: Place,
    pub title: String,
    /// Whether a create of this call may not have its id.
    pub in_use: bool,
}

/// A call whose messages are a list.
pub struct RawCall {
    /// Of the surface it creates. Empty when it names none.
    pub title: String,
    /// Of the surface it creates. The companion when it names none.
    pub place: Place,
    /// `place` and `title` as a call that creates nothing has them.
    repeated: [Option<Value>; 2],
    messages: Vec<Message>,
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
        let creates = messages.iter().any(|message| message.kind == CREATE);
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
        self.messages.iter().find(|message| message.kind == CREATE)
    }

    /// The id of the surface the call creates. Empty when it creates none, or its create names none.
    pub fn creates(&self) -> &str {
        self.create().and_then(|message| message.id.as_deref()).unwrap_or_default()
    }

    /// An error about the surface the call creates, at the message that does.
    pub fn at_create(&self, code: &'static str, message: String) -> CallError {
        let path = self.create().map(|create| create.path.clone()).unwrap_or_default();
        CallError { code: code.into(), surface_id: Some(self.creates().to_string()), path, message }
    }

    /// The error of a call that creates a surface whose id is in use.
    pub fn in_use(&self) -> CallError {
        let id = self.creates();
        let message = format!("Surface \"{id}\" already exists. Update it, or delete it and create it again.");
        self.at_create("INTEGRITY_ERROR", message)
    }

    /// Adds to `rejection` what is wrong with the surfaces the messages name. `held` gives those the
    /// terminal has. From its create on, the one the call creates is there too.
    pub fn check_surfaces(&self, rejection: &mut Rejection, held: impl Fn(&str) -> Option<Held>) {
        let mut created: Option<&str> = None;
        for message in &self.messages {
            let Some(id) = message.id.as_deref() else {
                continue;
            };
            let mut tell = |code: &'static str, path: &str, message: String| {
                let surface_id = Some(id.to_string());
                rejection.add(CallError { code: code.into(), surface_id, path: path.to_string(), message });
            };
            match (message.kind, held(id)) {
                (CREATE, _) if created.is_some() => {
                    let again = "A call creates at most one surface. Send this one in a call of its own.";
                    tell("VALIDATION_FAILED", &message.path, again.to_string());
                }
                (CREATE, its) => {
                    created = Some(id);
                    if its.is_some_and(|its| its.in_use) {
                        rejection.add(self.in_use());
                    }
                }
                (DELETE, its) => {
                    if its.is_some() || created == Some(id) {
                        let not_yet = "Quay does not delete a surface for its agent yet. The operator can dismiss it.";
                        tell("VALIDATION_FAILED", &message.path, not_yet.to_string());
                    }
                }
                _ if created == Some(id) => {}
                (_, None) => {
                    let unknown = format!("No surface \"{id}\" in this terminal. Create it first.");
                    tell("INTEGRITY_ERROR", &message.path, unknown);
                }
                (_, Some(its)) => {
                    let [place, title] = &self.repeated;
                    let (at, titled) = (its.place.name(), its.title.as_str());
                    if place.as_ref().is_some_and(|place| place != at) {
                        let fixed = format!(
                            "Surface \"{id}\" is in {at}, and a surface's place is fixed. To move it, delete it and create it again."
                        );
                        tell("VALIDATION_FAILED", "/place", fixed);
                    }
                    if title.as_ref().is_some_and(|title| title != titled) {
                        let fixed = format!(
                            "Surface \"{id}\" is titled \"{titled}\", and a surface's title is fixed. To change it, delete the surface and create it again."
                        );
                        tell("VALIDATION_FAILED", "/title", fixed);
                    }
                    let not_yet = "Quay does not update a surface that is shown yet. Create one with an id of its own.";
                    tell("VALIDATION_FAILED", &message.path, not_yet.to_string());
                }
            }
        }
    }
}

impl Message {
    /// The message at an index of a call, when it has the key of one that is for a surface.
    fn read((index, value): (usize, &Value)) -> Option<Self> {
        let kind = KINDS.into_iter().find(|kind| value.get(kind).is_some())?;
        let id = value[kind].get("surfaceId").and_then(Value::as_str).filter(|id| !id.trim().is_empty());
        Some(Self { kind, path: format!("/messages/{index}/{kind}"), id: id.map(ToString::to_string) })
    }
}

/// Everything found wrong with a call so far.
fn found(args: Arguments) -> Rejection {
    args.finish(()).err().unwrap_or_default()
}
