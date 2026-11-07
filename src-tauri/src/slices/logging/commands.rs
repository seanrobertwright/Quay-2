//! The Tauri command behind the "Open logs folder" palette entry.

/// Opens the logs folder in the system file manager, creating it first if it is missing.
#[tauri::command]
pub async fn open_logs_folder() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        let dir = super::logs_dir();
        std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {}", dir.display(), e))?;
        tauri_plugin_opener::open_path(&dir, None::<&str>)
            .map_err(|e| format!("Could not open {}: {}", dir.display(), e))
    })
    .await
    .map_err(|e| e.to_string())?
}
