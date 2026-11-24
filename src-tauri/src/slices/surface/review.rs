//! `quay_review`: what its call may hold.

use std::collections::HashMap;
use std::ops::RangeInclusive;

use serde::Serialize;
use serde_json::Value;

use super::arguments::Arguments;
use super::place::Place;
use super::rejection::Rejection;

pub const TOOL: &str = "quay_review";
pub const PLACE: Place = Place::Tab;

/// What its surfaces are named by: `review_1` and on.
pub const NAMED: &str = "review";

pub(super) const TITLE_LIMIT: usize = 80;
pub(super) const BODY_LIMIT: usize = 20_000;
pub(super) const ITEM_COUNT: RangeInclusive<usize> = 0..=30;
pub(super) const ITEM_TITLE_LIMIT: usize = 120;
pub(super) const DETAIL_LIMIT: usize = 300;

/// A checked `quay_review` call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Review {
    pub title: String,
    pub body: String,
    pub items: Vec<Item>,
}

/// What the operator keeps or drops.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Item {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// A path, which may end in `:line`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

impl Review {
    /// The call `arguments` hold, or everything wrong with them.
    pub fn parse(arguments: &Value) -> Result<Self, Rejection> {
        let mut args = Arguments::new(TOOL, Place::Tab.name());
        let review = Self::read(&mut args, arguments);
        args.finish(review)
    }

    fn read(args: &mut Arguments, arguments: &Value) -> Self {
        let mut review = Self { title: String::new(), body: String::new(), items: Vec::new() };
        let Some(call) = args.object(arguments, "", "A call", &["title", "body", "items"]) else {
            return review;
        };
        review.title = args.text(&call, "title", "A title", TITLE_LIMIT);
        review.body = args.text(&call, "body", "The body", BODY_LIMIT);
        if let Some(items) = call.get("items") {
            review.items = Item::read_list(args, items);
        }
        review
    }
}

impl Item {
    fn read_list(args: &mut Arguments, value: &Value) -> Vec<Self> {
        let Some(values) = value.as_array() else {
            args.invalid("/items", "A review's items are a list.");
            return Vec::new();
        };
        args.count(values, ITEM_COUNT, "/items", "A call takes", "items");
        let mut items = Vec::with_capacity(values.len());
        // Where each title was first
        let mut first_at: HashMap<String, usize> = HashMap::new();
        for (i, value) in values.iter().enumerate() {
            let path = format!("/items/{i}");
            let Some(item) = Self::read(args, value, &path) else {
                continue;
            };
            // A title that is missing is an error of its own
            if !item.title.is_empty() {
                let first = *first_at.entry(item.title.clone()).or_insert(i);
                if first != i {
                    let message =
                        format!("Two items cannot share a title. \"{}\" is also item {}.", item.title, first + 1);
                    args.invalid(format!("{path}/title"), message);
                }
            }
            items.push(item);
        }
        items
    }

    fn read(args: &mut Arguments, value: &Value, path: &str) -> Option<Self> {
        let fields = args.object(value, path, "An item", &["title", "detail", "file"])?;
        let title = args.text(&fields, "title", "An item title", ITEM_TITLE_LIMIT);
        let detail = args.optional_text(&fields, "detail", "An item detail", DETAIL_LIMIT);
        let file = match fields.get("file") {
            None => None,
            Some(Value::String(file)) => Some(file.clone()),
            Some(_) => {
                args.invalid(fields.path("file"), "An item file is text.");
                None
            }
        };
        Some(Self { title, detail, file })
    }
}
