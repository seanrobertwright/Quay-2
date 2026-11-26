/// <reference types="node" />
// What `rawTypedIn` leaves out of a raw surface's "typed, not sent" (#770).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SurfaceComponent } from "../surfaceTypes.ts";
import { rawTypedIn } from "./rawTyped.ts";

const field = (id: string, path: string, obscured = false): SurfaceComponent =>
  ({ id, component: "TextField", label: id, ...(obscured ? { variant: "obscured" } : {}), value: { "@path": path } }) as SurfaceComponent;

for (const written of [".", ""]) {
  test(`an obscured field bound to ${JSON.stringify(written)} in a list item holds that item, which is left out`, () => {
    const components = [field("pin", written, true), field("note", "/note")];
    const typed = rawTypedIn(components, { "/pins/0": "1234", "/pins/1": "5678", "/note": "hi" });
    assert.deepEqual(
      typed.map(({ text }) => text),
      ["hi"],
    );
  });
}

test("a plain field bound to the list item itself is still shown", () => {
  const typed = rawTypedIn([field("tag", ".")], { "/tags/0": "red" });
  assert.deepEqual(
    typed.map(({ text }) => text),
    ["red"],
  );
});
