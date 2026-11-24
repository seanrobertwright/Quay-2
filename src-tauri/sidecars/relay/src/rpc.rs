use hyper::body::Bytes;
use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;
pub const RELAY_FAILED: i32 = -32000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Id {
    Number(serde_json::Number),
    Text(String),
}

#[derive(Deserialize)]
pub struct Message {
    pub id: Option<Id>,
    pub method: String,
}

impl Message {
    pub fn parse(line: &[u8]) -> Option<Message> {
        serde_json::from_slice(line).ok()
    }
}

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

pub fn result(id: &Id, result: Value) -> Bytes {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string().into()
}

pub fn error(id: &Id, code: i32, message: &str) -> Bytes {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string().into()
}

pub fn reply_line(id: &Id, body: Bytes) -> Option<Bytes> {
    #[derive(Deserialize)]
    struct Reply {
        jsonrpc: String,
        id: Id,
        result: Option<IgnoredAny>,
        error: Option<IgnoredAny>,
    }
    let text = std::str::from_utf8(&body).ok()?;
    let reply: Reply = serde_json::from_str(text).ok()?;
    let is_reply = reply.jsonrpc == "2.0" && reply.id == *id && reply.result.is_some() != reply.error.is_some();
    // In JSON, a line break between tokens is a space, and there is none within one
    is_reply.then(|| text.replace(['\r', '\n'], " ").into())
}
