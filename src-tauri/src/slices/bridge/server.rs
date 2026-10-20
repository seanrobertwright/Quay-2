use tauri::AppHandle;
use tokio::net::TcpListener;

use super::port::BRIDGE_PORT_VAR;
use super::routes::{create_router, AppContext};
use super::state::BridgeState;
use crate::slices::machina::MachinaManager;
use crate::slices::orchestrator::A2ARouter;
use crate::slices::pty::manager::PtyManager;

/// Binds the bridge's listener on loopback. Port 0 asks the OS for a random port.
pub async fn bind_bridge_listener(port: u16) -> Result<TcpListener, String> {
    TcpListener::bind(("127.0.0.1", port)).await.map_err(|e| {
        if port == 0 {
            format!("Failed to bind bridge HTTP listener: {}", e)
        } else {
            format!(
                "Failed to bind bridge HTTP listener on pinned port {} ({}={}): {}",
                port, BRIDGE_PORT_VAR, port, e
            )
        }
    })
}

pub struct BridgeServer;

impl BridgeServer {
    pub async fn start(
        bridge_state: BridgeState,
        pty_manager: PtyManager,
        a2a_router: A2ARouter,
        machina_manager: MachinaManager,
        app_handle: AppHandle,
        port: u16,
    ) -> Result<u16, String> {
        let listener = bind_bridge_listener(port).await?;

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
            machina_manager,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_busy_pinned_port_names_the_port_and_the_variable() {
        let occupier = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let busy = occupier.local_addr().unwrap().port();

        let err = bind_bridge_listener(busy).await.unwrap_err();

        assert!(err.contains(&busy.to_string()), "{err}");
        assert!(err.contains("QUAY_BRIDGE_PORT"), "{err}");
    }
}
