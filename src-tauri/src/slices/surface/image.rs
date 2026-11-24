//! The images a surface shows: which are read, and what the operator is told of one that is not.

use std::path::Path;
use std::time::Duration;

use tauri::ipc::Response;
use tauri::State;

use super::disk::ThisComputer;
use super::image_file::{read_file, reading, NotRead, MOST_BYTES};
use super::local_path::{resolve, Refused, STYLE};
use super::store::{ImageRefused, SurfaceKey};
use super::tools::SurfaceTools;
use crate::slices::pty::manager::PtyManager;

/// How long finding and reading one image may take.
const READ_LIMIT: Duration = Duration::from_secs(10);

/// The bytes of the image `path` that the live surface `key` names, read in its terminal's working
/// directory. The path is judged before anything on it is touched. The error says why it is not
/// shown, in words for the operator.
pub async fn read_image(surfaces: &SurfaceTools, terminals: &PtyManager, key: SurfaceKey, path: String) -> Result<Vec<u8>, String> {
    surfaces.store().check_image(&key, &path).map_err(not_served)?;
    let Some(terminal) = terminals.get_info(&key.terminal_id) else {
        return Err("Quay no longer has this terminal.".to_string());
    };
    let read = move |deadline| {
        let file = resolve(&path, &terminal.project_path, STYLE, &ThisComputer::now())?;
        read_file(Path::new(&file), deadline)
    };
    reading(READ_LIMIT, read).await.map_err(not_read)
}

fn not_served(refused: ImageRefused) -> String {
    let why = match refused {
        ImageRefused::NoLiveSurface => "Quay no longer shows this surface.",
        ImageRefused::NotNamed => "This surface does not name this image.",
    };
    why.to_string()
}

fn not_read(why: NotRead) -> String {
    let why = match why {
        NotRead::Refused(Refused::NotLocal) => "It is not a file on this computer, or Quay cannot tell that it is.",
        NotRead::Refused(Refused::NotAPath) => "It is not a path Quay can open.",
        NotRead::Refused(Refused::Missing) => "There is no such file.",
        NotRead::Refused(Refused::Unreadable) => "Quay could not read where it leads.",
        NotRead::NotAFile => "It is not a file.",
        NotRead::TooLarge => return format!("It is larger than {} MB.", MOST_BYTES / (1024 * 1024)),
        NotRead::OtherKind => "It is not a PNG, JPEG, GIF or WebP image.",
        NotRead::Unreadable => "Quay could not read it.",
        NotRead::TooSlow => "Reading it took too long.",
    };
    why.to_string()
}

/// The bytes of an image a surface names, as a raw `ArrayBuffer`.
#[tauri::command]
pub async fn surface_image(
    terminal_id: String,
    id: String,
    path: String,
    surfaces: State<'_, SurfaceTools>,
    terminals: State<'_, PtyManager>,
) -> Result<Response, String> {
    read_image(&surfaces, &terminals, SurfaceKey::new(terminal_id, id), path).await.map(Response::new)
}
