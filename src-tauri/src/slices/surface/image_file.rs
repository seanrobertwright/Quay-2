//! The bytes of an image file: which kinds and sizes are read, and for how long.

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;
use std::time::{Duration, Instant};

use tokio::sync::Semaphore;

use super::local_path::Refused;

/// The most bytes of an image.
pub const MOST_BYTES: u64 = 10 * 1024 * 1024;

/// How many of a file's first bytes tell its kind.
const HEAD: u64 = 12;

/// How many bytes are read before it is seen whether the time is over.
const CHUNK: u64 = 64 * 1024;

/// The most images that are read at once.
const MOST_READS: usize = 4;

/// Why a file's bytes are not given.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotRead {
    /// Its path leads to none.
    Refused(Refused),
    /// It is a folder, or anything else that is no file.
    NotAFile,
    /// It is more than `MOST_BYTES`.
    TooLarge,
    /// It is of no kind that is shown.
    OtherKind,
    /// The file system would not give it.
    Unreadable,
    /// It took longer than it may.
    TooSlow,
}

impl From<Refused> for NotRead {
    fn from(refused: Refused) -> Self {
        Self::Refused(refused)
    }
}

impl From<io::Error> for NotRead {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Self::Refused(Refused::Missing),
            _ => Self::Unreadable,
        }
    }
}

/// Whether a file whose first `HEAD` bytes are `head` is a PNG, JPEG, GIF or WebP image.
fn is_shown(head: &[u8]) -> bool {
    let webp = head.starts_with(b"RIFF") && head.get(8..) == Some(b"WEBP".as_slice());
    webp || [b"\x89PNG\r\n\x1a\n".as_slice(), b"\xff\xd8\xff", b"GIF87a", b"GIF89a"].iter().any(|start| head.starts_with(start))
}

/// The bytes of the image at `path`, which no link is on the way to, by `deadline`.
pub fn read_file(path: &Path, deadline: Instant) -> Result<Vec<u8>, NotRead> {
    // Before it is opened: opening a pipe waits for its other end
    if !std::fs::symlink_metadata(path)?.is_file() {
        return Err(NotRead::NotAFile);
    }
    let file = File::open(path)?;
    let opened = file.metadata()?;
    if !opened.is_file() {
        return Err(NotRead::NotAFile);
    }
    read_all(file, opened.len(), deadline)
}

/// The bytes of an image that is said to have `size` of them. No more is read than it takes to refuse
/// it, and after `deadline` nothing past its head.
pub fn read_all(mut source: impl Read, size: u64, deadline: Instant) -> Result<Vec<u8>, NotRead> {
    if size > MOST_BYTES {
        return Err(NotRead::TooLarge);
    }
    // What it is said to have may have changed since
    let mut source = source.by_ref().take(MOST_BYTES + 1);
    let mut bytes = Vec::with_capacity(size as usize);
    source.by_ref().take(HEAD).read_to_end(&mut bytes)?;
    if !is_shown(&bytes) {
        return Err(NotRead::OtherKind);
    }
    loop {
        if Instant::now() >= deadline {
            return Err(NotRead::TooSlow);
        }
        if source.by_ref().take(CHUNK).read_to_end(&mut bytes)? == 0 {
            break;
        }
    }
    if bytes.len() as u64 > MOST_BYTES {
        return Err(NotRead::TooLarge);
    }
    Ok(bytes)
}

/// Runs `read` on a thread it may block, with when its time is over, and gives it up after `limit`. The
/// time it waits for one of the `MOST_READS` counts. A read that does not come back keeps its place, so
/// a disk that answers nothing holds no more threads than that.
pub async fn reading(
    limit: Duration,
    read: impl FnOnce(Instant) -> Result<Vec<u8>, NotRead> + Send + 'static,
) -> Result<Vec<u8>, NotRead> {
    static READS: Semaphore = Semaphore::const_new(MOST_READS);
    let deadline = Instant::now() + limit;
    let run = async {
        let place = READS.acquire().await.map_err(|_| NotRead::Unreadable)?;
        let read = tokio::task::spawn_blocking(move || {
            let _place = place;
            read(deadline)
        });
        read.await.map_err(|_| NotRead::Unreadable)?
    };
    tokio::time::timeout(limit, run).await.unwrap_or(Err(NotRead::TooSlow))
}
