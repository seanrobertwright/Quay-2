//! Which paths an agent may name, on a fake disk that records everything touched.

use std::cell::RefCell;
use std::collections::HashMap;
use std::io;

use super::local_path::{named, resolve, Disk, Location, Named, Refused, Style};

/// The terminal's working directory in every Windows case.
const CWD: &str = r"E:\alpha";

/// A disk with drives C and E, a mapped network drive Z, a `subst` drive S, and a link table.
struct FakeDisk {
    style: Style,
    links: HashMap<String, String>,
    missing: Vec<String>,
    /// Every path whose link was read, in order.
    touched: RefCell<Vec<String>>,
}

impl FakeDisk {
    fn new(style: Style) -> Self {
        Self { style, links: HashMap::new(), missing: Vec::new(), touched: RefCell::default() }
    }

    fn windows() -> Self {
        Self::new(Style::Windows)
    }

    fn link(mut self, at: &str, to: &str) -> Self {
        self.links.insert(at.to_string(), to.to_string());
        self
    }

    fn without(mut self, path: &str) -> Self {
        self.missing.push(path.to_string());
        self
    }

    fn resolve(&self, written: &str) -> Result<String, Refused> {
        self.resolve_in(written, if self.style == Style::Windows { CWD } else { "/home/op/alpha" })
    }

    fn resolve_in(&self, written: &str, cwd: &str) -> Result<String, Refused> {
        resolve(written, cwd, self.style, self)
    }
}

impl Disk for FakeDisk {
    fn location(&self, path: &str) -> Location {
        match self.style {
            Style::Windows => match path {
                r"C:\" | r"E:\" => Location::Local,
                r"Z:\" => Location::NotLocal,
                r"S:\" => Location::NamedFor(r"E:\alpha\sub".into()),
                r"T:\" => Location::NamedFor(r"Z:\share".into()),
                r"U:\" => Location::NamedFor(r"\\host\share".into()),
                r"V:\" => Location::NamedFor(r"E:\to-host".into()),
                _ => Location::Missing,
            },
            Style::Unix if path == "/mnt/nas" || path.starts_with("/mnt/nas/") => Location::NotLocal,
            Style::Unix => Location::Local,
        }
    }

    fn link(&self, path: &str) -> io::Result<Option<String>> {
        self.touched.borrow_mut().push(path.to_string());
        if self.missing.iter().any(|missing| missing == path) {
            return Err(io::ErrorKind::NotFound.into());
        }
        Ok(self.links.get(path).cloned())
    }
}

#[test]
fn a_relative_path_is_in_the_terminals_working_directory_and_an_absolute_one_is_anywhere_on_this_computer() {
    for (written, path) in [
        ("src/main.rs", r"E:\alpha\src\main.rs"),
        (r"src\main.rs", r"E:\alpha\src\main.rs"),
        ("./src//main.rs", r"E:\alpha\src\main.rs"),
        ("../beta/x", r"E:\beta\x"),
        ("../../../x", r"E:\x"),
        ("  src/main.rs\t", r"E:\alpha\src\main.rs"),
        (".", r"E:\alpha"),
        ("a b/ü.txt", r"E:\alpha\a b\ü.txt"),
        ("é", r"E:\alpha\é"),
        ("éa/x", r"E:\alpha\éa\x"),
        ("日/x", r"E:\alpha\日\x"),
        ("file:///C:/日", r"C:\日"),
        ("e:/alpha/x", r"E:\alpha\x"),
        (r"C:\Temp\log.txt", r"C:\Temp\log.txt"),
        (r"C:\", r"C:\"),
        ("/Temp/x", r"E:\Temp\x"),
        ("file:///C:/Temp/a%20b.txt", r"C:\Temp\a b.txt"),
        ("FILE:///c:/Temp/x", r"C:\Temp\x"),
        (r"S:\x", r"E:\alpha\sub\x"),
    ] {
        assert_eq!(FakeDisk::windows().resolve(written), Ok(path.to_string()), "{written:?}");
    }
    assert_eq!(FakeDisk::windows().resolve_in("x", r"\\?\C:\beta"), Ok(r"C:\beta\x".to_string()));
    assert_eq!(FakeDisk::windows().resolve_in("x", "C:/beta/"), Ok(r"C:\beta\x".to_string()));
}

#[test]
fn a_network_or_device_path_is_refused_with_nothing_touched() {
    for written in [
        r"\\host\share\x",
        "//host/share/x",
        r"\/host/share",
        r"/\host\share",
        r"  \\host\share",
        "\t//host/share",
        r"\\host@SSL@8443\DavWWWRoot\x",
        r"\\127.0.0.1\c$\x",
        r"\\?\UNC\host\share\x",
        r"\\?\unc\host\share",
        r"//?/UNC/host/share",
        r"\\?\C:\Temp\x",
        r"\\.\C:\Temp\x",
        r"\\.\UNC\host\share",
        r"\\.\pipe\x",
        r"\\.\PhysicalDrive0",
        r"\\?\GLOBALROOT\Device\Mup\host\share",
        r"\\?\Volume{00000000-0000-0000-0000-000000000000}\x",
        r"\\",
        r"\\host",
        "file://host/share/x",
        "file://localhost/C:/Temp/x",
        "FILE://host/x",
        r"file://\\host\share",
        "file:////host/share/x",
        "file://///host/share/x",
        "file:///%5C%5Chost/share",
        "file:///%2F%2Fhost/share",
        "file:///%2fhost/share",
        r"file:///\host\share",
        "file://C:/Temp/x",
        r"Z:\x",
        "z:/x",
        "file:///Z:/x",
        r"T:\x",
        r"U:\x",
        "NUL",
        "nul.txt",
        "src/CON",
        r"E:\alpha\aux.log\x",
        "COM1",
        "com1:",
        "lpt9.tar.gz",
        "COM¹",
        "CONIN$",
        "prn .txt",
    ] {
        let disk = FakeDisk::windows();
        assert_eq!(disk.resolve(written), Err(Refused::NotLocal), "{written:?}");
        assert_eq!(*disk.touched.borrow(), Vec::<String>::new(), "{written:?}");
    }
}

#[test]
fn what_is_not_written_as_a_path_is_refused_with_nothing_touched() {
    let long = "x/".repeat(3000);
    for written in [
        "",
        "   ",
        "C:x",
        "C:",
        "C:12",
        "x.txt:stream",
        "x.txt::$DATA",
        "javascript:alert(1)",
        "https://a.example",
        r"\??\C:\Temp\x",
        r"\??\UNC\host\share",
        "a?b",
        "a*b",
        "a|b",
        "a<b",
        "a\"b",
        "a\0b",
        "a\nb",
        "x. ",
        "dir./x",
        ".. /x",
        ".../x",
        "file:///etc/hosts",
        "file:///",
        "file:///C:/a%00b",
        "file:///C:/a%ff",
        "file:///C|/x",
        "file:C:/x",
        &long,
    ] {
        let disk = FakeDisk::windows();
        assert_eq!(disk.resolve(written), Err(Refused::NotAPath), "{written:?}");
        assert_eq!(*disk.touched.borrow(), Vec::<String>::new(), "{written:?}");
    }
}

#[test]
fn a_working_directory_on_the_network_makes_every_relative_path_one() {
    for cwd in [r"\\host\share\alpha", r"Z:\alpha", r"\\?\UNC\host\share", "//wsl$/Ubuntu/home", ""] {
        let disk = FakeDisk::windows();
        assert_eq!(disk.resolve_in("x", cwd), Err(Refused::NotLocal), "{cwd:?}");
        assert_eq!(disk.resolve_in("/x", cwd), Err(Refused::NotLocal), "{cwd:?}");
        assert_eq!(*disk.touched.borrow(), Vec::<String>::new(), "{cwd:?}");
        assert_eq!(disk.resolve_in(r"C:\x", cwd), Ok(r"C:\x".to_string()), "{cwd:?}");
    }
}

#[test]
fn a_link_that_leads_to_the_network_is_refused_before_its_target_is_touched() {
    for target in [
        r"\\host\share",
        r"\\?\UNC\host\share",
        r"\\?\Volume{00000000-0000-0000-0000-000000000000}\",
        r"\\.\pipe",
        r"Z:\share",
        r"\\?\Z:\share",
        "//host/share",
        r"..\to-z",
        r"UNC\..\..\to-z",
        r"\to-z",
        r"T:\",
        "NUL",
        r"V:\x",
    ] {
        let disk = FakeDisk::windows()
            .link(r"E:\alpha\link", target)
            .link(r"E:\to-z", r"Z:\share")
            .link(r"E:\to-host", r"\\host\share");
        for written in ["link/deep/x", "link", r"E:\alpha\link\deep", "dir/../link/x"] {
            assert_eq!(disk.resolve(written), Err(Refused::NotLocal), "{target:?} {written:?}");
        }
        for touched in disk.touched.borrow().iter() {
            assert!(touched.starts_with(r"E:\") && !touched.contains("deep"), "{target:?} touched {touched:?}");
        }
    }
}

#[test]
fn a_link_on_this_computer_is_followed_to_what_it_names() {
    let disk = FakeDisk::windows()
        .link(r"E:\alpha\rel", r"..\beta")
        .link(r"E:\beta\abs", r"\\?\C:\Temp")
        .link(r"E:\alpha\plain", r"C:\Temp")
        .link(r"E:\alpha\rooted", r"\gamma");
    for (written, path) in [
        ("rel/x", r"E:\beta\x"),
        ("rel/abs/x", r"C:\Temp\x"),
        ("plain/x", r"C:\Temp\x"),
        ("rooted/x", r"E:\gamma\x"),
        ("rel", r"E:\beta"),
        // Windows reads `..` before it follows a link
        ("rel/../x", r"E:\alpha\x"),
    ] {
        assert_eq!(disk.resolve(written), Ok(path.to_string()), "{written:?}");
    }
}

#[test]
fn links_in_a_circle_are_refused() {
    let disk = FakeDisk::windows().link(r"E:\alpha\a", "b").link(r"E:\alpha\b", "a");
    assert_eq!(disk.resolve("a/x"), Err(Refused::Unreadable));
}

#[test]
fn a_missing_path_or_drive_is_missing() {
    let disk = FakeDisk::windows().without(r"E:\alpha\gone");
    assert_eq!(disk.resolve("gone"), Err(Refused::Missing));
    assert_eq!(disk.resolve("gone/x"), Err(Refused::Missing));
    assert_eq!(*disk.touched.borrow().last().unwrap(), r"E:\alpha\gone", "and what is under it is not touched");
    assert_eq!(disk.resolve(r"Q:\x"), Err(Refused::Missing));
}

#[test]
fn unix_paths_are_judged_by_the_mount_each_part_of_them_is_on() {
    let disk = FakeDisk::new(Style::Unix)
        .link("/home/op/alpha/nas", "/mnt/nas/share")
        .link("/home/op/alpha/rel", "../../../mnt/nas")
        .link("/home/op/alpha/beta", "/home/op/beta");
    for (written, path) in [
        ("src/main.rs", "/home/op/alpha/src/main.rs"),
        ("/tmp/log.txt", "/tmp/log.txt"),
        ("file:///tmp/a%20b", "/tmp/a b"),
        ("beta/x", "/home/op/beta/x"),
        // Unix follows a link before it reads `..`
        ("beta/../x", "/home/op/x"),
        ("NUL", "/home/op/alpha/NUL"),
    ] {
        assert_eq!(disk.resolve(written), Ok(path.to_string()), "{written:?}");
    }
    for written in ["//host/share", r"\\host\share", "file://host/x", "file:////host/x", "/mnt/nas", "/mnt/nas/x", "nas/x", "rel/x"] {
        let disk = FakeDisk { touched: RefCell::default(), links: disk.links.clone(), missing: Vec::new(), style: Style::Unix };
        assert_eq!(disk.resolve(written), Err(Refused::NotLocal), "{written:?}");
        assert!(!disk.touched.borrow().iter().any(|path| path.starts_with("/mnt/nas")), "{written:?}");
    }
    assert_eq!(disk.resolve("a\0b"), Err(Refused::NotAPath));
}

#[test]
fn a_line_number_at_the_end_is_kept_apart_from_the_path() {
    for (written, path, line) in [
        ("src/a.ts:12", "src/a.ts", Some(12)),
        ("src/a.ts:12:3", "src/a.ts", Some(12)),
        (r"C:\a.ts:7", r"C:\a.ts", Some(7)),
        ("a.ts", "a.ts", None),
        (" a.ts:1 ", "a.ts", Some(1)),
        ("C:12", "C:12", None),
        ("a.ts:", "a.ts:", None),
        ("a.ts:x", "a.ts:x", None),
        ("a.ts:99999999999", "a.ts:99999999999", None),
        (":12", ":12", None),
        ("com1:", "com1:", None),
    ] {
        assert_eq!(named(written), Named { path: path.to_string(), line }, "{written:?}");
    }
}
