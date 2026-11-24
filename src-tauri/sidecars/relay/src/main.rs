mod outside;
mod quay;
mod rpc;
mod stdio;

use std::process::ExitCode;

use quay::Quay;
use rpc::Message;

enum Route {
    Quay(Quay),
    Refused(&'static str),
    Outside,
}

fn main() -> ExitCode {
    let var = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
        return ExitCode::FAILURE;
    };
    let route = match var("QUAY_MCP_URL").zip(var("QUAY_A2A_TOKEN")) {
        None => Route::Outside,
        Some((url, token)) => Quay::new(&url, &token).map_or_else(Route::Refused, Route::Quay),
    };
    runtime.block_on(async {
        let mut lines = stdio::read_lines();
        let (out, written) = stdio::write_lines();
        while let Some(line) = lines.recv().await {
            let Some(message) = Message::parse(&line) else { continue };
            match &route {
                Route::Outside => {
                    if let Some(id) = message.id {
                        let _ = out.send(outside::answer(&id, &message.method, &line)).await;
                    }
                }
                Route::Refused(why) => {
                    if let Some(id) = message.id {
                        let _ = out.send(rpc::error(&id, rpc::RELAY_FAILED, why)).await;
                    }
                }
                Route::Quay(quay) => {
                    let quay = quay.clone();
                    let out = out.clone();
                    tokio::spawn(async move {
                        let answer = quay.post(line.into()).await;
                        let Some(id) = message.id else { return };
                        let reply = answer
                            .and_then(|body| {
                                rpc::reply_line(&id, body)
                                    .ok_or_else(|| "Quay's MCP server sent no reply to this request.".to_string())
                            })
                            .unwrap_or_else(|why| rpc::error(&id, rpc::RELAY_FAILED, &why));
                        let _ = out.send(reply).await;
                    });
                }
            }
        }
        drop(out);
        let _ = written.await;
    });
    ExitCode::SUCCESS
}
