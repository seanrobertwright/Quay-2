//! Antigravity's own MCP configuration, and Quay's relay as an entry in it.
//!
//! Antigravity takes its servers from a file only, and starts each in every session, in Quay or not.
//! So the entry is written only when the operator asks, and names nothing of one Quay or one
//! terminal: the relay reads the server's URL and the token from the terminal's environment.

use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{Value, json};

use super::config_file::ConfigFile;
use super::json_text::JsonText;
use crate::slices::surface::timing::CLI_LIMIT;

/// The object in the file that holds the servers, and Quay's key in it.
const SERVERS: &str = "mcpServers";
const QUAY: &str = "quay";

const NOT_SHOWN: &str = "the file's entry is not the one shown";

/// Where Quay's entry stands in the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    /// There is no entry, or no file.
    Missing,
    /// The entry is the one Quay writes.
    Connected,
    /// The entry starts a relay that is not this Quay's.
    OldRelay,
    /// The entry is not one this Quay writes.
    Changed,
    /// The file can't be read or edited.
    Unreadable,
}

/// What the Connect row shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Connection {
    /// The file's path.
    pub file: String,
    /// The entry Connect writes.
    pub entry: String,
    pub state: State,
    /// The entry that is in the file, as it is written there.
    pub found: Option<String>,
    /// Why the file can't be read or edited.
    pub problem: Option<String>,
}

/// The entry that is in the file: its text, its key included, and its value.
struct Found {
    text: String,
    value: Value,
}

/// Antigravity's configuration file and the relay an entry in it starts.
pub struct Antigravity {
    file: PathBuf,
    relay: PathBuf,
    /// Held from reading the file to having replaced it.
    editing: Mutex<()>,
}

impl Antigravity {
    pub fn new(file: PathBuf, relay: PathBuf) -> Self {
        Self { file, relay, editing: Mutex::new(()) }
    }

    /// Where the entry stands now. Writes nothing.
    pub fn connection(&self) -> Connection {
        let (found, problem) = match self.found() {
            Ok(found) => (found, None),
            Err(problem) => (None, Some(problem)),
        };
        let state = match &found {
            _ if problem.is_some() => State::Unreadable,
            None => State::Missing,
            Some(found) => self.state_of(&found.value),
        };
        Connection {
            file: self.file.to_string_lossy().into_owned(),
            entry: format!("\"{QUAY}\": {:#}", self.entry()),
            state,
            found: found.map(|found| found.text),
            problem,
        }
    }

    /// Writes the entry, in place of `seen`, the one the operator was shown, if any. Where the file
    /// holds another, nothing is written.
    pub fn connect(&self, seen: Option<&str>) -> Result<(), String> {
        if !self.relay.is_file() {
            return Err(not_written(&format!("Quay's relay is not at {}", self.relay.display())));
        }
        self.edit(seen, |text| match text {
            Some(text) => text.with_member(SERVERS, QUAY, &self.entry()),
            None => Ok(format!("{:#}
", json!({ SERVERS: { QUAY: self.entry() } }))),
        })
    }

    /// Takes out `seen`, the entry the operator was shown, and nothing else. Where the file holds
    /// another, nothing is written.
    pub fn remove(&self, seen: &str) -> Result<(), String> {
        self.edit(Some(seen), |text| text.ok_or(NOT_SHOWN)?.without_member(SERVERS, QUAY)?.ok_or(NOT_SHOWN.to_string()))
    }

    /// Replaces the file with what `edited` makes of it, while its entry is `seen`.
    fn edit(
        &self,
        seen: Option<&str>,
        edited: impl FnOnce(Option<JsonText>) -> Result<String, String>,
    ) -> Result<(), String> {
        let _editing = self.editing.lock();
        let replace = || {
            let file = ConfigFile::read(&self.file)?;
            let text = file.text()?.map(JsonText::parse).transpose()?;
            let found = text.as_ref().map(|text| text.member(SERVERS, QUAY)).transpose()?.flatten();
            if found.map(|found| found.text) != seen {
                return Err(NOT_SHOWN.to_string());
            }
            file.replace(&edited(text)?)
        };
        replace().map_err(|reason: String| not_written(&reason))
    }

    /// The entry that is in the file.
    fn found(&self) -> Result<Option<Found>, String> {
        let file = ConfigFile::read(&self.file)?;
        let Some(text) = file.text()? else { return Ok(None) };
        let found = JsonText::parse(text)?.member(SERVERS, QUAY)?;
        Ok(found.map(|found| Found { text: found.text.to_string(), value: found.value }))
    }

    fn state_of(&self, found: &Value) -> State {
        let names_a_relay = found["command"]
            .as_str()
            .is_some_and(|command| Path::new(command).file_name() == self.relay.file_name());
        if *found == self.entry() {
            State::Connected
        } else if names_a_relay && found["command"] != self.entry()["command"] {
            State::OldRelay
        } else {
            State::Changed
        }
    }

    /// The entry: how Antigravity starts the relay, and how long it waits on a call to it.
    fn entry(&self) -> Value {
        json!({ "command": self.relay.to_string_lossy(), "timeoutSeconds": CLI_LIMIT.as_secs() })
    }
}

fn not_written(reason: &str) -> String {
    format!("Nothing was written: {reason}.")
}
