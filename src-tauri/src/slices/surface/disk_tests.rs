//! How a network place is told from a local one: the answer for Windows, Linux and macOS, and
//! Windows's own tables and links.

use std::cell::Cell;

use super::disk::drives::drive_place;
use super::disk::{is_on_local_mount, linux_mounts, macos_mounts};
use super::local_path::Place;

#[test]
fn a_windows_drive_is_judged_by_the_device_it_names() {
    const FIXED: u32 = 3;
    const REMOTE: u32 = 4;
    for (device, drive_type, place) in [
        (Some(r"\Device\HarddiskVolume3"), FIXED, Place::Local),
        (Some(r"\Device\HarddiskVolume9"), 2, Place::Local),
        (Some(r"\Device\CdRom0"), 5, Place::Local),
        (Some(r"\Device\HarddiskVolume3"), REMOTE, Place::Network),
        (Some(r"\Device\HarddiskVolume3"), 0, Place::Network),
        (Some(r"\Device\HarddiskVolume3"), 1, Place::Missing),
        (Some(r"\Device\LanmanRedirector\;Z:0000000000012345\host\share"), FIXED, Place::Network),
        (Some(r"\Device\Mup\;WebDavRedirector\;Z:0000000000012345\host\DavWWWRoot"), FIXED, Place::Network),
        (Some(r"\Device\RdpDr\;Z:1\tsclient\c"), FIXED, Place::Network),
        (Some(r"\DEVICE\MUP\host\share"), FIXED, Place::Network),
        (Some(r"\Device\SomeVendor\;Z:\host"), FIXED, Place::Network),
        (Some(r"\??\C:\work"), FIXED, Place::NamedFor(r"\\?\C:\work".into())),
        (Some(r"\??\UNC\host\share"), FIXED, Place::NamedFor(r"\\?\UNC\host\share".into())),
        (None, FIXED, Place::Missing),
    ] {
        let asked = Cell::new(false);
        let judged = drive_place(
            'Z',
            |_| device.map(str::to_string),
            |_| {
                asked.set(true);
                drive_type
            },
        );
        assert_eq!(judged, place, "{device:?}");
        let own = device.is_some_and(|device| device.contains("HarddiskVolume") || device.contains("CdRom"));
        assert_eq!(asked.get(), own, "{device:?}: the type of a door to another computer is not asked for");
    }
}

#[test]
fn a_linux_path_is_local_by_the_file_system_it_is_mounted_from() {
    let mounts = linux_mounts(concat!(
        "22 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw\n",
        "30 22 0:26 / /tmp rw,nosuid shared:5 - tmpfs tmpfs rw\n",
        "41 22 0:44 / /mnt/nas rw,relatime shared:9 - nfs4 host:/share rw\n",
        "42 22 0:45 / /mnt/my\\040smb rw - cifs //host/share rw\n",
        "43 22 0:46 / /home/op/remote rw - fuse.sshfs op@host:/ rw\n",
        "44 22 0:47 / /net rw - autofs systemd-1 rw\n",
        "45 22 0:48 / /mnt/c rw - 9p C:\\134 rw\n",
        "46 22 0:49 / /data rw - ext4 /dev/sdb1 rw\n",
        "47 22 0:50 / /data rw - nfs host:/data rw\n",
        "nonsense\n",
    ));
    for local in ["/", "/home/op/alpha", "/tmp/x", "/mnt", "/mnt/nasty/x", "/home/op/remotely"] {
        assert!(is_on_local_mount(local, &mounts), "{local}");
    }
    for remote in ["/mnt/nas", "/mnt/nas/x", "/mnt/my smb/x", "/home/op/remote/x", "/net/host", "/mnt/c/x", "/data/x"] {
        assert!(!is_on_local_mount(remote, &mounts), "{remote}");
    }
    assert!(!is_on_local_mount("/home", &linux_mounts("")), "nothing is local where the table cannot be read");
}

#[test]
fn a_macos_path_is_local_by_its_mounts_own_flag() {
    let mounts = macos_mounts(concat!(
        "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)\n",
        "/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect)\n",
        "map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)\n",
        "/dev/disk5s1 on /Volumes/USB on desk (msdos, local, nodev, nosuid, noowners)\n",
        "//op@host/share on /Volumes/share (smbfs, nodev, nosuid, mounted by op)\n",
        "host:/export on /Users/op/local (nfs, nodev, nosuid)\n",
    ));
    for local in ["/", "/Users/op/alpha", "/Volumes", "/System/Volumes/Data/Users", "/Volumes/USB on desk/x", "/Volumes/shared"] {
        assert!(is_on_local_mount(local, &mounts), "{local}");
    }
    for remote in ["/Volumes/share", "/Volumes/share/x", "/Users/op/local/x", "/System/Volumes/Data/home/op"] {
        assert!(!is_on_local_mount(remote, &mounts), "{remote}");
    }
    assert!(!is_on_local_mount("/", &macos_mounts("")), "nothing is local where the table cannot be read");
}

/// On this computer's own disk, with real links.
#[cfg(windows)]
mod on_windows {
    use std::os::windows::fs::{symlink_dir, symlink_file};
    use std::path::Path;

    use crate::slices::surface::disk::ThisComputer;
    use crate::slices::surface::local_path::{resolve, Refused, Style};
    use crate::test_support::TempDir;

    /// A folder under the temp one, spelled without the system's prefix.
    fn folder() -> (TempDir, String) {
        let dir = TempDir::canonical("surface-disk");
        let path = plain(&dir);
        (dir, path)
    }

    fn plain(path: &Path) -> String {
        let path = path.to_str().unwrap();
        path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
    }

    fn read(written: &str, cwd: &str) -> Result<String, Refused> {
        resolve(written, cwd, Style::Windows, &ThisComputer::now())
    }

    fn junction(link: &str, target: &str) {
        let made = crate::spawn::hidden_command("cmd").args(["/C", "mklink", "/J", link, target]).output().unwrap();
        assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
    }

    #[test]
    fn a_file_in_the_working_directory_is_found_and_a_missing_one_is_not() {
        let (dir, cwd) = folder();
        std::fs::create_dir(dir.join("src")).unwrap();
        std::fs::write(dir.join("src").join("a b.rs"), "x").unwrap();

        assert_eq!(read("src/a b.rs", &cwd), Ok(format!(r"{cwd}\src\a b.rs")));
        assert_eq!(read("src", &cwd), Ok(format!(r"{cwd}\src")));
        assert_eq!(read("src/b.rs", &cwd), Err(Refused::Missing));
        assert_eq!(read("src/a b.rs/x", &cwd), Err(Refused::Missing));
    }

    #[test]
    fn a_junction_is_followed_and_a_drive_that_is_not_there_is_missing() {
        let (dir, cwd) = folder();
        std::fs::create_dir(dir.join("real")).unwrap();
        std::fs::write(dir.join("real").join("x"), "x").unwrap();
        junction(&format!(r"{cwd}\link"), &format!(r"{cwd}\real"));

        assert_eq!(read("link/x", &cwd), Ok(format!(r"{cwd}\real\x")));
        let free = ('D'..='Y').rev().find(|letter| !Path::new(&format!(r"{letter}:\")).exists()).unwrap();
        // A drive that is not there may still be a mapped one that is away
        assert!(read(&format!(r"{free}:\x"), &cwd).is_err());
    }

    /// The host is one no name server knows, so a test that followed the link would wait on it.
    #[test]
    fn a_link_to_a_share_is_refused() {
        const SHARE: &str = r"\\quay-test.invalid\share";
        let (dir, cwd) = folder();
        // A computer that does not let this user make symbolic links has none to judge
        if symlink_dir(SHARE, dir.join("dir")).is_err() || symlink_file(format!(r"{SHARE}\x"), dir.join("file")).is_err() {
            return;
        }
        let started = std::time::Instant::now();
        for written in ["dir", "dir/x", "file", "dir/../dir/x"] {
            assert_eq!(read(written, &cwd), Err(Refused::Network), "{written}");
        }
        assert!(started.elapsed().as_millis() < 500, "{:?}", started.elapsed());
    }
}
