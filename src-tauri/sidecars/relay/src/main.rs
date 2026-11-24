//! Quay's relay, bundled with Quay as a sidecar. A CLI that reads only static configuration
//! starts it as a stdio MCP server, and it connects that CLI to Quay's own MCP server:
//!
//! - it posts each message it reads, other than a cancel, to `/mcp`, as it was written and with
//!   the terminal's token, and writes the reply back. It has no tools of its own, and keeps
//!   nothing but the calls that are open;
//! - on `notifications/cancelled` it closes the named request's HTTP call, which is how Quay
//!   learns that nobody waits for it. The notification itself goes no further;
//! - it ends when its stdin closes.
//!
//! The CLI passes its environment on, so the server's URL and the bearer token come from the
//! `QUAY_*` variables Quay sets on the terminal, and neither the CLI's configuration nor the
//! command line holds them. Where they are not set, the relay is an MCP server with no tools.
//!
//! The relay writes nothing but replies to stdout, nothing to stderr, and keeps no log.

mod calls;
mod outside;
mod quay;
mod rpc;
mod stdio;

use std::process::ExitCode;

use calls::OpenCalls;
use hyper::body::Bytes;
use quay::Quay;
use rpc::{Id, Message, Unreadable};
use stdio::{Line, Out};

const REQUEST_TOO_LONG: &str = "The request is over 2 MB, so the relay refuses it.";
const TOO_MANY: &str = "Too many requests are open. Try again when one has finished.";
const NO_REPLY: &str = "Quay's MCP server sent no reply to this request.";

/// Where requests go.
enum Route {
    Quay(Quay),
    /// The variables are set and can't be used, for this reason.
    Refused(&'static str),
    /// A variable is not set, or is empty, so the CLI does not run in Quay.
    Outside,
}

fn main() -> ExitCode {
    let var = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
        return ExitCode::FAILURE;
    };
    let route = match var("QUAY_MCP_URL").zip(var("QUAY_A2A_TOKEN")) {
        None => Route::Outside,
        Some((url, token)) => Quay::new(&url, &token).map_or_else(Route::Refused, Route::Quay),
    };
    runtime.block_on(serve(route))
}

/// Serves the CLI until its end of stdin or stdout closes.
async fn serve(route: Route) -> ExitCode {
    let mut lines = stdio::read_lines();
    let (out, written) = stdio::write_lines();
    let calls = OpenCalls::default();
    loop {
        tokio::select! {
            line = lines.recv() => match line {
                Some(line) => take(line, &route, &calls, &out).await,
                None => break,
            },
            () = out.closed() => return ExitCode::FAILURE,
        }
    }
    calls.close();
    drop(out);
    written.finish().await;
    ExitCode::SUCCESS
}

/// Takes one line from the CLI: answers it here, or sets it on its way to Quay.
async fn take(line: Line, route: &Route, calls: &OpenCalls, out: &Out) {
    let (message, line) = match line {
        Line::Message(line) => (Message::parse(&line), Some(line)),
        Line::TooLong(message) => (message, None),
    };
    let Message { id, method } = match message {
        Ok(message) => message,
        Err(Unreadable::NotJson) => return out.send(rpc::error(None, rpc::PARSE_ERROR, "Parse error")).await,
        Err(Unreadable::NotRequest) => return out.send(rpc::error(None, rpc::INVALID_REQUEST, "Invalid request")).await,
    };
    // A notification gets no reply, a refusal included
    let refuse = async |code: i32, why: &str| {
        if let Some(id) = &id {
            out.send(rpc::error(Some(id), code, why)).await;
        }
    };
    let Some(line) = line else {
        return refuse(rpc::INVALID_REQUEST, REQUEST_TOO_LONG).await;
    };
    match route {
        Route::Outside => {
            if let Some(id) = &id {
                out.send(outside::answer(id, &method, &line)).await;
            }
        }
        Route::Refused(why) => refuse(rpc::RELAY_FAILED, why).await,
        Route::Quay(quay) => {
            if id.is_none() && method == "notifications/cancelled" {
                if let Some(cancelled) = rpc::cancelled_id(&line) {
                    calls.cancel(&cancelled);
                }
                return;
            }
            // A CLI takes this code as the sign to start with `initialize` instead. Quay's own sign,
            // a 400 with an empty body, has no form on stdio
            let failed = if method == "server/discover" { rpc::METHOD_NOT_FOUND } else { rpc::RELAY_FAILED };
            if !calls.start(id.clone(), forward(quay.clone(), id.clone(), failed, line.into(), out.clone())) {
                refuse(rpc::RELAY_FAILED, TOO_MANY).await;
            }
        }
    }
}

/// Posts the message `line` to Quay. If it is request `id`, writes Quay's reply, or an error
/// with the code `failed` when there is none. Whatever comes back for a notification is dropped.
async fn forward(quay: Quay, id: Option<Id>, failed: i32, line: Bytes, out: Out) {
    let answer = quay.post(line).await;
    let Some(id) = id else { return };
    let reply = answer
        .and_then(|body| rpc::reply_line(&id, &body).ok_or_else(|| NO_REPLY.to_string()))
        .unwrap_or_else(|why| rpc::error(Some(&id), failed, &why));
    out.send(reply).await;
}
