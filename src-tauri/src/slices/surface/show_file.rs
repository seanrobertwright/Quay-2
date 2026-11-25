//! Showing the operator a file an agent named: in the file manager, or in Quay's diff view when it has
//! uncommitted changes. Never in the file's own program.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use super::disk::ThisComputer;
use super::local_path::{named, resolve, Named, Refused, STYLE};
use super::plain_line::plain_line;
use crate::slices::git::file_change::{file_change, ChangeSide, FileChange};
use crate::slices::pty::manager::PtyManager;
use crate::slices::workspace::WorkspaceManager;

/// The most characters of a path a refusal quotes.
const MOST_QUOTED: usize = 200;

/// How a file was shown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Shown {
    /// The file manager shows it in its folder.
    Revealed,
    /// Nothing is shown yet: the webview is to open the diff view on `path`, in the worktree whose root
    /// is `worktree`. `line` is the line the agent named.
    Diff { worktree: String, path: String, side: ChangeSide, line: Option<u32> },
}

/// Shows the file `written` names in `terminal_id`'s working directory, which may end in `:line` when
/// `line` is not given. The path is judged before anything on it is touched. A changed file is for the
/// diff view when its repository is the terminal's or one that a folder of `projects`, the projects
/// added to Quay, is in. The error says why nothing was shown, in words for the operator.
pub fn show_file(
    terminals: &PtyManager,
    projects: &[String],
    terminal_id: &str,
    written: &str,
    line: Option<u32>,
    reveal: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<Shown, String> {
    let Some(terminal) = terminals.get_info(terminal_id) else {
        return Err("Not opened: Quay no longer has this terminal.".to_string());
    };
    let folder = &terminal.project_path;
    let Named { path: written, line: written_line } = named(written);
    let disk = ThisComputer::now();
    let path = resolve(&written, folder, STYLE, &disk).map_err(|refused| refusal(refused, &written))?;
    let path = Path::new(&path);
    let local = |folder: &String| resolve(".", folder, STYLE, &disk).ok().map(PathBuf::from);
    let folders: Vec<PathBuf> = std::iter::once(folder).chain(projects).filter_map(local).collect();
    if let Some(FileChange { worktree, path, side }) = file_change(&folders, path) {
        return Ok(Shown::Diff { worktree, path, side, line: line.or(written_line) });
    }
    match reveal(path) {
        Ok(()) => Ok(Shown::Revealed),
        Err(error) => Err(format!("Not opened: the file manager could not show {} ({error}).", plain_line(&written, MOST_QUOTED))),
    }
}

fn refusal(refused: Refused, written: &str) -> String {
    let path = plain_line(written, MOST_QUOTED);
    match refused {
        Refused::NotAPath if path.is_empty() => "Not opened: the link names no file.".to_string(),
        Refused::NotAPath => format!("Not opened: {path} is not a path Quay can open."),
        Refused::NotLocal => format!("Not opened: {path} is not a file on this computer, or Quay cannot tell that it is."),
        Refused::Missing => format!("Not opened: there is no {path}."),
        Refused::Unreadable => format!("Not opened: Quay could not read where {path} leads."),
    }
}

/// Shows a file an agent of `terminal_id` named, at the operator's click on it.
#[tauri::command]
pub async fn surface_show_file(
    terminal_id: String,
    path: String,
    line: Option<u32>,
    terminals: State<'_, PtyManager>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<Shown, String> {
    let terminals = terminals.inner().clone();
    let projects: Vec<String> = workspace.list_projects().into_iter().map(|project| project.path).collect();
    let reveal = |path: &Path| tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string());
    tauri::async_runtime::spawn_blocking(move || show_file(&terminals, &projects, &terminal_id, &path, line, reveal))
        .await
        .map_err(|e| format!("Not opened: {e}"))?
}
