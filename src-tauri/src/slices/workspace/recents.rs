//! The recent-projects list behind the Open Project dialog: projects in the order they were
//! last opened or switched to, kept even after a project is removed from Quay so it can be
//! reopened in one click.

use serde::{Deserialize, Serialize};

/// How many recent projects are kept.
pub const MAX_RECENTS: usize = 20;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    /// Unix seconds; 0 for entries seeded from the project list before recents existed.
    #[serde(default)]
    pub last_opened: u64,
}

/// A recent project with its folder's current state, for the dialog's sidebar.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RecentProjectInfo {
    pub path: String,
    pub name: String,
    pub last_opened: u64,
    pub exists: bool,
    pub is_git: bool,
    pub branch: Option<String>,
}

fn same_path(a: &str, b: &str) -> bool {
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b)
}

/// Moves `path` to the front of `recents`, stamped `now`, and trims the list to
/// [`MAX_RECENTS`].
pub fn touch(recents: &mut Vec<RecentProject>, path: &str, name: &str, now: u64) {
    recents.retain(|r| !same_path(&r.path, path));
    recents.insert(
        0,
        RecentProject { path: path.to_string(), name: name.to_string(), last_opened: now },
    );
    recents.truncate(MAX_RECENTS);
}

/// The first recents list for a workspaces file written before recents existed: every
/// project, the active one first.
pub fn seed<'a>(
    projects: impl IntoIterator<Item = (&'a str, &'a str)>,
    active: Option<&str>,
) -> Vec<RecentProject> {
    let mut seeded: Vec<RecentProject> = projects
        .into_iter()
        .map(|(path, name)| RecentProject { path: path.to_string(), name: name.to_string(), last_opened: 0 })
        .collect();
    if let Some(active) = active {
        if let Some(i) = seeded.iter().position(|r| same_path(&r.path, active)) {
            let first = seeded.remove(i);
            seeded.insert(0, first);
        }
    }
    seeded.truncate(MAX_RECENTS);
    seeded
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(list: &[RecentProject]) -> Vec<&str> {
        list.iter().map(|r| r.path.as_str()).collect()
    }

    #[test]
    fn touching_moves_a_project_to_the_front_without_duplicating_it() {
        let mut list = seed([("C:\\A", "A"), ("C:\\B", "B")], None);
        touch(&mut list, "c:/b/", "B", 100);
        assert_eq!(paths(&list), vec!["c:/b/", "C:\\A"]);
        assert_eq!(list[0].last_opened, 100);

        touch(&mut list, "C:\\New", "New", 200);
        assert_eq!(paths(&list), vec!["C:\\New", "c:/b/", "C:\\A"]);
    }

    #[test]
    fn the_list_is_capped() {
        let mut list = Vec::new();
        for i in 0..MAX_RECENTS + 3 {
            touch(&mut list, &format!("C:\\P{}", i), "p", i as u64);
        }
        assert_eq!(list.len(), MAX_RECENTS);
        assert_eq!(list[0].path, format!("C:\\P{}", MAX_RECENTS + 2));
    }

    #[test]
    fn seeding_puts_the_active_project_first() {
        let list = seed([("C:\\A", "A"), ("C:\\B", "B"), ("C:\\C", "C")], Some("c:/b"));
        assert_eq!(paths(&list), vec!["C:\\B", "C:\\A", "C:\\C"]);
        assert!(list.iter().all(|r| r.last_opened == 0));
    }
}
