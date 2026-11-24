/// <reference types="node" />
// What the webview makes of a quay_surface call that updates, deletes or replaces surfaces Rust holds
// (#727), at the check Rust asks for.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { CheckError, CreateSurface, SurfacePlace, Verdict } from "./surfaceTypes.ts";
import { startRust, unloadSurfaces, verdicts, verdictOn } from "./fixtures/fakeRust.ts";
import { button, column, create, EVENT, oneButton, text, verdictOnRaw, type Component } from "./fixtures/rawFixtures.ts";

beforeEach(() => startRust({ surface_list: () => [], surface_checks: () => [] }));
afterEach(() => unloadSurfaces());

/** The accepted state of the surface `id` with these components. */
const stateOf = (id: string, components: Component[], dataModel: object = {}): CreateSurface =>
  ({ version: "1.0", createSurface: { surfaceId: id, catalogId: "urn:quay:a2ui:catalog:v1", components, dataModel } }) as CreateSurface;

const held = (state: CreateSurface, place: SurfacePlace = "companion") => ({ place, state });

const update = (id: string, components: Component[]) => ({ version: "1.0", updateComponents: { surfaceId: id, components } });
const setData = (id: string, value: object) => ({ version: "1.0", updateDataModel: { surfaceId: id, ...value } });
const remove = (id: string) => ({ version: "1.0", deleteSurface: { surfaceId: id } });

/** The verdict on a call that holds `messages`, for the surfaces `held`. `creates` is the surface it creates, if it does. */
function verdictOnUpdate(messages: unknown[], surfaces: ReturnType<typeof held>[], creates = ""): Promise<Verdict> {
  const args = creates === "" ? { messages } : { messages, place: "tab", title: "Another plan" };
  return verdictOn({ call: verdicts().length + 1, tool: "quay_surface", surface_id: creates, arguments: args, held: surfaces });
}

/** What was accepted, by surface. */
async function accepted(...call: Parameters<typeof verdictOnUpdate>) {
  const verdict = await verdictOnUpdate(...call);
  assert.ok("surfaces" in verdict, JSON.stringify(verdict));
  return verdict.surfaces;
}

/** Each error's code, surface and path. */
async function errorsOf(...call: Parameters<typeof verdictOnUpdate>) {
  const verdict = await verdictOnUpdate(...call);
  assert.ok("errors" in verdict, JSON.stringify(verdict));
  return verdict.errors.map(({ code, surfaceId, path }: CheckError) => [code, surfaceId, path]);
}

const PLAN = stateOf("plan", column(text("said", { "@path": "/said" })), { said: "x", rows: [1] });

test("an update is run on the state accepted last, and what it leaves alone stays", async () => {
  const messages = [update("plan", [text("more", "y"), { id: "root", component: "Column", children: ["said", "more"] }]), setData("plan", { path: "/said", value: "z" })];
  const [surface, ...others] = await accepted(messages, [held(PLAN)]);
  assert.equal(others.length, 0);
  assert.equal(surface.surface_id, "plan");
  const { components, ...rest } = surface.state.createSurface;
  assert.deepEqual(rest, { surfaceId: "plan", catalogId: "urn:quay:a2ui:catalog:v1", dataModel: { said: "z", rows: [1] } });
  assert.deepEqual(components.map(({ id }) => id).sort(), ["more", "root", "said"]);
  assert.deepEqual([surface.asks, surface.components, surface.images], [false, 3, 0]);
});

test("the state Rust sent is not changed by the check", async () => {
  const before = structuredClone(PLAN);
  await accepted([setData("plan", { path: "/said", value: "z" })], [held(PLAN)]);
  assert.deepEqual(PLAN, before);
});

test("several surfaces are each run on their own, with the one the call creates", async () => {
  const other = stateOf("other", oneButton(EVENT));
  const messages = [setData("other", { path: "/a", value: 1 }), create(column(text("said", "new"))), setData("plan2", { path: "/b", value: 2 })];
  const surfaces = await accepted(messages, [held(stateOf("plan2", column(text("said", "x")))), held(other)], "plan");
  assert.deepEqual(
    surfaces.map(({ surface_id, asks, state }) => [surface_id, asks, state.createSurface.dataModel]),
    [["other", true, { a: 1 }], ["plan", false, {}], ["plan2", false, { b: 2 }]],
  );
});

test("what an update leaves must be whole, and is told at its last message or at the component the engine names", async () => {
  const cases: [unknown[], string, string][] = [
    // An orphan, which no update can remove: it says so at the message
    [[setData("plan", { path: "/a", value: 1 }), update("plan", [{ id: "root", component: "Column", children: [] }])], "INTEGRITY_ERROR", "/messages/1/updateComponents"],
    [[update("plan", [text("lost", "x")]), setData("plan", { path: "/a", value: 1 })], "INTEGRITY_ERROR", "/messages/0/updateComponents/components/0"],
    [[update("plan", [{ id: "root", component: "Column", children: ["said", "nowhere"] }])], "INTEGRITY_ERROR", "/messages/0/updateComponents/components/0"],
    // A cycle, of which it names the component that the call leaves as it was
    [[update("plan", [{ id: "said", component: "Column", children: ["root"] }])], "RECURSION_LIMIT_EXCEEDED", "/messages/0/updateComponents"],
    [[update("plan", [{ ...text("said", "x"), variant: "h2" }])], "VALIDATION_FAILED", "/messages/0/updateComponents/components/0/variant"],
    [[setData("plan", { path: "/said/deep", value: 1 })], "DATA_ERROR", "/messages/0/updateDataModel"],
    [[setData("plan", { value: 5 })], "VALIDATION_FAILED", "/messages/0/updateDataModel/value"],
    [[setData("plan", { path: "/frame/ready", value: true })], "VALIDATION_FAILED", "/messages/0/updateDataModel/path"],
  ];
  for (const [messages, code, path] of cases) assert.deepEqual(await errorsOf(messages, [held(PLAN)]), [[code, "plan", path]], path);
});

test("a call with one bad message makes nothing, and each surface's errors are told in the order of the messages", async () => {
  const bad = (id: string) => update(id, [{ ...text("said", "x"), variant: "h2" }]);
  const other = stateOf("other", column(text("said", "x")));
  const found = await errorsOf([setData("plan", { path: "/a", value: 1 }), bad("other"), bad("plan")], [held(PLAN), held(other)]);
  assert.deepEqual(found.map(([, id, path]) => [id, path]), [["other", "/messages/1/updateComponents/components/0/variant"], ["plan", "/messages/2/updateComponents/components/0/variant"]]);
});

test("an update is held to its own surface's place, and an effect to a Button's action", async () => {
  const [go, label] = button("go", EVENT);
  const root = { id: "root", component: "Column", children: ["said", "go"] };
  const asks = [update("plan", [root, go, label])];
  assert.deepEqual(await errorsOf(asks, [held(PLAN, "strip")]), [["VALIDATION_FAILED", "plan", "/messages/0/updateComponents/components/1/action"]]);
  for (const place of ["companion", "tab"] as const) assert.equal((await accepted(asks, [held(PLAN, place)]))[0].asks, true);
  // The call's own place is the surface's that it creates
  const messages = [...asks, { version: "1.0", createSurface: { surfaceId: "new", components: column(text("said", "x")) } }];
  assert.equal((await errorsOf(messages, [held(PLAN, "strip")], "new")).length, 1);
  const effect = { "@call": "openUrl", args: { url: "https://quay.example" } };
  assert.deepEqual(await errorsOf([update("plan", [text("said", effect)])], [held(PLAN)]), [["VALIDATION_FAILED", "plan", "/messages/0/updateComponents/components/0/text"]]);
});

test("the size limits are of the whole surface, told at the last message", async () => {
  const texts = (from: number, count: number) => Array.from({ length: count }, (_, i) => text(`t${from + i}`, "x"));
  const first = texts(0, 400);
  const more = texts(400, 239);
  const root = { id: "root", component: "Column", children: [...first, ...more].map(({ id }) => id) };
  const verdict = await verdictOnUpdate([update("plan", more), update("plan", [root])], [held(stateOf("plan", column(...first)))]);
  assert.ok("errors" in verdict);
  assert.deepEqual(verdict.errors.map(({ path, message }) => [path, message]), [["/messages/1/updateComponents", "A surface has at most 500 components; this one would have 640."]]);

  const data = await verdictOnUpdate([setData("plan", { path: "/b", value: "x".repeat(200 * 1024) })], [held(stateOf("plan", column(text("said", "x")), { a: "x".repeat(100 * 1024) }))]);
  assert.ok("errors" in data && /^A surface has at most 256 kB of data/.test(data.errors[0].message));
});

test("an update of a surface Rust does not hold is left for Rust to tell, and what is wrong in it is told", async () => {
  assert.deepEqual(await accepted([setData("gone", { path: "/a", value: 1 })], []), []);
  assert.deepEqual(await errorsOf([update("gone", [{ ...text("said", "x"), checks: [] }])], []), [["VALIDATION_FAILED", "gone", "/messages/0/updateComponents/components/0/checks"]]);
});

test("a deleted surface is not among those that are made, and one created after its delete has nothing of it", async () => {
  assert.deepEqual(await accepted([remove("plan")], [held(PLAN)]), []);
  assert.deepEqual(await accepted([setData("plan", { path: "/a", value: 1 }), remove("plan")], [held(PLAN)]), []);
  assert.deepEqual(await accepted([create(column(text("said", "x"))), remove("plan")], [], "plan"), []);
  const [surface, ...others] = await accepted([setData("plan", { path: "/a", value: 1 }), remove("plan"), create(column(text("new", "x")), { dataModel: { b: 1 } }), setData("plan", { path: "/c", value: 2 })], [held(PLAN, "strip")], "plan");
  assert.equal(others.length, 0);
  assert.deepEqual([surface.state.createSurface.components.map(({ id }) => id), surface.state.createSurface.dataModel], [["root", "new"], { b: 1, c: 2 }]);
  // What is created after the delete is in the call's own place
  assert.equal((await accepted([remove("plan"), create(oneButton(EVENT))], [held(PLAN, "strip")], "plan"))[0].asks, true);
  // An update before the delete is no less checked
  assert.deepEqual(await errorsOf([update("plan", [{ ...text("said", "x"), variant: "h2" }]), remove("plan")], [held(PLAN)]), [["VALIDATION_FAILED", "plan", "/messages/0/updateComponents/components/0/variant"]]);
});

test("a surface that is created is in the call's verdict by its id", async () => {
  const verdict = await verdictOnRaw([create(column(text("said", "x")))]);
  assert.ok("surface_id" in verdict && verdict.surface_id === "plan");
});

test("the images an update brings are named, and counted with those that were there", async () => {
  const image = (id: string, url: string): Component => ({ id, component: "Image", url });
  const one = stateOf("plan", column(image("a", "a.png")));
  const root = { id: "root", component: "Column", children: ["a", "b"] };
  const [surface] = await accepted([update("plan", [root, image("b", "b.png")])], [held(one)]);
  assert.deepEqual([surface.images, surface.image_paths], [2, ["a.png", "b.png"]]);
});
