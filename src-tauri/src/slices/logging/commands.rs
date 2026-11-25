//! The Tauri command behind the "Open logs folder" palette entry.

use std::path::Path;

use crate::slices::surface::record_folder;

/// Shows the logs folder in the system file manager, with the surface record's folder beside it.
#[tauri::command]
pub async fn open_logs_folder() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        show_folder(&super::logs_dir(), &record_folder(), |dir| {
            tauri_plugin_opener::reveal_item_in_dir(dir).map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Has `reveal` show `logs` in the folder it is in, which `beside` is in too. Either is created first if it is
/// missing.
fn show_folder(logs: &Path, beside: &Path, reveal: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
    for dir in [logs, beside] {
        std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {}", dir.display(), e))?;
    }
    reveal(logs).map_err(|e| format!("Could not show {}: {}", logs.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::logging::logs_dir;
    use crate::test_support::TempDir;

    #[test]
    fn the_logs_are_shown_in_the_folder_that_holds_the_surface_record_too() {
        assert_eq!(logs_dir().parent(), record_folder().parent());
        assert_eq!(record_folder().file_name().unwrap(), "surfaces");

        let dir = TempDir::new("logs-folder");
        let (logs, record) = (dir.join("logs"), dir.join("surfaces"));
        let mut shown = None;
        show_folder(&logs, &record, |dir| {
            assert!(logs.is_dir() && record.is_dir());
            shown = Some(dir.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert_eq!(shown, Some(logs));
    }

    #[test]
    fn a_folder_that_cannot_be_made_or_shown_says_which() {
        let dir = TempDir::new("logs-folder");
        std::fs::write(dir.join("file"), "").unwrap();
        let error = show_folder(&dir.join("file"), &dir.join("surfaces"), |_| Ok(())).unwrap_err();
        assert!(error.contains("file"), "{error}");
        let error = show_folder(&dir.join("logs"), &dir.join("surfaces"), |_| Err("no manager".into())).unwrap_err();
        assert!(error.contains("logs") && error.contains("no manager"), "{error}");
    }
}
