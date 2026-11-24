use std::io::{BufRead, Write};

use hyper::body::Bytes;
use tokio::sync::mpsc::{Receiver, Sender, channel};
use tokio::sync::oneshot;

pub fn read_lines() -> Receiver<Vec<u8>> {
    let (sender, lines) = channel(1);
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().split(b'\n') {
            let Ok(line) = line else { break };
            if sender.blocking_send(line).is_err() {
                break;
            }
        }
    });
    lines
}

pub fn write_lines() -> (Sender<Bytes>, oneshot::Receiver<()>) {
    let (sender, mut lines) = channel::<Bytes>(1);
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
    (sender, written)
}
