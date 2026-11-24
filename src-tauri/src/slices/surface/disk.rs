//! This computer's disks, for judging a path an agent wrote. What is on the network is told from the
//! operating system's own tables, which hold what is mounted and need no access to it:
//!
//! - **Windows:** the device a drive letter names (`QueryDosDeviceW`) and its type (`GetDriveTypeW`).
//!   A letter that `subst` made is followed to the path it names.
//! - **Linux:** `/proc/self/mountinfo`. A path is local when the mount it is on has one of the file
//!   systems in `LINUX_LOCAL`. Of the FUSE ones only `fuseblk`, which is on a block device, is there:
//!   `fuse` and `fuse.*` may be remote.
//! - **macOS:** what `/sbin/mount` prints. A path is local when the mount it is on carries the
//!   system's own `local` flag.
//!
//! Where Windows cannot tell a drive's type, where the table of mounts cannot be read or names a file
//! system Quay does not know, and on any other system, nothing is local and the path is refused. A
//! drive a program on this computer keeps up, and a folder a sync client fills, are local to the system
//! and so to Quay.

use std::io;
use std::path::Path;

use super::local_path::{Disk, Location};

/// The disks of the computer Quay runs on, as they are now.
pub struct ThisComputer {
    #[cfg(not(windows))]
    mounts: Vec<Mount>,
}

impl ThisComputer {
    pub fn now() -> Self {
        Self {
            #[cfg(not(windows))]
            mounts: mounts(),
        }
    }
}

impl Disk for ThisComputer {
    #[cfg(windows)]
    fn location(&self, path: &str) -> Location {
        match path.as_bytes() {
            [letter, b':', ..] => windows::drive_location(char::from(*letter), windows::device_of, windows::drive_type_of),
            _ => Location::NotLocal,
        }
    }

    #[cfg(not(windows))]
    fn location(&self, path: &str) -> Location {
        if is_on_local_mount(path, &self.mounts) { Location::Local } else { Location::NotLocal }
    }

    fn link(&self, path: &str) -> io::Result<Option<String>> {
        let path = Path::new(path);
        // True of a junction as well. A link of another kind cannot be read, which is an error.
        if !std::fs::symlink_metadata(path)?.file_type().is_symlink() {
            return Ok(None);
        }
        match std::fs::read_link(path)?.into_os_string().into_string() {
            Ok(target) => Ok(Some(target)),
            Err(_) => Err(io::ErrorKind::InvalidData.into()),
        }
    }
}

/// Where a drive letter leads, by the device it names and the type of that.
#[cfg(any(windows, test))]
pub(super) mod drives {
    use super::Location;

    /// `GetDriveTypeW`'s answers for a drive that is there and not on the network.
    const REMOVABLE: u32 = 2;
    const FIXED: u32 = 3;
    const CD_ROM: u32 = 5;
    const RAM_DISK: u32 = 6;
    /// Its answer for a drive that is not there.
    const NO_ROOT: u32 = 1;

    /// The devices that are doors to another computer, in lower case.
    const REDIRECTORS: [&str; 9] = [
        r"\device\mup",
        r"\device\lanmanredirector",
        r"\device\webdavredirector",
        r"\device\rdpdr",
        r"\device\windfs",
        r"\device\netwareredirector",
        r"\device\hgfs",
        r"\device\vboxminirdr",
        r"\device\p9rdr",
    ];

    /// Where the drive `letter` is. Its type is asked for only once its device is no door to another
    /// computer.
    pub fn drive_location(letter: char, device_of: impl Fn(char) -> Option<String>, type_of: impl Fn(char) -> u32) -> Location {
        let Some(device) = device_of(letter) else {
            return Location::Missing;
        };
        // What `subst` made names a path, in the system's own spelling
        if let Some(path) = device.strip_prefix(r"\??\") {
            return Location::NamedFor(format!(r"\\?\{path}"));
        }
        let device = device.to_lowercase();
        if device.contains(r"\;") || REDIRECTORS.iter().any(|door| device.starts_with(door)) {
            return Location::NotLocal;
        }
        match type_of(letter) {
            REMOVABLE | FIXED | CD_ROM | RAM_DISK => Location::Local,
            NO_ROOT => Location::Missing,
            _ => Location::NotLocal,
        }
    }
}

#[cfg(windows)]
mod windows {
    pub use super::drives::drive_location;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn QueryDosDeviceW(device_name: *const u16, target_path: *mut u16, max_chars: u32) -> u32;
        fn GetDriveTypeW(root_path_name: *const u16) -> u32;
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// The device `letter` names now, or `None` when it names none.
    pub fn device_of(letter: char) -> Option<String> {
        let name = wide(&format!("{letter}:"));
        let mut target = [0u16; 2048];
        // SAFETY: `name` is NUL-terminated, and `target` is a writable buffer of the length passed.
        let length = unsafe { QueryDosDeviceW(name.as_ptr(), target.as_mut_ptr(), target.len() as u32) } as usize;
        // The first of a list is the one in force
        let first = target.get(..length)?.split(|unit| *unit == 0).next()?;
        (!first.is_empty()).then(|| String::from_utf16_lossy(first))
    }

    pub fn drive_type_of(letter: char) -> u32 {
        let root = wide(&format!(r"{letter}:\"));
        // SAFETY: `root` is NUL-terminated.
        unsafe { GetDriveTypeW(root.as_ptr()) }
    }
}

/// A folder something is mounted on, and whether that is a disk of this computer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Mount {
    pub point: String,
    pub local: bool,
}

/// Whether the mount `path` is on is local. A later mount hides an earlier one at the same place.
#[cfg(any(not(windows), test))]
pub(super) fn is_on_local_mount(path: &str, mounts: &[Mount]) -> bool {
    let holds = |point: &str| {
        let point = point.trim_end_matches('/');
        path.strip_prefix(point).is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
    };
    mounts
        .iter()
        .filter(|mount| holds(&mount.point))
        .max_by_key(|mount| mount.point.trim_end_matches('/').len())
        .is_some_and(|mount| mount.local)
}

/// The file systems that are on a disk, or in the memory, of this computer.
#[cfg(any(target_os = "linux", test))]
const LINUX_LOCAL: [&str; 25] = [
    "bcachefs", "btrfs", "devtmpfs", "ecryptfs", "erofs", "exfat", "ext2", "ext3", "ext4", "f2fs", "fuseblk", "hfsplus", "iso9660",
    "jfs", "ntfs", "ntfs3", "overlay", "ramfs", "reiserfs", "squashfs", "tmpfs", "udf", "vfat", "xfs", "zfs",
];

/// The mounts `/proc/self/mountinfo` lists.
#[cfg(any(target_os = "linux", test))]
pub(super) fn linux_mounts(mountinfo: &str) -> Vec<Mount> {
    mountinfo
        .lines()
        .filter_map(|line| {
            // 36 35 98:0 /root /mnt/point options [optional fields] - type source options
            let (mount, file_system) = line.split_once(" - ")?;
            let point = mount.split(' ').nth(4)?;
            let kind = file_system.split(' ').next()?;
            Some(Mount { point: unescaped(point), local: LINUX_LOCAL.contains(&kind) })
        })
        .collect()
}

/// A mount point as the kernel lists it, with a space, tab, line break or backslash as its octal.
#[cfg(any(target_os = "linux", test))]
fn unescaped(point: &str) -> String {
    point.replace(r"\040", " ").replace(r"\011", "\t").replace(r"\012", "\n").replace(r"\134", r"\")
}

/// The mounts macOS's `mount` prints.
#[cfg(any(target_os = "macos", test))]
pub(super) fn macos_mounts(printed: &str) -> Vec<Mount> {
    printed
        .lines()
        .filter_map(|line| {
            // /dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
            let (line, flags) = line.strip_suffix(')')?.rsplit_once(" (")?;
            let (_, point) = line.split_once(" on ")?;
            Some(Mount { point: point.to_string(), local: flags.split(", ").any(|flag| flag == "local") })
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn mounts() -> Vec<Mount> {
    linux_mounts(&std::fs::read_to_string("/proc/self/mountinfo").unwrap_or_default())
}

#[cfg(target_os = "macos")]
fn mounts() -> Vec<Mount> {
    let printed = crate::spawn::hidden_command("/sbin/mount").output();
    printed.map(|output| macos_mounts(&String::from_utf8_lossy(&output.stdout))).unwrap_or_default()
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn mounts() -> Vec<Mount> {
    Vec::new()
}
