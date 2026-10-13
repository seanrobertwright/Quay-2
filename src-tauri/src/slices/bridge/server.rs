use tauri::AppHandle;
use tokio::net::TcpListener;

use super::routes::{create_router, AppContext};
use super::state::BridgeState;
use crate::slices::orchestrator::A2ARouter;
use crate::slices::pty::manager::PtyManager;

pub struct BridgeServer;

impl BridgeServer {
    pub async fn start(
        bridge_state: BridgeState,
        pty_manager: PtyManager,
        a2a_router: A2ARouter,
        app_handle: AppHandle,
    ) -> Result<u16, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind bridge HTTP listener: {}", e))?;

        let local_addr = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let port = local_addr.port();
        bridge_state.set_port(port);
        tracing::info!("Quay Claude Bridge & MCP server listening on {}", local_addr);

        let ctx = AppContext {
            bridge_state,
            pty_manager,
            a2a_router,
            app_handle,
        };

        let app = create_router(ctx);

        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app.into_make_service()).await {
                tracing::error!("Bridge server error: {}", e);
            }
        });

        Ok(port)
    }
}
