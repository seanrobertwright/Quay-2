//! How much of an image file is read and for how long, on files that a disk gives slowly, without end or
//! not at all.

use std::io::{self, Read};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use super::image_file::{read_all, reading, NotRead, MOST_BYTES};

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

/// A file that gives `content` and then `rest` without end, and counts what was read of it.
struct Endless<'a> {
    content: &'a [u8],
    read: &'a AtomicUsize,
    /// How long each read takes.
    slow: Duration,
}

impl Read for Endless<'_> {
    fn read(&mut self, into: &mut [u8]) -> io::Result<usize> {
        std::thread::sleep(self.slow);
        let length = if self.content.is_empty() {
            into.fill(7);
            into.len()
        } else {
            self.content.read(into)?
        };
        self.read.fetch_add(length, Ordering::SeqCst);
        Ok(length)
    }
}

/// What reading an endless file comes to, and how much of it was read.
fn read_endless(content: &[u8], size: u64, slow: Duration, limit: Duration) -> (Result<usize, NotRead>, usize) {
    let read = AtomicUsize::new(0);
    let result = read_all(Endless { content, read: &read, slow }, size, Instant::now() + limit);
    (result.map(|bytes| bytes.len()), read.load(Ordering::SeqCst))
}

const LONG: Duration = Duration::from_secs(60);

#[test]
fn a_file_that_grows_while_it_is_read_is_read_no_further_than_the_limit() {
    let (result, read) = read_endless(PNG, 100, Duration::ZERO, LONG);
    assert_eq!(result, Err(NotRead::TooLarge));
    assert!(read as u64 > MOST_BYTES && read as u64 <= MOST_BYTES + 1, "{read} bytes");
}

#[test]
fn a_file_that_is_too_large_or_of_another_kind_is_refused_before_the_rest_of_it_is_read() {
    assert_eq!(read_endless(PNG, MOST_BYTES + 1, Duration::ZERO, LONG), (Err(NotRead::TooLarge), 0));
    assert_eq!(read_endless(PNG, u64::MAX, Duration::ZERO, LONG), (Err(NotRead::TooLarge), 0));
    let (result, read) = read_endless(b"<svg xmlns='http://www.w3.org/2000/svg'>", 100, Duration::ZERO, LONG);
    assert_eq!(result, Err(NotRead::OtherKind));
    assert!(read <= 12, "{read} bytes");
}

#[test]
fn a_file_that_comes_slowly_is_given_up_once_its_time_is_over() {
    let started = Instant::now();
    let (result, read) = read_endless(PNG, 100, Duration::from_millis(50), Duration::from_millis(200));
    assert_eq!(result, Err(NotRead::TooSlow));
    assert!(started.elapsed() < Duration::from_secs(5) && (read as u64) < MOST_BYTES, "{read} bytes");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_read_that_never_returns_is_given_up_once_its_time_is_over() {
    let (release, held) = std::sync::mpsc::channel::<()>();
    let started = Instant::now();
    let result = reading(Duration::from_millis(100), move |_| {
        let _ = held.recv();
        Ok(Vec::new())
    });
    assert_eq!(result.await, Err(NotRead::TooSlow));
    assert!(started.elapsed() < Duration::from_secs(5));
    drop(release);
}

#[tokio::test(flavor = "multi_thread")]
async fn at_most_four_reads_run_at_once_and_one_that_waits_has_the_same_time() {
    let running = std::sync::Arc::new(AtomicUsize::new(0));
    let most = std::sync::Arc::new(AtomicUsize::new(0));
    let mut tasks = Vec::new();
    for _ in 0..12 {
        let (running, most) = (running.clone(), most.clone());
        tasks.push(tokio::spawn(reading(Duration::from_secs(30), move |_| {
            most.fetch_max(running.fetch_add(1, Ordering::SeqCst) + 1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(30));
            running.fetch_sub(1, Ordering::SeqCst);
            Ok(vec![1])
        })));
    }
    for task in tasks {
        assert_eq!(task.await.unwrap(), Ok(vec![1]));
    }
    assert!(most.load(Ordering::SeqCst) <= 4);
}
