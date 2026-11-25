use std::sync::Arc;

use super::antigravity::{Antigravity, Connection};
use crate::slices::pty::session::sidecar_program;
use crate::slices::sessions::commands::get_home_dir;

/// The program name of the relay, as `bundle.externalBin` in `tauri.conf.json` names it.
pub(super) const RELAY_NAME: &str = "quay-relay";

/// What Connect acts on: the operator's Antigravity.
pub struct Connect {
    antigravity: Arc<Antigravity>,
}

impl Connect {
    /// The operator's own configuration and this Quay's relay. Reads and writes no file.
    pub fn for_operator() -> Self {
        Self { antigravity: Arc::new(Antigravity::in_home(get_home_dir(), sidecar_program(RELAY_NAME))) }
    }
}

/// Where Antigravity's entry stands. Writes nothing.
#[tauri::command]
pub async fn antigravity_connection(connect: tauri::State<'_, Connect>) -> Result<Connection, String> {
    let antigravity = connect.antigravity.clone();
    on_a_thread(move || Ok(antigravity.connection())).await
}

/// The operator pressed Connect with `seen` in the file, if anything. Returns where the entry
/// stands then.
#[tauri::command]
pub async fn antigravity_connect(
    seen: Option<String>,
    connect: tauri::State<'_, Connect>,
) -> Result<Connection, String> {
    let antigravity = connect.antigravity.clone();
    on_a_thread(move || {
        antigravity.connect(seen.as_deref())?;
        Ok(antigravity.connection())
    })
    .await
}

/// The operator pressed Remove on the entry `seen`. Returns where the entry stands then.
#[tauri::command]
pub async fn antigravity_remove(seen: String, connect: tauri::State<'_, Connect>) -> Result<Connection, String> {
    let antigravity = connect.antigravity.clone();
    on_a_thread(move || {
        antigravity.remove(&seen)?;
        Ok(antigravity.connection())
    })
    .await
}

/// Runs `work`, which touches the disk, off the async runtime's threads.
async fn on_a_thread<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work).await.map_err(|e| format!("Quay could not finish: {e}"))?
}
