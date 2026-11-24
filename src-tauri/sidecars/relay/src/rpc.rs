//! The little of JSON-RPC and MCP the relay reads: a message's `id` and `method`, and the one
//! param each of `initialize` and `notifications/cancelled` has a use for. Everything else
//! passes through as it was written.

use std::fmt;
use std::io::{self, Read};

use hyper::body::Bytes;
use serde::de::{self, IgnoredAny, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};

pub const PARSE_ERROR: i32 = -32700;
pub const INVALID_REQUEST: i32 = -32600;
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;

/// The relay, or Quay behind it, could not serve the request.
pub const RELAY_FAILED: i32 = -32000;

/// The longest string `Message::scan` reads in a message's own object: an id, a method or a key.
const MAX_SCANNED_STRING: usize = 64 * 1024;

/// How deep the objects and arrays `Message::scan` reads may nest.
const MAX_SCANNED_DEPTH: usize = 128;

/// A request's id. `1` and `"1"` are two ids.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Id {
    Number(serde_json::Number),
    Text(String),
}

/// By hand, as the derived one reads the whole of an array or object before it refuses it.
impl<'de> Deserialize<'de> for Id {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Id, D::Error> {
        struct IdVisitor;
        impl Visitor<'_> for IdVisitor {
            type Value = Id;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a number or a string")
            }

            fn visit_u64<E: de::Error>(self, id: u64) -> Result<Id, E> {
                Ok(Id::Number(id.into()))
            }

            fn visit_i64<E: de::Error>(self, id: i64) -> Result<Id, E> {
                Ok(Id::Number(id.into()))
            }

            fn visit_f64<E: de::Error>(self, id: f64) -> Result<Id, E> {
                let number = serde_json::Number::from_f64(id);
                number.map(Id::Number).ok_or_else(|| E::custom("not a finite number"))
            }

            fn visit_str<E: de::Error>(self, id: &str) -> Result<Id, E> {
                Ok(Id::Text(id.to_string()))
            }
        }
        deserializer.deserialize_any(IdVisitor)
    }
}

/// A request, or a notification when it has no `id`.
#[derive(Deserialize)]
pub struct Message {
    pub id: Option<Id>,
    pub method: String,
}

impl Message {
    pub fn parse(line: &[u8]) -> Result<Message, Unreadable> {
        serde_json::from_slice(line).map_err(Unreadable::from)
    }

    /// As `parse`, but holds no more of the message than strings up to `MAX_SCANNED_STRING` and
    /// a byte for each open bracket. One that has a longer string in its own object, or that nests deeper than
    /// `MAX_SCANNED_DEPTH`, is not taken for a request.
    pub fn scan(line: impl Read) -> Result<Message, Unreadable> {
        let line = Scanned { line, depth: 0, string: None, escaped: false };
        serde_json::from_reader(line).map_err(Unreadable::from)
    }
}

/// The JSON text `line`, whose reading fails where `serde_json` would have to hold too much of
/// it. That keeps the strings in the message's own object, and a byte for each open bracket.
struct Scanned<R> {
    line: R,
    depth: usize,
    /// How much of the string it is in has been read.
    string: Option<usize>,
    escaped: bool,
}

impl<R> Scanned<R> {
    /// Takes the next byte. Returns whether the limits allow it.
    fn allows(&mut self, byte: u8) -> bool {
        if let Some(length) = &mut self.string {
            *length += 1;
            let allowed = self.depth > 1 || *length <= MAX_SCANNED_STRING;
            if self.escaped {
                self.escaped = false;
            } else if byte == b'\\' {
                self.escaped = true;
            } else if byte == b'"' {
                self.string = None;
            }
            return allowed;
        }
        match byte {
            b'"' => self.string = Some(0),
            b'{' | b'[' => self.depth += 1,
            b'}' | b']' => self.depth = self.depth.saturating_sub(1),
            _ => {}
        }
        self.depth <= MAX_SCANNED_DEPTH
    }
}

impl<R: Read> Read for Scanned<R> {
    fn read(&mut self, into: &mut [u8]) -> io::Result<usize> {
        let read = self.line.read(into)?;
        if into[..read].iter().all(|byte| self.allows(*byte)) {
            Ok(read)
        } else {
            Err(io::ErrorKind::InvalidData.into())
        }
    }
}

/// Why a line is neither a request nor a notification.
pub enum Unreadable {
    NotJson,
    NotRequest,
}

impl From<serde_json::Error> for Unreadable {
    fn from(error: serde_json::Error) -> Self {
        // `Scanned` stops at its limits with an I/O error
        if error.is_data() || error.is_io() { Unreadable::NotRequest } else { Unreadable::NotJson }
    }
}

/// The protocol version an `initialize` request asks for.
pub fn protocol_version(line: &[u8]) -> Option<String> {
    #[derive(Deserialize)]
    struct Initialize {
        params: Params,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Params {
        protocol_version: String,
    }
    serde_json::from_slice(line).ok().map(|message: Initialize| message.params.protocol_version)
}

/// The id of the request a `notifications/cancelled` names.
pub fn cancelled_id(line: &[u8]) -> Option<Id> {
    #[derive(Deserialize)]
    struct Cancelled {
        params: Params,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Params {
        request_id: Id,
    }
    serde_json::from_slice(line).ok().map(|message: Cancelled| message.params.request_id)
}

/// The reply to request `id` that holds `result`.
pub fn result(id: &Id, result: Value) -> Bytes {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string().into()
}

/// The error reply to request `id`, or to a message whose id can't be read.
pub fn error(id: Option<&Id>, code: i32, message: &str) -> Bytes {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string().into()
}

/// `body` as one line, if it is a reply to request `id` and nothing else.
pub fn reply_line(id: &Id, body: &[u8]) -> Option<Bytes> {
    #[derive(Deserialize)]
    struct Reply {
        jsonrpc: String,
        id: Id,
        result: Option<IgnoredAny>,
        error: Option<IgnoredAny>,
    }
    let text = std::str::from_utf8(body).ok()?;
    let reply: Reply = serde_json::from_str(text).ok()?;
    let is_reply = reply.jsonrpc == "2.0" && reply.id == *id && reply.result.is_some() != reply.error.is_some();
    // In JSON, a line break between tokens is a space, and there is none within one
    is_reply.then(|| text.replace(['\r', '\n'], " ").into())
}
