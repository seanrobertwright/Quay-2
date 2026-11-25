//! A configuration file that belongs to another program: read once, and replaced only while it
//! still holds what was read.

use std::fs::File;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

use crate::atomic_file::create_private;

/// The most of a file that is read. A larger one is refused.
const MAX_BYTES: u64 = 4 * 1024 * 1024;

const CHANGED: &str = "it changed while Quay was writing, so try again";

/// A configuration file as it was read.
pub struct ConfigFile {
    /// The file itself, past any link to it.
    path: PathBuf,
    /// What it held, or `None` when there was no file.
    bytes: Option<Vec<u8>>,
}

impl ConfigFile {
    /// Reads the file at `path`, or why it can't be read.
    pub fn read(path: &Path) -> Result<Self, String> {
        let path = past_links(path)?;
        let bytes = bytes_of(&path)?;
        Ok(Self { path, bytes })
    }

    /// What the file held, or `None` when there was no file.
    pub fn text(&self) -> Result<Option<&str>, String> {
        let Some(bytes) = &self.bytes else { return Ok(None) };
        std::str::from_utf8(bytes).map(Some).map_err(|_| "it is not UTF-8 text".to_string())
    }

    /// Replaces the file with `text`, or creates it. The bytes go to a uniquely named temporary
    /// file in the same folder, which has the file's permissions and is renamed over it. A file
    /// that no longer holds what was read is left as it is: that is checked last before the rename,
    /// and no lock is held between the two. On failure the temporary file is removed.
    pub fn replace(&self, text: &str) -> Result<(), String> {
        let (Some(folder), Some(name)) = (self.path.parent(), self.path.file_name()) else {
            return Err("its path names no file".to_string());
        };
        if self.bytes.is_none() {
            std::fs::create_dir_all(folder).map_err(|e| format!("its folder can't be created: {e}"))?;
        } else if std::fs::metadata(&self.path).is_ok_and(|file| file.permissions().readonly()) {
            return Err("it is read-only".to_string());
        }
        let unique = uuid::Uuid::new_v4().simple();
        let temporary = folder.join(format!("{}.quay-{unique}.tmp", name.to_string_lossy()));
        let written = self.write_through(&temporary, text);
        if written.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        written
    }

    fn write_through(&self, temporary: &Path, text: &str) -> Result<(), String> {
        let failed = |e: std::io::Error| format!("it can't be written: {e}");
        let mut file = create_private(temporary).map_err(failed)?;
        // Before there is anything in it to read
        if self.bytes.is_some() {
            copy_permissions(&self.path, temporary).map_err(failed)?;
        }
        file.write_all(text.as_bytes()).map_err(failed)?;
        file.sync_all().map_err(failed)?;
        drop(file);
        if bytes_of(&self.path)? != self.bytes {
            return Err(CHANGED.to_string());
        }
        std::fs::rename(temporary, &self.path).map_err(failed)
    }
}

/// `path`, or the file it leads to when it is a link.
fn past_links(path: &Path) -> Result<PathBuf, String> {
    match std::fs::symlink_metadata(path) {
        Ok(found) if found.file_type().is_symlink() => {
            path.canonicalize().map_err(|e| format!("the link to it can't be followed: {e}"))
        }
        Err(e) if e.kind() != ErrorKind::NotFound => Err(format!("it can't be read: {e}")),
        _ => Ok(path.to_path_buf()),
    }
}

fn bytes_of(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let failed = |e: std::io::Error| format!("it can't be read: {e}");
    let file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(failed(e)),
    };
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(failed)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("it is over 4 MB".to_string());
    }
    Ok(Some(bytes))
}

#[cfg(not(windows))]
fn copy_permissions(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::set_permissions(to, std::fs::metadata(from)?.permissions())
}

/// Gives `to` the access list of `from`, as it is.
#[cfg(windows)]
fn copy_permissions(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Security::{DACL_SECURITY_INFORMATION, GetFileSecurityW, SetFileSecurityW};

    let wide = |path: &Path| path.as_os_str().encode_wide().chain([0]).collect::<Vec<u16>>();
    let (from, to) = (wide(from), wide(to));
    let mut needed = 0;
    // SAFETY: the path ends in a zero, and an empty buffer is passed with its size, to be told the
    // size it has to have.
    unsafe { GetFileSecurityW(from.as_ptr(), DACL_SECURITY_INFORMATION, std::ptr::null_mut(), 0, &mut needed) };
    // A security descriptor has to be aligned as a pointer is
    let mut descriptor = vec![0usize; (needed as usize).div_ceil(size_of::<usize>())];
    if descriptor.is_empty() {
        return Err(std::io::Error::last_os_error());
    }
    let buffer = descriptor.as_mut_ptr().cast();
    // SAFETY: the paths end in a zero, and `buffer` has the `needed` bytes it is said to have.
    let copied = unsafe {
        GetFileSecurityW(from.as_ptr(), DACL_SECURITY_INFORMATION, buffer, needed, &mut needed) != 0
            && SetFileSecurityW(to.as_ptr(), DACL_SECURITY_INFORMATION, buffer) != 0
    };
    if copied { Ok(()) } else { Err(std::io::Error::last_os_error()) }
}
