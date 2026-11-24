//! What the tests of `quay_surface` at the `/mcp` seam share: the messages an agent writes, and the
//! verdicts a webview gives on a call that holds them.

use serde_json::{json, Value};

use super::check::{Accepted, AcceptedSurface, Verdict};
use super::store::SurfaceRecord;
use super::test_seam::{accepted, FakeCli, FakeWebview, OpenCall, Seam};

/// The message that creates the surface `id`.
pub fn create(id: &str) -> Value {
    json!({ "version": "1.0", "createSurface": { "surfaceId": id, "components": [{ "id": "root", "component": "Text", "text": "x" }] } })
}

/// The message that sets `/a` in the data of the surface `id`.
pub fn update(id: &str) -> Value {
    json!({ "version": "1.0", "updateDataModel": { "surfaceId": id, "path": "/a", "value": 1 } })
}

pub fn delete(id: &str) -> Value {
    json!({ "version": "1.0", "deleteSurface": { "surfaceId": id } })
}

/// A call that creates the surface `id` in `place`.
pub fn plan(id: &str, place: &str) -> Value {
    json!({ "place": place, "title": "Migration plan", "messages": [create(id)] })
}

/// A call that holds `messages` and creates nothing.
pub fn messages(messages: &[Value]) -> Value {
    json!({ "messages": messages })
}

/// The A2UI message of an action of the surface `plan`.
pub fn action() -> Value {
    json!({ "version": "1.0", "action": { "name": "go", "surfaceId": "plan", "sourceComponentId": "go", "timestamp": "2026-11-24T20:00:00Z", "context": { "a": 1 } } })
}

/// A verdict that rejects a call for `errors`.
pub fn rejected(errors: Value) -> Verdict {
    serde_json::from_value(json!({ "errors": errors })).unwrap()
}

/// What a webview makes of a surface it accepts. Its state stands for what the engine would give.
pub fn surface(asks: bool) -> Accepted {
    let Verdict::Accepted(surface) = accepted(asks) else { unreachable!() };
    surface
}

/// `surface`, whose state is told from another's by `says`.
pub fn says(asks: bool, says: &str) -> Accepted {
    let mut surface = surface(asks);
    surface.state["createSurface"]["components"] = json!([{ "id": "root", "component": "Text", "text": says }]);
    surface
}

/// The verdict that accepts a call, and the surfaces it makes.
pub fn makes(surfaces: Vec<(&str, Accepted)>) -> Verdict {
    let surfaces = surfaces.into_iter().map(|(id, accepted)| AcceptedSurface { surface_id: id.to_string(), accepted });
    Verdict::Surfaces { surfaces: surfaces.collect() }
}

/// The verdict that accepts a call that makes the surface `id`.
pub fn makes_one(id: &str, asks: bool) -> Verdict {
    makes(vec![(id, surface(asks))])
}

/// Has `cli` create the surface `id` in `place`, which the webview accepts.
pub async fn created(seam: &Seam, webview: &mut FakeWebview, cli: &FakeCli, id: &str, place: &str, asks: bool) -> (OpenCall, SurfaceRecord) {
    let call = cli.call("quay_surface", plan(id, place));
    seam.surfaces.verdict(webview.next_check().await.call, makes_one(id, asks));
    (call, webview.next_shown().await)
}

/// What a rejected call was told: its errors, and what to do next.
pub async fn told(call: OpenCall) -> (Value, String) {
    let text = call.failure().await;
    let body: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{e} in {text}"));
    (body["errors"].clone(), body["next"].as_str().unwrap().to_string())
}

/// What a call of `term-a` is told that the webview finds nothing wrong with.
pub async fn told_by_rust(seam: &Seam, webview: &mut FakeWebview, arguments: Value) -> Value {
    let call = seam.cli("term-a").call("quay_surface", arguments);
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![]));
    told(call).await.0
}

pub fn invalid(path: &str, message: &str) -> Value {
    json!({ "code": "VALIDATION_FAILED", "path": path, "message": message })
}

/// An error about the surface `plan`.
pub fn about_plan(code: &str, path: &str, message: &str) -> Value {
    json!({ "code": code, "surfaceId": "plan", "path": path, "message": message })
}
