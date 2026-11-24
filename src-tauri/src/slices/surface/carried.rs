//! What an update leaves of the unsent answer: all of it but what is at a data path that the update sets,
//! under one, or holds one.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Serialize, Serializer};
use serde_json::{Map, Value};

/// How many paths are kept beside those of the latest revision. Past it the oldest are forgotten, and
/// nothing read before them is carried on any more.
const MOST_KEPT: usize = 256;

/// A path in a surface's data model, as the engine reads it: its steps, of which the whole has none.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct DataPath(Vec<String>);

impl DataPath {
    /// The path a pointer names. An update that names none sets the whole.
    pub fn named(pointer: Option<&str>) -> Self {
        let steps = pointer.unwrap_or_default().split('/').filter(|step| !step.is_empty());
        Self(steps.map(step).collect())
    }

    fn pointer(&self) -> String {
        let steps: String = self.0.iter().map(|step| format!("/{}", step.replace('~', "~0").replace('/', "~1"))).collect();
        if steps.is_empty() { "/".to_string() } else { steps }
    }

    /// Whether one of `paths` is this one, is under it, or holds it.
    fn touches_any(&self, paths: &BTreeSet<Self>) -> bool {
        let held_by = (0..=self.0.len()).any(|steps| paths.contains(&Self(self.0[..steps].to_vec())));
        // What is under a path comes right after it
        held_by || paths.range(self..).next().is_some_and(|next| next.0.starts_with(&self.0))
    }
}

/// A step of a pointer. An index is the same one with zeros before it.
fn step(written: &str) -> String {
    if written.bytes().all(|byte| byte.is_ascii_digit()) {
        let digits = written.trim_start_matches('0');
        return if digits.is_empty() { "0".to_string() } else { digits.to_string() };
    }
    written.replace("~1", "/").replace("~0", "~")
}

/// Which of what the operator put in an earlier revision of a surface its latest one keeps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Carried {
    /// The oldest revision that anything is carried on from.
    from: u64,
    /// The paths that updates have set since, each with the last revision whose update did.
    #[serde(serialize_with = "by_pointer")]
    set: BTreeMap<DataPath, u64>,
}

impl Carried {
    /// For a surface whose content was made new at `revision`.
    pub fn new(revision: u64) -> Self {
        Self { from: revision, set: BTreeMap::new() }
    }

    /// Says that the update which made `revision` set `paths`.
    pub fn set(&mut self, revision: u64, paths: &[DataPath]) {
        self.set.extend(paths.iter().map(|path| (path.clone(), revision)));
        while self.set.len() > MOST_KEPT {
            let Some(oldest) = self.set.values().copied().min().filter(|oldest| *oldest < revision) else {
                return;
            };
            self.from = oldest;
            self.set.retain(|_, at| *at > oldest);
        }
    }

    /// Takes out of `values`, which were read at `revision`, what is not kept. `false` when they are too
    /// old for that to be told.
    pub fn keep(&self, revision: u64, values: &mut Map<String, Value>) -> bool {
        if revision < self.from {
            return false;
        }
        let set: BTreeSet<DataPath> =
            self.set.iter().filter(|(_, at)| **at > revision).map(|(path, _)| path.clone()).collect();
        values.retain(|path, _| !DataPath::named(Some(path)).touches_any(&set));
        true
    }
}

fn by_pointer<S: Serializer>(set: &BTreeMap<DataPath, u64>, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_map(set.iter().map(|(path, revision)| (path.pointer(), revision)))
}
