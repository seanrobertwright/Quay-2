//! Showing the operator a file an agent named: in the file manager, or in Quay's diff view when it has
//! uncommitted changes. Never in the file's own program.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::disk::ThisComputer;
use super::local_path::{named, resolve, Named, Refused, Style};
use crate::slices::git::file_change::{file_change, ChangeSide, FileChange};
use crate::slices::pty::manager::PtyManager;

const STYLE: Style = if cfg!(windows) { Style::Windows } else { Style::Unix };

/// The most characters of a path a refusal quotes.
const MOST_QUOTED: usize = 200;

/// How a file was shown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Shown {
    /// The file manager shows it in its folder.
    Revealed,
    /// Nothing is shown yet: the webview is to open the diff view on `path`, in the worktree that is
    /// the terminal's folder. `line` is the line the agent named.
    Diff { path: String, side: ChangeSide, line: Option<u32> },
}

/// Shows the file `written` names in `terminal_id`'s working directory, which may end in `:line` when
/// `line` is not given. The path is judged before anything on it is touched. The error says why
/// nothing was shown, in words for the operator.
pub fn show_file(
    terminals: &PtyManager,
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
    let change = resolve(".", folder, STYLE, &disk).ok().and_then(|folder| file_change(Path::new(&folder), path));
    if let Some(FileChange { path, side }) = change {
        return Ok(Shown::Diff { path, side, line: line.or(written_line) });
    }
    match reveal(path) {
        Ok(()) => Ok(Shown::Revealed),
        Err(error) => Err(format!("Not opened: the file manager could not show {} ({error}).", quoted(&written))),
    }
}

fn refusal(refused: Refused, written: &str) -> String {
    let path = quoted(written);
    match refused {
        Refused::NotAPath if path.is_empty() => "Not opened: the link names no file.".to_string(),
        Refused::NotAPath => format!("Not opened: {path} is not a path Quay can open."),
        Refused::Network => format!("Not opened: {path} is on the network or is a device. Quay opens only files on this computer."),
        Refused::Missing => format!("Not opened: there is no {path}."),
        Refused::Unreadable => format!("Not opened: Quay could not read where {path} leads."),
    }
}

/// `written`, cut where it is long, with a space for each character that has no look of its own or
/// turns the text around it.
fn quoted(written: &str) -> String {
    let unseen = |c: char| c.is_control() || matches!(c, '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}');
    let mut shown: String = written.chars().take(MOST_QUOTED).map(|c| if unseen(c) { ' ' } else { c }).collect();
    if written.chars().nth(MOST_QUOTED).is_some() {
        shown.push('…');
    }
    shown.trim().to_string()
}

/// Shows a file an agent of `terminal_id` named, at the operator's click on it.
#[tauri::command]
pub async fn surface_show_file(
    terminal_id: String,
    path: String,
    line: Option<u32>,
    terminals: State<'_, PtyManager>,
) -> Result<Shown, String> {
    let terminals = terminals.inner().clone();
    let reveal = |path: &Path| tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string());
    tauri::async_runtime::spawn_blocking(move || show_file(&terminals, &terminal_id, &path, line, reveal))
        .await
        .map_err(|e| format!("Not opened: {e}"))?
}
