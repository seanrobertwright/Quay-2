//! `quay_board`: what its call may hold.

use serde::Serialize;
use serde_json::{Number, Value};

use super::arguments::{Arguments, Fields};
use super::place::Place;
use super::rejection::Rejection;

pub const TOOL: &str = "quay_board";
pub const PLACE: Place = Place::Strip;

/// The id of the board of a call that names none.
pub(super) const DEFAULT_ID: &str = "board";

pub(super) const TITLE_LIMIT: usize = 80;
pub(super) const MOST_STEPS: usize = 30;
pub(super) const STEP_LABEL_LIMIT: usize = 80;
pub(super) const NOTE_LIMIT: usize = 120;
pub(super) const MOST_STATS: usize = 6;
pub(super) const STAT_LIMIT: usize = 20;
pub(super) const ID_LIMIT: usize = 40;

/// A checked `quay_board` call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Board {
    /// The surface's own id, which is no part of what it shows.
    #[serde(skip)]
    pub id: String,
    pub title: String,
    pub steps: Vec<Step>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<Progress>,
    pub stats: Vec<Stat>,
    pub status: Status,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Step {
    pub label: String,
    pub state: StepState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StepState {
    Pending,
    Active,
    Done,
    Failed,
}

/// Work that is counted. `total` is above 0. `done` is as its agent sent it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Progress {
    pub done: Number,
    pub total: Number,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Stat {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Running,
    Done,
    Failed,
}

impl Board {
    /// The call `arguments` hold, or everything wrong with them.
    pub fn parse(arguments: &Value) -> Result<Self, Rejection> {
        let mut args = Arguments::new(TOOL, PLACE.name());
        let board = Self::read(&mut args, arguments);
        args.finish(board)
    }

    fn read(args: &mut Arguments, arguments: &Value) -> Self {
        let mut board = Self {
            id: DEFAULT_ID.to_string(),
            title: String::new(),
            steps: Vec::new(),
            progress: None,
            stats: Vec::new(),
            status: Status::Running,
        };
        let fields = ["title", "steps", "progress", "stats", "status", "id"];
        let Some(call) = args.object(arguments, "", "A call", &fields) else {
            return board;
        };
        board.title = args.text(&call, "title", "A board title", TITLE_LIMIT);
        board.steps = list(args, &call, "steps", MOST_STEPS, Step::read);
        board.progress = call.get("progress").and_then(|value| Progress::read(args, value, &call.path("progress")));
        board.stats = list(args, &call, "stats", MOST_STATS, Stat::read);
        if call.get("status").is_some() {
            let statuses = [("running", Status::Running), ("done", Status::Done), ("failed", Status::Failed)];
            board.status = one_of(args, &call, "status", "A board status", &statuses);
        }
        if call.get("id").is_some() {
            board.id = args.text(&call, "id", "A board id", ID_LIMIT);
        }
        board
    }
}

impl Step {
    fn read(args: &mut Arguments, value: &Value, path: &str) -> Option<Self> {
        let fields = args.object(value, path, "A step", &["label", "state", "note"])?;
        let states = [
            ("pending", StepState::Pending),
            ("active", StepState::Active),
            ("done", StepState::Done),
            ("failed", StepState::Failed),
        ];
        Some(Self {
            label: args.text(&fields, "label", "A step label", STEP_LABEL_LIMIT),
            state: one_of(args, &fields, "state", "A step state", &states),
            note: args.optional_text(&fields, "note", "A step note", NOTE_LIMIT),
        })
    }
}

impl Progress {
    fn read(args: &mut Arguments, value: &Value, path: &str) -> Option<Self> {
        let fields = args.object(value, path, "The progress", &["done", "total"])?;
        let number = |field| fields.get(field).and_then(Value::as_number);
        match (number("done"), number("total")) {
            (Some(done), Some(total)) if total.as_f64().is_some_and(|total| total > 0.0) => {
                Some(Self { done: done.clone(), total: total.clone() })
            }
            _ => {
                args.invalid(path, "The progress is done and total, two numbers, total above 0.");
                None
            }
        }
    }
}

impl Stat {
    fn read(args: &mut Arguments, value: &Value, path: &str) -> Option<Self> {
        let fields = args.object(value, path, "A stat", &["label", "value"])?;
        Some(Self {
            label: args.text(&fields, "label", "A stat label", STAT_LIMIT),
            value: args.text(&fields, "value", "A stat value", STAT_LIMIT),
        })
    }
}

/// The list in `field` of a call, which may be left out and holds at most `most`, each read by `read`.
fn list<T>(
    args: &mut Arguments,
    call: &Fields,
    field: &str,
    most: usize,
    read: impl Fn(&mut Arguments, &Value, &str) -> Option<T>,
) -> Vec<T> {
    let path = call.path(field);
    let Some(value) = call.get(field) else {
        return Vec::new();
    };
    let Some(values) = value.as_array() else {
        args.invalid(path, format!("A board's {field} are a list."));
        return Vec::new();
    };
    args.at_most(values, most, &path, "A board has", field);
    let items = values.iter().enumerate();
    items.filter_map(|(i, value)| read(args, value, &format!("{path}/{i}"))).collect()
}

/// Which of `choices` the word in `field` is, or, for one that is none of them, the first.
fn one_of<T: Copy>(args: &mut Arguments, fields: &Fields, field: &str, what: &str, choices: &[(&str, T)]) -> T {
    let word = fields.get(field).and_then(Value::as_str);
    if let Some((_, choice)) = choices.iter().find(|(name, _)| Some(*name) == word) {
        return *choice;
    }
    let names: Vec<&str> = choices.iter().map(|(name, _)| *name).collect();
    args.invalid(fields.path(field), format!("{what} is one of {}.", names.join(", ")));
    choices[0].1
}
