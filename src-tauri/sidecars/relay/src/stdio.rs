//! The relay's end of the CLI: one message a line, in on stdin and out on stdout.

use std::io::{BufRead, Read, Write};
use std::time::Duration;

use hyper::body::Bytes;
use tokio::sync::mpsc::{Receiver, Sender, channel};
use tokio::sync::oneshot;
use tokio::time::timeout;

use crate::rpc::{Message, Unreadable};

/// The most bytes a request may have: what Quay's `/mcp` takes.
const MAX_REQUEST: usize = 2 * 1024 * 1024;

/// How far into a line over `MAX_REQUEST` the relay looks for its `id`.
const MAX_SCAN: u64 = 16 * 1024 * 1024;

/// How many replies may wait for the CLI to read its end of stdout.
const QUEUED: usize = 16;

/// How long what is already queued for stdout gets to go out once stdin has closed.
const FLUSH_LIMIT: Duration = Duration::from_secs(1);

/// One line of stdin, without its line end.
pub enum Line {
    Message(Vec<u8>),
    /// A line over `MAX_REQUEST`, of which only its `id` and `method` are kept.
    TooLong(Result<Message, Unreadable>),
}

/// Reads stdin on a thread of its own, ahead of whoever takes the lines by as little as it
/// can. The channel closes when stdin does.
pub fn read_lines() -> Receiver<Line> {
    let (sender, lines) = channel(1);
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin().lock();
        while let Ok(Some(line)) = read_line(&mut stdin) {
            if sender.blocking_send(line).is_err() {
                break;
            }
        }
    });
    lines
}

/// The next line of `input` that is not empty, or `None` at its end. It never holds more of
/// the line than `MAX_REQUEST` and a line end.
fn read_line(input: &mut impl BufRead) -> std::io::Result<Option<Line>> {
    loop {
        let mut line = Vec::new();
        input.by_ref().take(MAX_REQUEST as u64 + 2).read_until(b'\n', &mut line)?;
        if line.is_empty() {
            return Ok(None);
        }
        let ended = line.pop_if(|last| *last == b'\n').is_some();
        line.pop_if(|last| *last == b'\r');
        if line.len() > MAX_REQUEST {
            let mut rest = RestOfLine { input, ended };
            let message = Message::scan(line.as_slice().chain(&mut rest).take(MAX_SCAN));
            std::io::copy(&mut rest, &mut std::io::sink())?;
            return Ok(Some(Line::TooLong(message)));
        }
        if !line.is_empty() {
            return Ok(Some(Line::Message(line)));
        }
    }
}

/// What is left of a line, up to its newline, which it takes and leaves out.
struct RestOfLine<'a, R> {
    input: &'a mut R,
    ended: bool,
}

impl<R: BufRead> Read for RestOfLine<'_, R> {
    fn read(&mut self, into: &mut [u8]) -> std::io::Result<usize> {
        if self.ended || into.is_empty() {
            return Ok(0);
        }
        let buffered = self.input.fill_buf()?;
        let buffered = &buffered[..buffered.len().min(into.len())];
        let newline = buffered.iter().position(|byte| *byte == b'\n');
        let read = newline.unwrap_or(buffered.len());
        into[..read].copy_from_slice(&buffered[..read]);
        self.ended = newline.is_some() || buffered.is_empty();
        self.input.consume(read + usize::from(newline.is_some()));
        Ok(read)
    }
}

/// Where the replies go. A thread of its own writes them to stdout, one a line.
#[derive(Clone)]
pub struct Out(Sender<Bytes>);

impl Out {
    /// Queues `line`, which must hold no line break.
    pub async fn send(&self, line: Bytes) {
        // A send fails only when stdout has closed, which ends the relay
        let _ = self.0.send(line).await;
    }

    /// Waits until stdout has closed.
    pub async fn closed(&self) {
        self.0.closed().await;
    }
}

/// Told when every `Out` is gone and what they queued is written.
pub struct Written(oneshot::Receiver<()>);

impl Written {
    /// Waits for that, up to `FLUSH_LIMIT`.
    pub async fn finish(self) {
        let _ = timeout(FLUSH_LIMIT, self.0).await;
    }
}

pub fn write_lines() -> (Out, Written) {
    let (sender, mut lines) = channel::<Bytes>(QUEUED);
    let (done, written) = oneshot::channel();
    std::thread::spawn(move || {
        let mut out = std::io::stdout().lock();
        while let Some(line) = lines.blocking_recv() {
            if out.write_all(&line).and_then(|()| out.write_all(b"\n")).and_then(|()| out.flush()).is_err() {
                break;
            }
        }
        let _ = done.send(());
    });
    (Out(sender), Written(written))
}
