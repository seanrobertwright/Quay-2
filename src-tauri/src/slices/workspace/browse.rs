//! Filesystem reads behind the Open Project dialog: a folder's subfolders with their git
//! state, the drives, the home folder, and one folder's own state for the path bar.
//!
//! Git state comes from reading `.git/HEAD` directly, never from spawning git, so listing a
//! folder of a hundred repos stays one directory read plus a small file read per repo.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// The most subfolders one listing returns. Bigger folders come back truncated.
pub const MAX_ENTRIES: usize = 2000;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub is_git: bool,
    /// The checked-out branch, or a short commit id when HEAD is detached.
    pub branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FolderListing {
    pub path: String,
    pub entries: Vec<FolderEntry>,
    /// True when the folder held more than [`MAX_ENTRIES`] subfolders.
    pub truncated: bool,
}

/// What the path bar needs to know about the typed folder.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FolderInfo {
    pub exists: bool,
    pub is_git: bool,
    pub branch: Option<String>,
}

/// `C:` on its own means "the current folder on drive C", so a bare drive gets its root slash.
fn as_dir_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    let bytes = trimmed.as_bytes();
    if bytes.len() == 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        PathBuf::from(format!("{}\\", trimmed))
    } else {
        PathBuf::from(trimmed)
    }
}

/// Reads the branch a repo has checked out from its HEAD file. `.git` can be a folder or,
/// in a worktree or submodule, a file pointing at the real git dir.
pub fn git_branch(repo: &Path) -> Option<String> {
    let dot_git = repo.join(".git");
    let meta = std::fs::metadata(&dot_git).ok()?;
    let git_dir = if meta.is_dir() {
        dot_git
    } else {
        let pointer = std::fs::read_to_string(&dot_git).ok()?;
        let target = pointer.trim().strip_prefix("gitdir:")?.trim();
        let target = Path::new(target);
        if target.is_absolute() {
            target.to_path_buf()
        } else {
            repo.join(target)
        }
    };
    let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
    parse_head(&head)
}

/// `ref: refs/heads/main` gives `main`; a detached HEAD gives its first seven hex digits.
fn parse_head(head: &str) -> Option<String> {
    let head = head.trim();
    if let Some(reference) = head.strip_prefix("ref:") {
        let reference = reference.trim();
        let branch = reference.strip_prefix("refs/heads/").unwrap_or(reference);
        return (!branch.is_empty()).then(|| branch.to_string());
    }
    if head.len() >= 7 && head.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(head[..7].to_string());
    }
    None
}

fn is_git_repo(path: &Path) -> bool {
    path.join(".git").exists()
}

/// Hidden and system folders stay out of the list: dot-folders everywhere, and on Windows
/// anything flagged hidden or system (which covers the profile's legacy junctions such as
/// `Application Data`).
fn is_hidden(name: &str, _meta: &std::fs::Metadata) -> bool {
    if name.starts_with('.') || name.starts_with('$') {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN: u32 = 0x2;
        const SYSTEM: u32 = 0x4;
        if _meta.file_attributes() & (HIDDEN | SYSTEM) != 0 {
            return true;
        }
    }
    false
}

/// Lists `path`'s visible subfolders, sorted by name ignoring case. Links and junctions are
/// followed when they point at a folder; broken ones and entries that can't be read are
/// skipped. Fails only when `path` itself can't be read.
pub fn list_folder(path: &str) -> Result<FolderListing, String> {
    let dir = as_dir_path(path);
    let reader = std::fs::read_dir(&dir).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!("Folder not found: {}", dir.display()),
        std::io::ErrorKind::PermissionDenied => format!("Access denied: {}", dir.display()),
        _ => format!("Can't read {}: {}", dir.display(), e),
    })?;

    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in reader.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // DirEntry::metadata doesn't follow links, so a hidden junction keeps its hidden flag.
        let Ok(own_meta) = entry.metadata() else { continue };
        if is_hidden(&name, &own_meta) {
            continue;
        }
        let child = entry.path();
        let is_dir = if own_meta.file_type().is_symlink() {
            std::fs::metadata(&child).map(|m| m.is_dir()).unwrap_or(false)
        } else {
            own_meta.is_dir()
        };
        if !is_dir {
            continue;
        }
        if entries.len() == MAX_ENTRIES {
            truncated = true;
            break;
        }
        let is_git = is_git_repo(&child);
        entries.push(FolderEntry {
            branch: if is_git { git_branch(&child) } else { None },
            is_git,
            name,
            path: child.to_string_lossy().to_string(),
        });
    }
    entries.sort_by_key(|e| e.name.to_lowercase());

    Ok(FolderListing {
        path: dir.to_string_lossy().to_string(),
        entries,
        truncated,
    })
}

/// Whether `path` is a folder, and its git state if it is.
pub fn inspect_folder(path: &str) -> FolderInfo {
    let dir = as_dir_path(path);
    if path.trim().is_empty() || !dir.is_dir() {
        return FolderInfo { exists: false, is_git: false, branch: None };
    }
    let is_git = is_git_repo(&dir);
    FolderInfo {
        exists: true,
        is_git,
        branch: if is_git { git_branch(&dir) } else { None },
    }
}

/// The user's home folder.
pub fn home_folder() -> Option<String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .filter(|h| !h.is_empty())
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetLogicalDrives() -> u32;
}

/// The drive roots, such as `C:\`. Read from the drive bitmask rather than by probing each
/// letter, so a disconnected network drive or an empty card reader doesn't stall the dialog.
#[cfg(windows)]
pub fn drives() -> Vec<String> {
    // SAFETY: GetLogicalDrives takes no arguments and only returns a bitmask.
    let mask = unsafe { GetLogicalDrives() };
    drives_from_mask(mask)
}

#[cfg(not(windows))]
pub fn drives() -> Vec<String> {
    vec!["/".to_string()]
}

#[cfg_attr(not(windows), allow(dead_code))]
fn drives_from_mask(mask: u32) -> Vec<String> {
    (0..26u8)
        .filter(|bit| mask & (1 << bit) != 0)
        .map(|bit| format!("{}:\\", (b'A' + bit) as char))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A fresh folder under the system temp dir, removed when dropped.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("quay-browse-{}-{}", tag, uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn make_repo(dir: &Path, head: &str) {
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".git").join("HEAD"), head).unwrap();
    }

    fn names(listing: &FolderListing) -> Vec<&str> {
        listing.entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn lists_subfolders_sorted_without_files_or_dot_folders() {
        let tmp = TempDir::new("list");
        for name in ["beta", "Alpha", "gamma", ".hidden"] {
            fs::create_dir(tmp.0.join(name)).unwrap();
        }
        fs::write(tmp.0.join("readme.txt"), "x").unwrap();

        let listing = list_folder(&tmp.0.to_string_lossy()).unwrap();
        assert_eq!(names(&listing), vec!["Alpha", "beta", "gamma"]);
        assert!(!listing.truncated);
        assert!(listing.entries.iter().all(|e| !e.is_git && e.branch.is_none()));
    }

    #[test]
    fn marks_git_repos_with_their_branch() {
        let tmp = TempDir::new("git");
        make_repo(&tmp.0.join("repo"), "ref: refs/heads/feat/286-dialog\n");
        make_repo(&tmp.0.join("detached"), "0553827abcdef0123456789abcdef0123456789\n");
        fs::create_dir(tmp.0.join("plain")).unwrap();

        let listing = list_folder(&tmp.0.to_string_lossy()).unwrap();
        let by_name = |n: &str| listing.entries.iter().find(|e| e.name == n).unwrap().clone();
        assert_eq!(by_name("repo").branch.as_deref(), Some("feat/286-dialog"));
        assert!(by_name("repo").is_git);
        assert_eq!(by_name("detached").branch.as_deref(), Some("0553827"));
        assert!(!by_name("plain").is_git);
    }

    #[test]
    fn follows_a_dot_git_file_to_a_worktree_head() {
        let tmp = TempDir::new("worktree");
        let real_git = tmp.0.join("main-repo-git").join("worktrees").join("wt");
        fs::create_dir_all(&real_git).unwrap();
        fs::write(real_git.join("HEAD"), "ref: refs/heads/wt-branch\n").unwrap();
        let wt = tmp.0.join("wt");
        fs::create_dir(&wt).unwrap();
        fs::write(wt.join(".git"), format!("gitdir: {}\n", real_git.display())).unwrap();

        assert_eq!(git_branch(&wt).as_deref(), Some("wt-branch"));
        let info = inspect_folder(&wt.to_string_lossy());
        assert!(info.exists && info.is_git);
        assert_eq!(info.branch.as_deref(), Some("wt-branch"));
    }

    #[test]
    fn a_repo_with_an_unreadable_head_is_still_a_repo() {
        let tmp = TempDir::new("nohead");
        fs::create_dir_all(tmp.0.join("repo").join(".git")).unwrap();
        let listing = list_folder(&tmp.0.to_string_lossy()).unwrap();
        assert!(listing.entries[0].is_git);
        assert_eq!(listing.entries[0].branch, None);
    }

    #[test]
    fn a_missing_folder_is_an_error_and_inspects_as_missing() {
        let tmp = TempDir::new("missing");
        let gone = tmp.0.join("nope");
        let err = list_folder(&gone.to_string_lossy()).unwrap_err();
        assert!(err.starts_with("Folder not found"), "{}", err);
        assert!(!inspect_folder(&gone.to_string_lossy()).exists);
        assert!(!inspect_folder("  ").exists);
    }

    #[test]
    fn a_file_inspects_as_missing() {
        let tmp = TempDir::new("file");
        let file = tmp.0.join("f.txt");
        fs::write(&file, "x").unwrap();
        assert!(!inspect_folder(&file.to_string_lossy()).exists);
        assert!(list_folder(&file.to_string_lossy()).is_err());
    }

    #[test]
    fn large_folders_are_truncated() {
        let tmp = TempDir::new("large");
        for i in 0..MAX_ENTRIES + 5 {
            fs::create_dir(tmp.0.join(format!("d{:05}", i))).unwrap();
        }
        let listing = list_folder(&tmp.0.to_string_lossy()).unwrap();
        assert_eq!(listing.entries.len(), MAX_ENTRIES);
        assert!(listing.truncated);
    }

    #[cfg(windows)]
    #[test]
    fn junctions_to_folders_are_listed() {
        let tmp = TempDir::new("junction");
        let target = tmp.0.join("target");
        fs::create_dir(&target).unwrap();
        let link = tmp.0.join("link");
        // Directory symlinks need a privilege junctions don't; skip if neither is available.
        if std::os::windows::fs::symlink_dir(&target, &link).is_err() {
            return;
        }
        let listing = list_folder(&tmp.0.to_string_lossy()).unwrap();
        assert_eq!(names(&listing), vec!["link", "target"]);
    }

    #[test]
    fn head_parsing() {
        assert_eq!(parse_head("ref: refs/heads/main").as_deref(), Some("main"));
        assert_eq!(parse_head("ref: refs/remotes/x").as_deref(), Some("refs/remotes/x"));
        assert_eq!(parse_head("garbage"), None);
        assert_eq!(parse_head(""), None);
    }

    #[test]
    fn drive_mask_maps_bits_to_roots() {
        assert_eq!(drives_from_mask(0b10100), vec!["C:\\".to_string(), "E:\\".to_string()]);
        assert!(drives_from_mask(0).is_empty());
    }

    #[test]
    fn a_bare_drive_letter_means_its_root() {
        assert_eq!(as_dir_path("C:"), PathBuf::from("C:\\"));
        assert_eq!(as_dir_path("C:\\x"), PathBuf::from("C:\\x"));
    }
}
