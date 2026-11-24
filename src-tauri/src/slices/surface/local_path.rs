//! Where a path an agent wrote leads, and whether Quay may touch it. A path on the network is refused
//! before anything on it is touched: touching one connects to its host, which can hand it the
//! operator's credentials.

use std::collections::VecDeque;
use std::io;

/// The most bytes a path may have.
const MOST_BYTES: usize = 4096;

/// The most links a path may lead through, so a circle of them ends.
const MOST_LINKS: usize = 40;

/// What separates names on Windows, and what starts a network path anywhere.
const SEPARATORS: [char; 2] = ['/', '\\'];

/// Which platform's paths.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Style {
    Windows,
    Unix,
}

/// Where a disk says a path on it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Location {
    /// On a disk of this computer.
    Local,
    /// On the network, or Quay cannot tell.
    NotLocal,
    /// There is no such drive.
    Missing,
    /// A name for this other path, as a drive that `subst` made is.
    NamedFor(String),
}

/// The file system, as far as judging a path needs it.
pub trait Disk {
    /// Where a drive's root, or on Unix any path, is. It asks the operating system's own tables and
    /// touches nothing at `path`.
    fn location(&self, path: &str) -> Location;

    /// What a link at `path` leads to, without following it; `None` when it is no link. Nothing on
    /// the way to `path` is a link.
    fn link(&self, path: &str) -> io::Result<Option<String>>;
}

/// Why a path is not opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refused {
    /// It is on the network or is a device, leads to one, or Quay cannot tell. Also for a relative path
    /// when the folder it is read in is no path on this computer.
    NotLocal,
    /// It is not written as a path.
    NotAPath,
    /// Nothing is there.
    Missing,
    /// The file system would not say what is there.
    Unreadable,
}

/// A file an agent named, and the line it named in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Named {
    pub path: String,
    pub line: Option<u32>,
}

/// `written` without the `:line` or `:line:column` it may end in.
pub fn named(written: &str) -> Named {
    let written = written.trim();
    let Some((rest, last)) = split_number(written) else {
        return Named { path: written.to_string(), line: None };
    };
    let (path, line) = split_number(rest).unwrap_or((rest, last));
    Named { path: path.to_string(), line: Some(line) }
}

/// What is before and after the last colon of `text`, when a number is after it and more than a
/// drive's letter before it.
fn split_number(text: &str) -> Option<(&str, u32)> {
    let (rest, number) = text.rsplit_once(':')?;
    if rest.is_empty() || is_drive_letter(rest) || !number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((rest, number.parse().ok()?))
}

fn is_drive_letter(text: &str) -> bool {
    text.len() == 1 && text.as_bytes()[0].is_ascii_alphabetic()
}

/// `path`'s drive, such as `C:`, and what follows it.
fn split_drive(path: &str) -> Option<(&str, &str)> {
    let (drive, rest) = path.split_at_checked(2)?;
    drive.strip_suffix(':').is_some_and(is_drive_letter).then_some((drive, rest))
}

/// A path with its names apart.
enum Parsed {
    /// Under `root`: a drive's `C:\`, or `/`.
    Absolute { root: String, names: Vec<String> },
    /// On the drive of the folder it is read in, as `\x` is on Windows.
    Rooted(Vec<String>),
    /// In the folder it is read in.
    Relative(Vec<String>),
}

/// Where `written` leads, read in the folder `cwd`: a path with no link, no `.` and no `..` in it,
/// on this computer. Every part of it is judged before it is touched, and nothing past a part that
/// is refused is touched. It is judged as the disk is now: a folder replaced by a link after that is
/// not seen.
pub fn resolve(written: &str, cwd: &str, style: Style, disk: &impl Disk) -> Result<String, Refused> {
    let (root, names) = read_in(parse(written, style)?, cwd, style)?;
    walk(root, names, style, disk)
}

/// The root and names of `parsed`, read in the folder `cwd`.
fn read_in(parsed: Parsed, cwd: &str, style: Style) -> Result<(String, Vec<String>), Refused> {
    let folder = || match parse_absolute(cwd, style) {
        Some(Ok(Parsed::Absolute { root, names })) => Ok((root, names)),
        _ => Err(Refused::NotLocal),
    };
    let (root, names) = match parsed {
        Parsed::Absolute { root, names } => (root, names),
        Parsed::Rooted(names) => (folder()?.0, names),
        Parsed::Relative(names) => {
            let (root, folder) = folder()?;
            (root, [folder, names].concat())
        }
    };
    Ok((root, collapse(names, style)))
}

/// `names` without `..`, where the platform reads that before it follows a link.
fn collapse(names: Vec<String>, style: Style) -> Vec<String> {
    if style == Style::Unix {
        return names;
    }
    let mut kept = Vec::new();
    for name in names {
        if name == ".." {
            kept.pop();
        } else {
            kept.push(name);
        }
    }
    kept
}

/// Follows the links among `names` one at a time, from `root`.
fn walk(root: String, names: Vec<String>, style: Style, disk: &impl Disk) -> Result<String, Refused> {
    let mut root = root;
    let mut pending = VecDeque::from(names);
    let mut done: Vec<String> = Vec::new();
    let mut hops = 0;
    let mut elsewhere = settle(&root, disk)?;
    loop {
        if let Some(target) = elsewhere.take() {
            hops += 1;
            if hops > MOST_LINKS {
                return Err(Refused::Unreadable);
            }
            let folder = join(&root, &done, style);
            let (to, names) = read_in(parse_target(&target, style)?, &folder, style)?;
            pending = names.into_iter().chain(pending).collect();
            done.clear();
            root = to;
            elsewhere = settle(&root, disk)?;
            continue;
        }
        let Some(name) = pending.pop_front() else {
            return Ok(join(&root, &done, style));
        };
        if name == ".." {
            done.pop();
            continue;
        }
        done.push(name);
        let path = join(&root, &done, style);
        if style == Style::Unix {
            settle(&path, disk)?;
        }
        elsewhere = disk.link(&path).map_err(|error| match error.kind() {
            io::ErrorKind::NotFound | io::ErrorKind::NotADirectory => Refused::Missing,
            _ => Refused::Unreadable,
        })?;
        if elsewhere.is_some() {
            // A link's target is read in the folder the link is in
            done.pop();
        }
    }
}

/// Judges where `path` is, before it is touched. What it is only a name for is given back.
fn settle(path: &str, disk: &impl Disk) -> Result<Option<String>, Refused> {
    match disk.location(path) {
        Location::Local => Ok(None),
        Location::NotLocal => Err(Refused::NotLocal),
        Location::Missing => Err(Refused::Missing),
        Location::NamedFor(target) => Ok(Some(target)),
    }
}

fn join(root: &str, names: &[String], style: Style) -> String {
    format!("{root}{}", names.join(if style == Style::Windows { r"\" } else { "/" }))
}

/// A path as an agent wrote it.
fn parse(written: &str, style: Style) -> Result<Parsed, Refused> {
    let written = written.trim();
    if written.is_empty() || written.len() > MOST_BYTES {
        return Err(Refused::NotAPath);
    }
    if written.get(..7).is_some_and(|scheme| scheme.eq_ignore_ascii_case("file://")) {
        return parse_file_address(&written[7..], style);
    }
    parse_path(written, style)
}

/// What follows `file://`: a host, which makes it a network path, or a slash and a path.
fn parse_file_address(rest: &str, style: Style) -> Result<Parsed, Refused> {
    if !rest.starts_with('/') {
        return Err(Refused::NotLocal);
    }
    let path = percent_decoded(rest).ok_or(Refused::NotAPath)?;
    if is_doubled(&path) {
        return Err(Refused::NotLocal);
    }
    let path = if style == Style::Windows { &path[1..] } else { path.as_str() };
    match parse_absolute(path, style) {
        Some(parsed) => parsed,
        None => Err(Refused::NotAPath),
    }
}

/// `text` with its percent escapes read, or `None` when they do not spell text.
fn percent_decoded(text: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(text.len());
    let mut rest = text.bytes();
    while let Some(byte) = rest.next() {
        if byte != b'%' {
            bytes.push(byte);
            continue;
        }
        let high = char::from(rest.next()?).to_digit(16)?;
        let low = char::from(rest.next()?).to_digit(16)?;
        bytes.push(u8::try_from(high * 16 + low).ok()?);
    }
    String::from_utf8(bytes).ok()
}

/// Whether `path` starts with two separators, as a network path and a device path do.
fn is_doubled(path: &str) -> bool {
    path.starts_with(SEPARATORS) && path[1..].starts_with(SEPARATORS)
}

/// A link's target. The system spells a link to a drive's folder `\\?\C:\x`.
fn parse_target(target: &str, style: Style) -> Result<Parsed, Refused> {
    match parse_absolute(target, style) {
        Some(parsed) => parsed,
        None => parse_path(target, style),
    }
}

/// `path` when it is absolute on a drive, in the system's own spelling too, or on Unix.
fn parse_absolute(path: &str, style: Style) -> Option<Result<Parsed, Refused>> {
    if style == Style::Unix {
        return (path.starts_with('/') && !is_doubled(path)).then(|| parse_path(path, style));
    }
    let path = path.strip_prefix(r"\\?\").unwrap_or(path);
    split_drive(path).is_some_and(|(_, rest)| rest.starts_with(SEPARATORS)).then(|| parse_path(path, style))
}

fn parse_path(path: &str, style: Style) -> Result<Parsed, Refused> {
    if is_doubled(path) {
        return Err(Refused::NotLocal);
    }
    if path.contains('\0') {
        return Err(Refused::NotAPath);
    }
    if style == Style::Unix {
        let names = split(path, &['/']);
        return Ok(match path.starts_with('/') {
            true => Parsed::Absolute { root: "/".to_string(), names },
            false => Parsed::Relative(names),
        });
    }
    let (drive, rest) = match split_drive(path) {
        Some((drive, rest)) => (Some(drive), rest),
        None => (None, path),
    };
    // `C:x` is in whichever folder of C: this process last used
    let rooted = rest.starts_with(SEPARATORS);
    if drive.is_some() && !rooted {
        return Err(Refused::NotAPath);
    }
    let names = split(rest, &SEPARATORS);
    for name in &names {
        check_windows_name(name)?;
    }
    Ok(match drive {
        Some(drive) => Parsed::Absolute { root: format!(r"{}\", drive.to_ascii_uppercase()), names },
        None if rooted => Parsed::Rooted(names),
        None => Parsed::Relative(names),
    })
}

fn split(path: &str, separators: &[char]) -> Vec<String> {
    path.split(separators).filter(|name| !name.is_empty() && *name != ".").map(str::to_string).collect()
}

/// Refuses a name Windows reads as a device, or as another name than it is written.
fn check_windows_name(name: &str) -> Result<(), Refused> {
    let stem = name.split(['.', ':']).next().unwrap_or_default().trim_end().to_uppercase();
    let numbered = |device: &str| {
        stem.strip_prefix(device).is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "0" | "¹" | "²" | "³"))
    };
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$") || numbered("COM") || numbered("LPT") {
        return Err(Refused::NotLocal);
    }
    let odd = name.contains(['<', '>', '"', '|', '?', '*', ':']) || name.chars().any(|c| c.is_control());
    if odd || (name != ".." && name.ends_with(['.', ' '])) {
        return Err(Refused::NotAPath);
    }
    Ok(())
}
