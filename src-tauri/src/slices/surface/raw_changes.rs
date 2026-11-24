//! What the messages of a `quay_surface` call do to the surfaces they name, and what is wrong with that.

use std::collections::HashMap;

use serde_json::Value;

use super::carried::DataPath;
use super::place::Place;
use super::raw::RawCall;
use super::rejection::{CallError, Rejection};

/// What a message is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kind {
    Create,
    /// An update of its components sets no data path, and one of its data sets one.
    Update { sets: Option<DataPath> },
    Delete,
}

/// A message that is for a surface.
pub struct Message {
    pub kind: Kind,
    /// Where it is in the call.
    pub path: String,
    /// The surface it names.
    pub id: Option<String>,
}

impl Message {
    /// The message at an index of a call, when it has the key of one that is for a surface.
    pub fn read((index, value): (usize, &Value)) -> Option<Self> {
        const KEYS: [&str; 4] = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"];
        let key = KEYS.into_iter().find(|key| value.get(key).is_some())?;
        let body = &value[key];
        let kind = match key {
            "createSurface" => Kind::Create,
            "deleteSurface" => Kind::Delete,
            "updateDataModel" => Kind::Update { sets: Some(DataPath::named(body.get("path").and_then(Value::as_str))) },
            _ => Kind::Update { sets: None },
        };
        let id = body.get("surfaceId").and_then(Value::as_str).filter(|id| !id.trim().is_empty());
        Some(Self { kind, path: format!("/messages/{index}/{key}"), id: id.map(ToString::to_string) })
    }
}

/// What a call does to a surface, once all of its messages are applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// It is there, as a new one. `replaces` is whether the call deletes the one that had its id.
    Create { replaces: bool },
    /// It is there, changed. `sets` are the data paths that the call sets.
    Update { sets: Vec<DataPath> },
    /// It is gone.
    Delete,
}

/// What a call does to one surface.
pub struct Change<'a> {
    pub id: &'a str,
    pub effect: Effect,
    /// Where in the call it is told what is wrong with that: at the last message that does it.
    pub path: &'a str,
}

/// Why a surface takes no update. An answered raw one takes one, and is opened again by it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoUpdate {
    /// This typed tool made it.
    Typed(String),
    Ended,
    Withdrawn,
}

impl NoUpdate {
    /// What an agent that updates the surface `id` is told.
    fn words(&self, id: &str) -> String {
        let over = match self {
            Self::Typed(tool) => return format!("Surface \"{id}\" was made by {tool}. Call {tool} again."),
            Self::Ended => "ended when this terminal exited",
            Self::Withdrawn => "was deleted before the operator answered",
        };
        format!("Surface \"{id}\" {over}. Delete it and create it again.")
    }
}

/// What the terminal has as a surface that a message names.
pub struct Held {
    pub place: Place,
    pub title: String,
    pub no_update: Option<NoUpdate>,
    /// The accepted state as one compact `createSurface`.
    pub state: Value,
    /// Whether a create of this call may have its id.
    pub makes_way: bool,
}

/// Where a surface is as a call's messages are read.
enum At {
    /// As the terminal has it, if it does.
    Held(Option<Held>),
    /// The call created it.
    Created,
    /// The call deleted it.
    Deleted,
}

impl RawCall {
    /// What the call does to each surface it names, in the order it names them.
    pub fn changes(&self) -> Vec<Change<'_>> {
        let mut changes: Vec<Change> = Vec::new();
        let mut at: HashMap<&str, usize> = HashMap::new();
        for Message { kind, path, id } in &self.messages {
            let Some(id) = id.as_deref() else {
                continue;
            };
            let Some(change) = at.get(id).map(|at| &mut changes[*at]) else {
                let effect = match kind {
                    Kind::Create => Effect::Create { replaces: false },
                    Kind::Update { sets } => Effect::Update { sets: sets.iter().cloned().collect() },
                    Kind::Delete => Effect::Delete,
                };
                at.insert(id, changes.len());
                changes.push(Change { id, effect, path });
                continue;
            };
            match (kind, &mut change.effect) {
                (Kind::Update { sets }, Effect::Update { sets: all }) => all.extend(sets.clone()),
                // Of one the call created, whose content is all new. Of one it deleted it is an error.
                (Kind::Update { .. }, _) => continue,
                (Kind::Create, effect) => *effect = Effect::Create { replaces: *effect == Effect::Delete },
                (Kind::Delete, effect) => *effect = Effect::Delete,
            }
            change.path = path;
        }
        changes
    }

    /// Adds to `rejection` what is wrong with what the messages do. `held` gives what the terminal has.
    pub fn check_surfaces(&self, rejection: &mut Rejection, held: impl Fn(&str) -> Option<Held>) {
        let mut created = false;
        let mut surfaces: HashMap<&str, At> = HashMap::new();
        for Message { kind, path, id } in &self.messages {
            let Some(id) = id.as_deref() else {
                continue;
            };
            let first = !surfaces.contains_key(id);
            let at = surfaces.entry(id).or_insert_with(|| At::Held(held(id)));
            let mut tell = |code: &'static str, path: &str, message: String| {
                let surface_id = Some(id.to_string());
                rejection.add(CallError { code: code.into(), surface_id, path: path.to_string(), message });
            };
            match (kind, &*at) {
                (Kind::Create, _) if created => {
                    let again = "A call creates at most one surface. Send this one in a call of its own.";
                    tell("VALIDATION_FAILED", path, again.to_string());
                }
                (Kind::Create, its) => {
                    created = true;
                    if matches!(its, At::Held(Some(its)) if !its.makes_way) {
                        tell("INTEGRITY_ERROR", path, in_use(id));
                    }
                    // What follows is of this one, whether or not it could be had
                    *at = At::Created;
                }
                (Kind::Delete, _) => *at = At::Deleted,
                (Kind::Update { .. }, At::Created) => {}
                (Kind::Update { .. }, At::Deleted | At::Held(None)) => tell("INTEGRITY_ERROR", path, unknown(id)),
                (Kind::Update { .. }, At::Held(Some(its))) => {
                    if let Some(no_update) = &its.no_update {
                        tell("VALIDATION_FAILED", path, no_update.words(id));
                    } else if first {
                        self.check_repeated(id, its, tell);
                    }
                }
            }
        }
    }

    /// Tells where the call names another place or title than the surface `id` has.
    fn check_repeated(&self, id: &str, its: &Held, mut tell: impl FnMut(&'static str, &str, String)) {
        let [place, title] = &self.repeated;
        let (at, titled) = (its.place.name(), its.title.as_str());
        if place.as_ref().is_some_and(|place| place != at) {
            let fixed = format!("Surface \"{id}\" is in {at}, and a surface's place is fixed. To move it, delete it and create it again.");
            tell("VALIDATION_FAILED", "/place", fixed);
        }
        if title.as_ref().is_some_and(|title| title != titled) {
            let fixed = format!("Surface \"{id}\" is titled \"{titled}\", and a surface's title is fixed. To change it, delete the surface and create it again.");
            tell("VALIDATION_FAILED", "/title", fixed);
        }
    }
}

/// What a call is told that creates the surface `id` while its id is in use.
pub fn in_use(id: &str) -> String {
    format!("Surface \"{id}\" already exists. Update it, or delete it and create it again.")
}

/// What a call is told that updates the surface `id`, which the terminal does not have.
pub fn unknown(id: &str) -> String {
    format!("No surface \"{id}\" in this terminal. Create it first.")
}
